import { valueNoise } from './WaterNoise.js';

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

export function oceanDepthProfile(distanceMeters, config) {
  const distance = clamp(distanceMeters, 0, config.shoreDistanceMeters);
  const shelf = config.coastalShelfMeters, deepRun = config.shoreDistanceMeters - shelf;
  const shelfSlope = config.shelfDepth / shelf;
  const deepSlope = (config.maximumDepth - config.shelfDepth) / deepRun;
  // A quadratic fillet rounds the shelf break: the slope jumped there, and the
  // water darkened along one hard contour round every pool.
  const fillet = Math.min(shelf, deepRun) * 0.5;
  const offset = distance - shelf;
  if (Math.abs(offset) < fillet) {
    return config.shelfDepth + shelfSlope * offset
      + (deepSlope - shelfSlope) * (offset + fillet) ** 2 / (4 * fillet);
  }
  if (distance <= shelf) return shelfSlope * distance;
  return lerp(config.shelfDepth, config.maximumDepth, offset / deepRun);
}

export function sampleOceanBed({
  baseHeight,
  surfaceHeight,
  distanceMeters,
  cellX,
  cellZ,
  seed,
  config,
}) {
  const profileDepth = oceanDepthProfile(distanceMeters, config);
  const detailScaleCells = Math.max(1, 192 / config.cellSizeMeters);
  const detail = valueNoise(cellX / detailScaleCells, cellZ / detailScaleCells, seed + 2909)
    * config.maximumDepth
    * 0.08
    * smoothstep(distanceMeters / config.coastalShelfMeters);
  const targetDepth = clamp(profileDepth + detail, 0, config.maximumDepth);
  const baseDepth = Math.max(0, surfaceHeight - baseHeight);
  // The carve eases in over five cells. Taken at full depth one cell out, it
  // dropped the bed 0.3-0.7 m between the shoreline vertices and the next ring,
  // and every depth contour in between ran along that ring of cells: the waterline
  // fade drew square teeth round every pool, and flat coasts, shallows and islets
  // came out in right-angle steps. Near the shore the bed follows the ground.
  const blendedDepth = lerp(baseDepth, targetDepth, smoothstep(distanceMeters / (config.cellSizeMeters * 5)));
  return surfaceHeight - clamp(blendedDepth, 0, config.maximumDepth);
}
