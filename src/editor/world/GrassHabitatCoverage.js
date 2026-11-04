/** Derived field; canonical terrain IDs and the RGBA mask layout stay unchanged. */
export const GRASS_COVERAGE_RECIPE_REVISION = 4;
/**
 * Metres over which grass thins toward water, snow, or anything it cannot grow
 * on. At 8 m, with the fade starting half a cell inland, every pond sat in a
 * bare ring several metres wide (docs/qa/biome-surface, 2026-11-04): a bank
 * keeps its grass to the water's edge.
 */
export const GRASS_HABITAT_EDGE_METERS = 3;
/**
 * Metres over which a sward dissolves into barren land — desert, glacier, bare
 * biomes. Wider than the shore fade: at 8 m a grassland met a desert at a line
 * that read as a seam from any height, while a bank should keep its grass to
 * the water. Thin stands break into islands as they go (GrassPatchiness.js).
 */
export const GRASS_BARREN_EDGE_METERS = 20;
export function grassHabitatHaloCells(tileSize) {
  if (!(tileSize > 0) || !Number.isFinite(tileSize)) throw new Error('Grass habitat tileSize must be positive.');
  return Math.ceil(Math.max(GRASS_HABITAT_EDGE_METERS, GRASS_BARREN_EDGE_METERS) / tileSize) + 2;
}
export function grassHabitatEligible({tileId, snow = 0, water = 0}, tileIds) {
  return tileIds.has(tileId) && snow < .5 && water < 1;
}
/** `inset` cells of bare ground before the fade starts: half a cell toward barren land, none at a bank. */
export function grassHabitatEdge(distance, tileSize, edgeMeters = GRASS_HABITAT_EDGE_METERS, inset = .5) {
  const t = Math.max(0, Math.min(1, Math.max(0, distance - inset) * tileSize / edgeMeters));
  return t * t * (3 - 2 * t);
}
/** Two-pass eight-neighbour chamfer distance from every seed cell. */
function chamferFromSeeds(isSeed, width, height) {
  const distance = new Float32Array(width * height);
  for (let i = 0; i < distance.length; i++) distance[i] = isSeed(i) ? 0 : 1e9;
  const diagonal = Math.SQRT2;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    let d = distance[i];
    if (x) d = Math.min(d, distance[i - 1] + 1);
    if (z) d = Math.min(d, distance[i - width] + 1);
    if (x && z) d = Math.min(d, distance[i - width - 1] + diagonal);
    if (x + 1 < width && z) d = Math.min(d, distance[i - width + 1] + diagonal);
    distance[i] = d;
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x;
    let d = distance[i];
    if (x + 1 < width) d = Math.min(d, distance[i + 1] + 1);
    if (z + 1 < height) d = Math.min(d, distance[i + width] + 1);
    if (x + 1 < width && z + 1 < height) d = Math.min(d, distance[i + width + 1] + diagonal);
    if (x && z + 1 < height) d = Math.min(d, distance[i + width - 1] + diagonal);
    distance[i] = d;
  }
  return distance;
}
/**
 * Inward chamfer distance to the habitat edge. A seedless eligible field is
 * full. With `barren` (1 where an ineligible cell is land, not water), grass
 * also fades over the wider GRASS_BARREN_EDGE_METERS from it.
 */
export function grassHabitatCoverage(eligible, width, height, tileSize, barren = null) {
  if (eligible.length !== width * height) throw new Error('Invalid grass habitat dimensions.');
  const any = chamferFromSeeds((i) => !eligible[i], width, height);
  const land = barren ? chamferFromSeeds((i) => barren[i] === 1, width, height) : null;
  return Uint8Array.from(any, (d, i) => {
    if (!eligible[i]) return 0;
    const edge = grassHabitatEdge(d, tileSize, GRASS_HABITAT_EDGE_METERS, 0);
    return Math.round((land ? Math.min(edge, grassHabitatEdge(land[i], tileSize, GRASS_BARREN_EDGE_METERS)) : edge) * 255);
  });
}
