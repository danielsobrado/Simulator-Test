import {
  dot,
  fract,
  screenCoordinate,
  sin,
  vec3,
} from 'three/tsl';

const HASH_VECTOR = vec3(12.9898, 78.233, 37.719);
const HASH_SCALE = 43758.5453;
const SEED_SCALE = 4096;

export function screenDitherThreshold(seed) {
  return fract(sin(dot(
    vec3(screenCoordinate, seed.mul(SEED_SCALE)),
    HASH_VECTOR,
  )).mul(HASH_SCALE));
}
