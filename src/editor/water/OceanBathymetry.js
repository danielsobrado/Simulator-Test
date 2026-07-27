function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2d(x, z, seed) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const north = lerp(hash2d(x0, z0, seed), hash2d(x0 + 1, z0, seed), tx);
  const south = lerp(hash2d(x0, z0 + 1, seed), hash2d(x0 + 1, z0 + 1, seed), tx);
  return lerp(north, south, tz) * 2 - 1;
}

export function oceanDepthProfile(distanceMeters, config) {
  const shelfMeters = config.coastalShelfMeters;
  const shelfAmount = smoothstep(distanceMeters / shelfMeters);
  const deepRange = Math.max(shelfMeters, config.shoreDistanceMeters - shelfMeters);
  const deepAmount = smoothstep((distanceMeters - shelfMeters) / deepRange);
  return lerp(0, config.shelfDepth, shelfAmount)
    + (config.maximumDepth - config.shelfDepth) * deepAmount;
}

export function sampleOceanBed({
  baseHeight,
  filteredBaseHeight,
  surfaceHeight,
  distanceMeters,
  cellX,
  cellZ,
  seed,
  config,
}) {
  const profileDepth = oceanDepthProfile(distanceMeters, config);
  const retainedDepth = Math.max(0, surfaceHeight - filteredBaseHeight) * 0.35;
  const detailScaleCells = Math.max(1, 192 / config.cellSizeMeters);
  const detail = valueNoise(cellX / detailScaleCells, cellZ / detailScaleCells, seed + 2909)
    * config.maximumDepth
    * 0.08
    * smoothstep(distanceMeters / config.coastalShelfMeters);
  const targetDepth = clamp(
    Math.min(
      distanceMeters * config.maximumBedSlope,
      Math.max(retainedDepth, profileDepth + detail),
    ),
    0,
    config.maximumDepth,
  );
  const baseDepth = Math.max(0, surfaceHeight - baseHeight);
  const blendedDepth = lerp(baseDepth, targetDepth, smoothstep(distanceMeters / config.cellSizeMeters));
  return surfaceHeight - clamp(blendedDepth, 0, config.maximumDepth);
}
