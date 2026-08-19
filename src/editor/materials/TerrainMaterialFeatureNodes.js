import {
  abs,
  clamp,
  dot,
  floor,
  fract,
  max,
  mix,
  oneMinus,
  sin,
  smoothstep,
  vec2,
} from 'three/tsl';

const HASH_VECTOR = Object.freeze([127.1, 311.7]);
const HASH_SCALE = 43758.5453;
const HASH_OFFSET_A = 17.31;
const HASH_OFFSET_B = 43.79;
const HASH_OFFSET_C = 89.17;

function hashCell(cell, seed) {
  return fract(
    sin(dot(cell.add(vec2(seed, seed * 0.618)), vec2(...HASH_VECTOR))).mul(HASH_SCALE),
  );
}

function valueNoise(planarMeters, scaleMeters, seed) {
  const coordinate = planarMeters.div(scaleMeters);
  const cell = floor(coordinate);
  const local = fract(coordinate);
  const blend = local.mul(local).mul(local.mul(-2).add(3));
  const a = hashCell(cell, seed);
  const b = hashCell(cell.add(vec2(1, 0)), seed);
  const c = hashCell(cell.add(vec2(0, 1)), seed);
  const d = hashCell(cell.add(vec2(1, 1)), seed);
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

export function createTerrainMaterialFeatureMasks({
  worldXZ,
  materialWeights,
  terrainShape,
  wetness,
  canopy,
  shoreline,
  features,
}) {
  if (!features?.enabled) {
    const zero = materialWeights.r.mul(0);
    return { lichen: zero, litter: zero, cracks: zero, mineral: zero };
  }

  const patchA = valueNoise(worldXZ, features.patchScaleMeters, features.seedOffset);
  const patchB = valueNoise(
    worldXZ,
    features.patchScaleMeters * 0.73,
    features.seedOffset + HASH_OFFSET_A,
  );
  const fine = valueNoise(worldXZ, features.detailScaleMeters, features.seedOffset + HASH_OFFSET_B);
  const streak = valueNoise(
    vec2(worldXZ.x.mul(0.42), worldXZ.y),
    features.detailScaleMeters * 1.7,
    features.seedOffset + HASH_OFFSET_C,
  );
  const curvature = clamp(terrainShape.g.mul(8).add(0.5), 0, 1);
  const concavity = smoothstep(0.52, 0.82, curvature);
  const flat = oneMinus(smoothstep(0.18, 0.48, terrainShape.r));
  const steep = smoothstep(0.24, 0.62, terrainShape.r);
  const dry = oneMinus(wetness);
  const shelteredWet = wetness.mul(mix(0.35, 1, canopy)).mul(mix(0.55, 1, concavity));
  const crackRidge = oneMinus(abs(fine.mul(2).sub(1)));

  return {
    lichen: materialWeights.b
      .mul(shelteredWet)
      .mul(smoothstep(0.60, 0.84, patchA)),
    litter: max(materialWeights.r, materialWeights.g.mul(0.45))
      .mul(canopy)
      .mul(oneMinus(wetness.mul(0.45)))
      .mul(smoothstep(0.58, 0.82, patchB)),
    cracks: materialWeights.g
      .mul(dry)
      .mul(flat)
      .mul(smoothstep(0.88, 0.97, crackRidge)),
    mineral: materialWeights.b
      .mul(max(wetness, shoreline.mul(0.7)))
      .mul(steep)
      .mul(smoothstep(0.68, 0.88, streak)),
  };
}
