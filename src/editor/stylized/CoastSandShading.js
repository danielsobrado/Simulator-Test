import { Color } from 'three/webgpu';
import { Fn, If, cameraPosition, float, mix, oneMinus, positionWorld, sin, smoothstep, time, vec3, vec4 } from 'three/tsl';
import { periodicFbm2 } from './PeriodicNoiseNodes.js';
import { seaStateUniforms } from '../water/seaState.js';
import { godsEndCausticLattice } from '../water/GodsEndWaterPatterns.js';
import { resolveCoastSand } from '../water/CoastSandConfig.js';

/** Metres of height by which the sand's band edges wander. */
const BAND_NOISE_METRES = 0.7;

function colorNode(value) {
  const c = new Color(value); return vec3(c.r, c.g, c.b);
}

/** grass-test's warm beach, pale submerged sand and mottled reef shelf. */
export function createCoastSandNodes({ localXZ, patterns, groundHeight, sandMask, waterCoverage, oceanMask = float(1),
  organic = float(0), cold = float(0), config = {}, clock = time }) {
  const settings = resolveCoastSand(config);
  if (!settings.enabled) return null;
  const height = groundHeight.sub(seaStateUniforms.seaLevel);
  // Widest reach of the bands below once the noise has moved them, for the branch.
  const reach = smoothstep(-16 - BAND_NOISE_METRES, -15.9 - BAND_NOISE_METRES, height)
    .mul(oneMinus(smoothstep(2.8 + BAND_NOISE_METRES, 2.9 + BAND_NOISE_METRES, height)))
    .mul(sandMask.max(waterCoverage)).mul(oceanMask);
  // Noise, shelf mottling and caustics execute only in the coastal band.
  return {
    apply(color, roughness) {
      const result = Fn(() => {
        const response = vec4(color, roughness).toVar();
        If(reach.greaterThan(0.001), () => {
          // Every band edge wanders by up to BAND_NOISE_METRES of height. The bed is
          // a 2 m triangle mesh, often near planar where it was carved, so a band
          // keyed on plain height drew its contours as long straight lines.
          const wander = periodicFbm2(patterns.latticePoint('sandReef', localXZ)).sub(0.5).mul(BAND_NOISE_METRES * 2);
          const banded = height.add(wander);
          const bedDepth = banded.negate();
          const beach = oneMinus(smoothstep(1.8, 2.8, banded)).mul(smoothstep(-1.6, 0.2, banded)).mul(sandMask);
          const bed = smoothstep(0.1, 1.6, bedDepth).mul(oneMinus(smoothstep(10, 16, bedDepth))).mul(waterCoverage);
          const amount = beach.max(bed).mul(oceanMask);
          const macro = periodicFbm2(patterns.latticePoint('sandMacro', localXZ));
          const phase = name => patterns.wavePhase(name, localXZ);
          const meso = sin(phase('sandMesoX').add(sin(phase('sandMesoWarp'))))
            .mul(sin(phase('sandMesoZ'))).mul(0.5).add(0.5);
          const ripplePhase = phase('sandRippleX').add(sin(phase('sandRippleWarp')).mul(0.8));
          // Faded out once a ripple is finer than a couple of pixels: sampled
          // there, the sine aliased into curved white moiré lines on the sand.
          const resolved = oneMinus(smoothstep(.6, 2.4, ripplePhase.fwidth()));
          const ripples = sin(ripplePhase).mul(resolved).mul(0.025).add(1);
          const warm = mix(colorNode(settings.dryDark), colorNode(settings.dryLight), macro);
          const gravel = mix(colorNode('#686f6b'), colorNode('#a8aaa1'), macro);
          const mud = mix(colorNode('#424a36'), colorNode('#82785b'), macro);
          const dry = mix(mix(warm, gravel, cold.mul(.8)), mud, organic.mul(.75))
            .mul(ripples).mul(mix(float(0.93), float(1.06), meso));
          const bedSand = mix(dry, colorNode(settings.seabedColor).mul(ripples),
            float(settings.seabedColorWeight).mul(oneMinus(cold.mul(.65))).mul(oneMinus(organic.mul(.7))));
          const reefBand = smoothstep(0.6, 1.6, bedDepth).mul(oneMinus(smoothstep(4.5, 6.5, bedDepth)));
          const reef = smoothstep(0.52, 0.68, periodicFbm2(patterns.latticePoint('sandReef', localXZ)))
            .mul(reefBand).mul(settings.reefStrength).mul(oneMinus(cold)).mul(oneMinus(organic));
          const reefColor = mix(colorNode(settings.reefColor), colorNode(settings.reefRockColor), meso);
          const bedColor = mix(bedSand, reefColor, reef);
          const causticFade = smoothstep(0.25, 0.65, bedDepth)
            .mul(oneMinus(smoothstep(2, 5.7, bedDepth)))
            .mul(oneMinus(smoothstep(26, 54, cameraPosition.distance(positionWorld))));
          const caustic = godsEndCausticLattice(patterns.latticePoint('sandCaustics', localXZ), 5.5, clock)
            .mul(causticFade).mul(settings.causticStrength);
          const sand = mix(dry, bedColor.mul(caustic.add(1)), bed);
          response.assign(vec4(mix(color, sand, amount), mix(roughness, float(0.95), amount)));
        });
        return response;
      })().toVar();
      return { color: result.rgb, roughness: result.a };
    },
  };
}
