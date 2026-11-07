import { buildingEntry } from '../../world/settlements/SettlementBuildingCatalog.js';
import { planToWorld } from '../../world/settlements/view/SettlementPlacements.js';

/** Most buildings a leaf is tested against; the nearest win. */
export const MAX_LEAF_SHELTERS = 16;
/** Metres the footprint grows by: eaves overhang the plot. */
const EAVES = 0.4;
/** Metres above the catalogue height a roof ridge may stand. */
const ROOF_HEADROOM = 1;

const cellOf = (x, z, tileSize) => [x / tileSize, -z / tileSize];

/**
 * 1 on a planned town's streets, squares and footprints, else 0. Never plans a
 * town: a settlement not yet planned (so not drawn either) reads as open ground.
 */
export function townCover(settlementField, x, z, tileSize) {
  if (!settlementField) return 0;
  const [cellX, cellZ] = cellOf(x, z, tileSize);
  const candidates = settlementField.candidates(cellX, cellZ);
  if (!candidates.length || candidates.some(entry => entry.plan === undefined)) return 0;
  return settlementField.cover(cellX, cellZ);
}

/**
 * How much shedding woodland is around: per canonical sample point, a
 * shedding biome times how wooded the spot is (forest habitat coverage), minus
 * town ground. A deciduous biome's meadows, clearings and streets shed nothing.
 */
export function sheddingWoodlandShare({ points, tileIds, getTile, tileSize, forestField = null, settlementField = null }) {
  const shedding = new Set(tileIds);
  let total = 0;
  let counted = 0;
  for (const { x, z } of points) {
    const tile = getTile(Math.floor(x / tileSize), Math.floor(-z / tileSize));
    if (!Number.isInteger(tile)) continue;
    counted += 1;
    if (!shedding.has(tile)) continue;
    const wooded = forestField ? forestField.sample(x, z).patchCoverage : 1;
    total += wooded * (1 - townCover(settlementField, x, z, tileSize));
  }
  return counted ? total / counted : 0;
}

/**
 * Planned buildings within `radius` metres of a canonical point, nearest first,
 * as oriented boxes in canonical space: a leaf inside one is indoors, under a
 * roof or inside a wall, so it is not drawn.
 */
export function collectLeafShelters({ settlementField, x, z, radius, tileSize, max = MAX_LEAF_SHELTERS }) {
  if (!settlementField) return [];
  const [cellX, cellZ] = cellOf(x, z, tileSize);
  const shelters = [];
  for (const { entry } of settlementField.entriesNear(cellX, cellZ, radius / tileSize)) {
    if (!entry.plan) continue;
    for (const building of entry.plan.buildings) {
      const center = planToWorld(entry.settlement, tileSize, building.x, building.z);
      const halfWidth = building.width / 2 + EAVES;
      const halfDepth = building.depth / 2 + EAVES;
      const distance = Math.hypot(center.x - x, center.z - z) - Math.hypot(halfWidth, halfDepth);
      if (distance > radius) continue;
      shelters.push({
        x: center.x, z: center.z, distance,
        cos: Math.cos(building.yaw), sin: Math.sin(building.yaw),
        halfWidth, halfDepth,
        top: building.pad + buildingEntry(building.kind, building.variant).height + ROOF_HEADROOM,
      });
    }
  }
  return shelters.sort((a, b) => a.distance - b.distance).slice(0, max);
}

/**
 * Whether a canonical point is inside a shelter: the CPU twin of the shader
 * test in fallingLeavesMaterial. Plan Z runs opposite to canonical Z.
 */
export function insideShelter(shelter, x, y, z) {
  const planX = x - shelter.x;
  const planZ = -(z - shelter.z);
  const localX = shelter.cos * planX - shelter.sin * planZ;
  const localZ = shelter.sin * planX + shelter.cos * planZ;
  return Math.abs(localX) <= shelter.halfWidth && Math.abs(localZ) <= shelter.halfDepth && y <= shelter.top;
}
