import {
  clamp,
  dot,
  float,
  floor,
  fract,
  mix,
  oneMinus,
  sin,
  vec2,
  vec3,
} from 'three/tsl';

const REGION_HASH_VECTOR_A = Object.freeze([127.1, 311.7]);
const REGION_HASH_VECTOR_B = Object.freeze([269.5, 183.3]);
const BIOME_HASH_VECTOR = Object.freeze([0.41, 0.73, 0.19]);
const HASH_SCALE = 43758.5453;
const HASH_OFFSET = 19.73;
const MIN_COLOR_MULTIPLIER = 0.82;
const MAX_COLOR_MULTIPLIER = 1.18;
const MIN_DETAIL_SCALE = 0.82;
const MAX_DETAIL_SCALE = 1.18;

function hashCell(cell, vector, seedOffset) {
  return fract(
    sin(dot(cell.add(vec2(seedOffset, seedOffset * 0.618)), vec2(vector[0], vector[1])))
      .mul(HASH_SCALE),
  );
}

export function createTerrainMaterialGenome({ worldXZ, biomeColor, genomes }) {
  if (!genomes?.enabled) {
    return {
      colorMultiplier: vec3(1),
      roughnessOffset: float(0),
      detailScale: float(1),
    };
  }

  const regionCell = floor(worldXZ.div(genomes.regionScaleMeters));
  const regionA = hashCell(regionCell, REGION_HASH_VECTOR_A, genomes.seedOffset);
  const regionB = hashCell(regionCell, REGION_HASH_VECTOR_B, genomes.seedOffset + HASH_OFFSET);
  const biomeSignal = fract(dot(biomeColor, vec3(...BIOME_HASH_VECTOR)).mul(13.37));
  const signalA = mix(regionA, biomeSignal, genomes.biomeInfluence).sub(0.5).mul(2);
  const signalB = mix(regionB, oneMinus(biomeSignal), genomes.biomeInfluence).sub(0.5).mul(2);
  const colorStrength = genomes.colorStrength;

  return {
    colorMultiplier: clamp(
      vec3(
        float(1).add(signalA.mul(colorStrength)),
        float(1).add(signalA.mul(0.35).add(signalB.mul(0.25)).mul(colorStrength)),
        float(1).add(signalB.mul(colorStrength)),
      ),
      vec3(MIN_COLOR_MULTIPLIER),
      vec3(MAX_COLOR_MULTIPLIER),
    ),
    roughnessOffset: signalB.mul(genomes.roughnessStrength),
    detailScale: clamp(
      float(1).add(signalA.mul(genomes.detailStrength)),
      MIN_DETAIL_SCALE,
      MAX_DETAIL_SCALE,
    ),
  };
}
