import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  dot,
  float,
  fract,
  length,
  max,
  mix,
  normalize,
  oneMinus,
  pow,
  positionWorld,
  reflect,
  select,
  smoothstep,
  texture,
  vec2,
  vec3,
} from 'three/tsl';
import { periodicFbm2 } from './PeriodicNoiseNodes.js';
import { surfaceGradient } from './ShoreContactNodes.js';
import { rainRoughness } from './RainRippleShading.js';
import { seaStateUniforms } from '../water/seaState.js';

/**
 * grass-test's lake and river surface (`WaterMaterial`, inland branch): its
 * procedural detail texture, flow-mapped detail normals, Fresnel, sun glint and
 * foam placement, ported onto the stylized water sheet.
 *
 * The donor draws each river as a ribbon parameterised by metres across and
 * along its course, and scrolls its detail down that course. Our sheet is the
 * terrain grid with a flow texture and no course coordinates, so the same two
 * detail phases are advected along the local current instead (a flow map), in
 * world metres. The donor's world runs at 2.8 units to the metre; its spatial
 * frequencies and speeds are converted, its shading constants are not.
 */

/** Detail tiles per metre. The donor's lake tile (0.065/unit) is 5.5 m, its river 1.6 × 8 m. */
const DETAIL_SCALE = 0.25;
/** The donor's micro layer (×3.7), rounded so it tiles the pattern period whole. */
const MICRO_SCALE = 4;
/**
 * Detail coordinates are chunk-local metres plus the chunk centre wrapped to
 * this period in double precision (the water's `riverDetail` PatternOrigins
 * frame), so they stay exact at planet scale. It is a whole number of every tile
 * above (4 m, 1 m, 2⅔ m), so the wrap never shows.
 */
export const RIVER_DETAIL_PATTERN_PERIOD_METERS = 320;

let sharedDetailTexture = null;

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * Tileable stochastic slopes. Crossed cosine trains previously turned the
 * sun highlight into a crosshatched grid, particularly on wide river reaches.
 * Foam has an independent noise field so highlights and bubbles do not stamp
 * the same shapes onto the surface.
 */
export function createWaterDetailTexture() {
  const size = 256, data = new Uint8Array(size * size * 4);
  const noise = (x, y, cells) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const hash = (a, b) => {
      const n = Math.sin(((a + cells) % cells) * 127.1 + ((b + cells) % cells) * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), sx),
      THREE.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx),
      sy,
    );
  };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const heightAt = (px, py) => noise(px / size * 8, py / size * 8, 8) * .65
      + noise(px / size * 16 + 3.1, py / size * 16 + 7.7, 16) * .25
      + noise(px / size * 32 + 9.3, py / size * 32 + 2.7, 32) * .1;
    const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * 5;
    const dz = (heightAt(x, y + 1) - heightAt(x, y - 1)) * 5;
    const k = (y * size + x) * 4;
    data[k] = Math.round((dx * 0.5 + 0.5) * 255);
    data[k + 1] = Math.round((dz * 0.5 + 0.5) * 255);
    data[k + 2] = Math.round((noise(x / size * 8, y / size * 8, 8) * 0.55
      + noise(x / size * 16, y / size * 16, 16) * 0.3
      + noise(x / size * 32, y / size * 32, 32) * 0.15) * 255);
    data[k + 3] = 255;
  }
  const result = new THREE.DataTexture(data, size, size);
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.magFilter = THREE.LinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}

/** One detail texture for every water chunk. */
export function getWaterDetailTexture() {
  if (!sharedDetailTexture) {
    sharedDetailTexture = createWaterDetailTexture();
    sharedDetailTexture.name = 'Water detail';
  }
  return sharedDetailTexture;
}

/**
 * @param {object} options
 * @param {object} options.patternXZ vec2 node: metres on canonical axes, the
 *   `riverDetail` lattice point of the water's PatternOrigins
 * @param {object} options.flow vec2 node: the current, any length
 * @param {object} options.currentStrength float node, 0..1
 * @param {object} options.fall float node: the fall weight, 0..1
 * @param {object} options.waterDepth float node, metres
 * @param {object} options.shoreDistance float node, metres to the bank
 * @param {object} options.time seconds uniform
 * @param {object} options.sunDirection vec3 node toward the sun
 * @param {object} options.viewDirection vec3 node, surface to camera, unit
 * @param {object} options.config `stylizedSurface.water.riverSurface`
 */
export function createRiverSurfaceNodes({
  patternXZ,
  patterns = null,
  localXZ = null,
  flow,
  currentStrength,
  fall,
  waterDepth,
  shoreDistance,
  obstacles = vec2(0),
  // Slope of the ripple field (water/rippleFieldNode.js), world x/z.
  ripple = null,
  time,
  sunDirection,
  viewDirection,
  config,
}) {
  const detail = getWaterDetailTexture();
  // The donor's `current`: 1 on a river, 0 on a lake. Our current is a field.
  const current = clamp(currentStrength.mul(4), 0, 1);
  const flowLength = length(flow);
  let direction = select(flowLength.greaterThan(1e-4), flow.div(max(flowLength, 1e-4)), vec2(0, 1));
  if (localXZ) {
    const across = vec2(direction.y.negate(), direction.x);
    const split = dot(surfaceGradient(obstacles.y, localXZ), across).mul(-1.6).clamp(-.45, .45);
    direction = normalize(direction.add(across.mul(split)));
  }
  const macro = patterns && localXZ ? periodicFbm2(patterns.latticePoint('riverMacro', localXZ)).toVar('riverMacro') : float(.5);
  const warp = vec2(macro.sub(.5).mul(2.6), macro.mul(macro).sub(.25).mul(1.9));
  const detailUv = patternXZ.mul(DETAIL_SCALE).add(warp);
  const geometric = positionWorld.dFdx().cross(positionWorld.dFdy());
  const baseNormal = normalize(geometric.mul(select(geometric.y.lessThan(0), -1, 1))).toVar('riverBaseNormal');
  const gradient = baseNormal.xz.length().div(max(baseNormal.y, .05));
  const energy = smoothstep(.002, .08, gradient).max(fall).max(obstacles.x.mul(.65));
  const margin = smoothstep(.2, 3.5, shoreDistance);
  // Drift per cross-fade cycle, in detail tiles. Still water keeps the donor's
  // lake drift (0.13, 0.07 of a tile per cycle), rivers move with the current.
  const cycle = float(config.cycleSeconds);
  const lakeDrift = vec2(0.13, 0.07).normalize().mul(config.stillDrift);
  const visualSpeed = energy.mul(.75).add(.25).mul(margin.mul(.7).add(.3)).mul(oneMinus(obstacles.y.mul(.65)));
  const riverDrift = direction.mul(visualSpeed.mul(config.currentDrift));
  const drift = mix(lakeDrift, riverDrift, current).mul(cycle.mul(DETAIL_SCALE));

  // Two phases half a cycle apart, each faded out as it jumps back.
  const phase = fract(time.div(cycle));
  const phaseB = fract(phase.add(0.5));
  const blend = abs(phase.mul(2).sub(1));
  // Rational basis closes exactly over the 320 m detail period. Its differently
  // oriented/advected second sample removes the former 4 m and 8 m repeats.
  const secondaryUv = vec2(patternXZ.x.mul(.15).add(patternXZ.y.mul(.2)),
    patternXZ.y.mul(.15).sub(patternXZ.x.mul(.2))).add(vec2(19.3, 7.1)).sub(warp.mul(.7));
  const secondaryDrift = vec2(drift.x.mul(.6).add(drift.y.mul(.8)), drift.y.mul(.6).sub(drift.x.mul(.8)));
  const detailAt = p => mix(texture(detail, detailUv.sub(drift.mul(p))),
    texture(detail, secondaryUv.sub(secondaryDrift.mul(p))), macro.mul(.35).add(.25));
  const a = detailAt(phase), b = detailAt(phaseB);
  const micro = texture(detail, detailUv.mul(MICRO_SCALE).add(vec2(time.mul(-0.018), time.mul(0.013))))
    .rg.mul(2).sub(1);
  const slope = mix(a.rg.mul(2).sub(1), b.rg.mul(2).sub(1), blend)
    .mul(mix(float(0.15), float(0.16), current))
    .add(micro.mul(0.025))
    .mul(config.normalStrength)
    .toVar('riverDetailSlope');

  // The terrain-grid water sheet has displaced positions but flat geometry
  // normals. Recover its actual incline so falls do not reflect a level lake.
  const downhill = dot(baseNormal.xz, direction).negate().div(max(baseNormal.y, 0.01));
  const downstream = normalize(vec3(direction.x, downhill, direction.y));
  const across = normalize(downstream.cross(baseNormal));
  const riverTilt = across.mul(slope.x).add(downstream.mul(slope.y));
  const lakeTilt = vec3(slope.x.negate(), 0, slope.y.negate());
  const tilt = mix(lakeTilt, riverTilt, current);
  // Level water shades level: the sheet's per-triangle tilt near a bank (its
  // lift tapering to the waterline) otherwise showed as faceted reflections.
  const shadingBase = normalize(mix(vec3(0, 1, 0), baseNormal, smoothstep(.03, .12, gradient)));
  const normal = normalize(shadingBase.add(ripple ? tilt.sub(vec3(ripple.x, 0, ripple.y)) : tilt)).toVar('riverDetailNormal');

  const facing = max(dot(normal, viewDirection), 0);
  const fresnel = pow(oneMinus(facing), 5).mul(0.98).add(0.02).mul(0.85);
  // The donor reflects a cube probe; without one, its own fallback sky.
  const reflected = reflect(viewDirection.negate(), normal);
  const sky = mix(colorNode('#81a8b4'), colorNode('#38658a'), smoothstep(0, 0.7, reflected.y));

  const spec = max(dot(reflect(sunDirection.negate(), normal), viewDirection), 0);
  const glint = pow(spec, 110).mul(.8).add(pow(spec, 24).mul(.06))
    .mul(oneMinus(fall.mul(0.8)))
    .mul(config.glintStrength ?? 1)
    .mul(max(sunDirection.y, 0).smoothstep(0, 0.08));

  // Foam: noise in the shallow band, streaks where the current runs fast,
  // and a fringe along the banks. Constants are the donor's; its depth band is
  // read in metres.
  const foamNoise = mix(a.b, b.b, blend);
  // Current is normalized direction, not a measured speed. Fast-looking foam
  // must be earned by local slope/drop energy rather than every river texel.
  const turbulence = energy.mul(.34).mul(current).mul(margin);
  const shore = smoothstep(0.02, 0.13, waterDepth).mul(oneMinus(smoothstep(0.22, 0.75, waterDepth)));
  const streaks = smoothstep(.48, .8, foamNoise).mul(macro.mul(.7).add(.3));
  const riverShore = smoothstep(0.52, 0.82, foamNoise)
    .mul(shore.mul(0.22).add(turbulence.mul(streaks)));
  const bankFoam = oneMinus(smoothstep(0.1, config.bankFoamWidth, shoreDistance)).mul(current)
    .mul(smoothstep(0.48, 0.82, foamNoise)).mul(0.22);
  const foam = riverShore.add(bankFoam).mul(oneMinus(fall)).clamp(0, 0.94);

  // Callers measure the ripple's tilt from the level base, not from the facets.
  return { fresnel, sky, glint, foam, foamNoise, reflected, normal, baseNormal: shadingBase,
    roughness: energy.mul(.15).add(.12).add(rainRoughness(seaStateUniforms.rain)), visualSpeed, energy };
}
