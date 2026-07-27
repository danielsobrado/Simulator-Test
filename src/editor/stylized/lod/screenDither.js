import {
  dot,
  float,
  fract,
  mix,
  oneMinus,
  screenCoordinate,
  sin,
  step,
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

export function orientedScreenDitherThreshold(seed, direction) {
  const threshold = screenDitherThreshold(seed);
  const incoming = step(float(0), direction);
  return mix(oneMinus(threshold), threshold, incoming);
}
