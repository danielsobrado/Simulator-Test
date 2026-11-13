/**
 * Keeps trees a margin back from barren biomes (`trees.barrenEdge`).
 *
 * The terrain blends a desert's bare ground some way into the grassland next
 * to it, so a tree on the first grassland tile stands on what reads as desert.
 * A candidate is refused when any of eight points `meters` away lies on one of
 * the barren `tileIds`. Open water is never barren: shore trees stay.
 *
 * @param {{ meters?: number, tileIds?: number[] } | undefined} config
 * @param {(cellX: number, cellZ: number) => number} tileAt
 * @param {number} tileSize metres per tile
 * @returns {((candidate: { x: number, z: number }) => boolean) | null}
 */
export function createBarrenEdgeExclusion(config, tileAt, tileSize) {
  const meters = Number(config?.meters) || 0;
  const barren = new Set(config?.tileIds ?? []);
  if (meters <= 0 || barren.size === 0) return null;
  const offsets = Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * meters, Math.sin(k * Math.PI / 4) * meters]);
  const barrenAt = (x, z) => barren.has(tileAt(Math.floor(x / tileSize), Math.floor(-z / tileSize)));
  // Plain loops: this runs per tree candidate, where `some` with a destructuring callback is garbage.
  return (candidate) => {
    for (let k = 0; k < offsets.length; k += 1) {
      if (barrenAt(candidate.x + offsets[k][0], candidate.z + offsets[k][1])) return true;
    }
    return false;
  };
}

/** Either exclusion refuses the candidate; null when neither applies. */
export function combineExclusions(...exclusions) {
  const active = exclusions.filter(Boolean);
  if (active.length === 0) return null;
  return (candidate, habitat) => {
    for (let k = 0; k < active.length; k += 1) if (active[k](candidate, habitat)) return true;
    return false;
  };
}
