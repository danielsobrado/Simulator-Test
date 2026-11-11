import { createSeaDetailNodes } from './SeaDetailShading.js';
import { createSeaSurfNodes, createSeaFoamNoise } from './SeaSurfNodes.js';
import { resolveSeaSurf } from '../water/SeaSurf.js';
import {
  abs,
  clamp,
  dot,
  float,
  max,
  min,
  mix,
  normalize,
  oneMinus,
  positionWorld,
  pow,
  select,
  smoothstep,
  sqrt,
  vec2,
  vec3,
} from 'three/tsl';
import { createSeaSwellNodes } from '../water/SeaSwell.js';
import { seaStateUniforms } from '../water/seaState.js';
import { rainRoughness } from './RainRippleShading.js';

/** Nearshore normals follow the rendered depth contours and amplitude envelope. */
function displacedSurfaceSlope() {
  const normal = positionWorld.dFdx().cross(positionWorld.dFdy()).toVar('seaDisplacedNormal');
  const vertical = normal.y.abs().max(1e-8).mul(select(normal.y.lessThan(0), -1, 1));
  return vec2(normal.x, normal.z).negate().div(vertical);
}

/**
 * The open-sea swell on a water chunk: how far the sheet rises and falls, and
 * how that reads on an unlit material: `normal` tilts the reflection, which at
 * the grazing angles a sea is mostly seen at is what makes waves visible;
 * slopes turned toward the sun brighten and those turned away darken; crests
 * lift the existing water colour; and steep crests break into whitecaps,
 * more of them in a storm.
 *
 * Only sea water swells. The water field has no kind channel, so the sea is
 * water standing at the world's still-water level with no current: lakes sit
 * at their own level and rivers flow. The amplitude also falls to zero in the
 * shallows (`sea.shallowDepth`, and never more than `sea.depthRatio` of the
 * depth), so the waterline itself stays where the terrain puts it.
 *
 * Evaluated per vertex and interpolated: the shortest component is 7.5 m, over
 * a 2 m grid.
 */
/**
 * How much of the water here is sea, 0..1. The water field has no kind channel,
 * so the sea is water standing at the world's still-water level with no current:
 * lakes sit at their own level and rivers flow. Needs no swell, so it holds with
 * the swell switched off too.
 */
export function seaWaterMask({ surfaceWorldHeight, currentStrength }) {
  return oneMinus(smoothstep(0.05, 0.3, abs(surfaceWorldHeight.sub(seaStateUniforms.seaLevel))))
    .mul(oneMinus(clamp(currentStrength.mul(4), 0, 1)));
}

export function createSeaSurfaceNodes({
  terrainUv,
  patternXZ = null,
  patterns = null,
  chunkWorldSize,
  surfaceWorldHeight,
  waterDepth,
  waterCoverage,
  currentStrength,
  time,
  phaseOrigin,
  sunDirection,
  config,
  oceanMask = null,
  exposure = float(1),
  // Slope of the ripple field (water/rippleFieldNode.js), world x/z.
  ripple = null,
}) {
  const { storm } = seaStateUniforms;
  // Metres from the chunk centre on canonical axes, matching the chunk's world position.
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  const sharpness = float(config.choppiness * 0.075).mul(storm.mul(0.5).add(1));
  const swell = createSeaSwellNodes({ localXZ, phaseOrigin, time, sharpness });
  const seaMask = oceanMask ?? seaWaterMask({ surfaceWorldHeight, currentStrength });
  const offshore = float(config.amplitude).mul(storm.mul(config.stormScale - 1).add(1));
  const amplitude = min(offshore, waterDepth.mul(config.depthRatio))
    .mul(smoothstep(0, config.shallowDepth, waterDepth))
    .mul(seaMask)
    .mul(waterCoverage)
    .mul(exposure)
    .toVarying('seaSwellAmplitude');
  // Share of full offshore height, so crests and whitecaps fade in the shallows.
  const strength = amplitude.div(offshore.max(1e-4));

  const detail = patternXZ ? createSeaDetailNodes({
    // Wind ripples survive in sheltered shallows even when large swell cannot.
    // Reusing the displacement envelope erased all surface structure there.
    patternXZ, time, choppiness: config.choppiness,
    strength: smoothstep(.04, .5, waterDepth).mul(mix(float(.35), float(1), exposure)), patterns, localXZ,
    phases: swell.phases, amplitude, settings: config.detail,
  }) : null;
  const surf = createSeaSurfNodes({ swell, waterDepth, localXZ, patterns, time,
    settings: resolveSeaSurf(config.surf) });
  const height = (surf?.height ?? swell.height).toVarying('seaSwellHeight');
  const swellSlope = swell.slope.mul(amplitude).toVarying('seaSwellSlope');
  const slope = surf ? mix(displacedSurfaceSlope(), swellSlope, surf.offshore) : swellSlope;
  // Wind chop: a storm roughly doubles the short waves riding the swell.
  const detailed = detail ? slope.add(detail.slope.mul(storm.mul(1.2).add(1))) : slope;
  const surfaceSlope = ripple ? detailed.add(ripple) : detailed;
  const normal = normalize(vec3(surfaceSlope.x.negate(), 1, surfaceSlope.y.negate()));
  const sun = normalize(sunDirection);
  const lit = dot(normal, sun).sub(sun.y);
  const crest = smoothstep(0.3, 0.95, height).mul(strength);
  // Whitecaps share the surf's bounded world field, independently of the
  // periodic normal texture. Chunk-local coordinates preserve planet precision.
  const foamNoise=surf?.foamNoise??(patterns?createSeaFoamNoise(patterns,localXZ,time):float(1));
  // Evaluate breakup per fragment. The old sub-4 m vertex sine pattern aliased
  // against the 2 m water grid and repeated along every carrier crest.
  const breakup=smoothstep(0.25,0.85,foamNoise);
  const threshold = mix(
    float(config.whitecapThreshold),
    float(config.stormWhitecapThreshold),
    storm,
  );
  const roughness = float(0.055).add(storm.mul(0.09)).add(rainRoughness(seaStateUniforms.rain))
    .add(sqrt(detail?.variance ?? float(0)).mul(0.16)).clamp(0.05, 0.48);

  return {
    displacement: height.mul(amplitude),
    release: detail?.release,
    normal,
    foamNoise,
    roughness,
    glint(viewDirection) {
      const specular = dot(sun.negate().reflect(normal), viewDirection).max(0);
      const exponent = mix(float(190), float(18), smoothstep(0.05, 0.48, roughness));
      return pow(specular, exponent).mul(1.55)
        .add(pow(specular, mix(float(24), float(8), roughness)).mul(0.12));
    },
    // How much of this water is sea, 0..1: at sea level and without a current.
    mask: seaMask,
    // Breakers run longer and whiter in a storm.
    surfFoam: surf?.foam.mul(seaMask).mul(storm.add(1)),
    shade(color) {
      const shaded = color.mul(float(1).add(lit.mul(config.slopeShading)));
      // A lit crest retains the water's chroma. Blending every carrier peak
      // toward white painted broad, repeating foam-like stamps on calm water.
      return shaded.mul(float(1).add(crest.mul(config.crestLift)));
    },
    whitecap() {
      const crestCap = smoothstep(threshold, 1, height).mul(strength).mul(breakup);
      // Past a gale the wind tears foam off every wave: drifting patches and
      // streaks over all open water, not only on the tallest crests.
      const gale = smoothstep(0.35, 1, storm);
      const streaks = smoothstep(mix(float(0.78), float(0.5), gale), 0.95, foamNoise)
        .mul(gale).mul(smoothstep(0.6, 2.5, waterDepth)).mul(seaMask).mul(0.7);
      return max(crestCap, streaks);
    },
    /**
     * The standing foam line where the sea meets the beach: a laced band over
     * the last few decimetres of depth, wider and denser in a storm. The swash
     * front only draws a thin moving wire; this is what reads from afar.
     */
    shoreLine() {
      // Starts just past the waterline fade (0.2 m), so the sheet does not thin it away.
      // In calm weather it ends by 0.34 m of depth: out to 0.6 m a shallow beach
      // drew it metres wide, and it read as a milky smear, not a line of foam.
      const band = smoothstep(0.06, 0.16, waterDepth)
        .mul(oneMinus(smoothstep(0.2, storm.mul(0.76).add(0.34), waterDepth)));
      return band.mul(smoothstep(0.42, 0.72, foamNoise)).mul(storm.mul(0.35).add(0.45)).mul(seaMask);
    },
    /**
     * Light coming through a crest, after grass-test's crest transmission.
     *
     * A wave seen edge-on with the sun beyond it glows: the crest has to be high,
     * the view has to be grazing — look straight down and you are looking at the
     * water, not through it — and the light has to be behind the wave rather than
     * bouncing off it. Squaring the grazing term concentrates it in the last few
     * degrees, which is where it happens on a real sea.
     *
     * Returned as an amount rather than a colour, so the material mixes its own.
     */
    transmissionAmount(viewDirection) {
      const grazing = oneMinus(abs(dot(normal, viewDirection)));
      const backlit = clamp(dot(viewDirection, sun.negate()), 0, 1);
      return crest
        .mul(grazing.mul(grazing))
        .mul(backlit)
        .mul(config.crestTransmission ?? 0);
    },
  };
}
