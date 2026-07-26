import { worldToCell } from '../world/WorldCoordinates.js';
import { scatterRandom01 } from './scatterMath.js';

function colonyCenter(cellX, cellZ, rule) {
  return {
    x: (cellX + scatterRandom01(cellX, cellZ, rule.seed, 1)) * rule.supercellSize,
    z: (cellZ + scatterRandom01(cellX, cellZ, rule.seed, 2)) * rule.supercellSize,
  };
}

/**
 * Stable world-space colonies. Neighbouring supercells are inspected so a
 * colony remains continuous across both supercell and streamed-chunk borders.
 */
export function isInsideDetailColony(x, z, rule) {
  const homeX = Math.floor(x / rule.supercellSize);
  const homeZ = Math.floor(z / rule.supercellSize);
  const reach = Math.ceil(rule.radius / rule.supercellSize) + 1;
  const radiusSquared = rule.radius * rule.radius;

  for (let cellZ = homeZ - reach; cellZ <= homeZ + reach; cellZ += 1) {
    for (let cellX = homeX - reach; cellX <= homeX + reach; cellX += 1) {
      if (scatterRandom01(cellX, cellZ, rule.seed, 0) >= rule.probability) continue;
      const center = colonyCenter(cellX, cellZ, rule);
      const dx = center.x - x;
      const dz = center.z - z;
      if ((dx * dx) + (dz * dz) <= radiusSquared) return true;
    }
  }
  return false;
}

/**
 * Wetland tiles count as shore habitat; only configured open-water IDs are
 * excluded. This keeps floating plants close to banks instead of in open sea.
 */
export function isNearOpenWaterShoreline(x, z, rule, { tileSize, tileAt }) {
  if (rule.shorelineCells === 0) return true;
  const origin = worldToCell(x, z, tileSize);
  const openWaterTileIds = new Set(rule.openWaterTileIds);

  for (let offsetZ = -rule.shorelineCells;
    offsetZ <= rule.shorelineCells;
    offsetZ += 1) {
    for (let offsetX = -rule.shorelineCells;
      offsetX <= rule.shorelineCells;
      offsetX += 1) {
      const tileId = tileAt(origin.x + offsetX, origin.z + offsetZ);
      if (Number.isInteger(tileId) && !openWaterTileIds.has(tileId)) return true;
    }
  }
  return false;
}

export function acceptsStrategicDetailPlacement(candidate, rule, context) {
  if (!rule) return true;
  if (rule.strategy !== 'shoreline-colonies') return false;
  return isInsideDetailColony(candidate.x, candidate.z, rule)
    && isNearOpenWaterShoreline(candidate.x, candidate.z, rule, context);
}
