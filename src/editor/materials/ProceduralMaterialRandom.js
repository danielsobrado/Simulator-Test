export function mixSeed(seed, value) {
  let hash = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function hashUnit2d(x, y, seed) {
  let value = mixSeed(seed, x | 0);
  value = mixSeed(value, y | 0);
  return value / 0x100000000;
}
