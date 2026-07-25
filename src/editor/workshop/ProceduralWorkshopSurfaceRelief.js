/**
 * Coarse record of how far masonry stands proud of its nominal wall surface.
 *
 * Added 2026-07-25. Vegetation is generated in facade space against the *nominal*
 * surface — a plane or a cylinder — so it is blind to the individual stones. Once
 * stones gained an out-of-plane protrusion lane, vines and leaves began passing
 * through any stone laid proud of the face. On a flat wall the nominal ivy stand-off
 * is about 1% of wall depth while protrusion reaches roughly 15% of a stone's
 * smallest face dimension, so at default irregularity the clash is routine, not an
 * edge case.
 *
 * The masonry pass records each stone's protrusion here; the vegetation pass
 * samples it and stands off by the local maximum. That gives the surface-adhesion
 * behaviour of a ray-cast against the real geometry at O(1) per query and with no
 * dependency on Three.js, raycasting, or a BVH.
 *
 * Positions are facade-space: `x` runs along the surface (arc length on a round
 * host, matching `ProceduralWorkshopIvy`), `y` is height.
 */

const DEFAULT_CELL_SIZE = 0.34;

function cellKey(column, row) {
  return `${column}:${row}`;
}

export function createSurfaceRelief({ cellSize = DEFAULT_CELL_SIZE } = {}) {
  const cells = new Map();
  const size = cellSize > 0 ? cellSize : DEFAULT_CELL_SIZE;

  return {
    cellSize: size,

    /**
     * Record one stone's outward offset. Only positive protrusion matters —
     * a recessed stone cannot push vegetation outward.
     */
    record(facadeX, y, outward) {
      if (!Number.isFinite(facadeX) || !Number.isFinite(y)) return;
      if (!Number.isFinite(outward) || outward <= 0) return;
      const key = cellKey(Math.round(facadeX / size), Math.round(y / size));
      const existing = cells.get(key);
      if (existing === undefined || outward > existing) cells.set(key, outward);
    },

    /**
     * Largest protrusion near a facade point.
     *
     * Samples the 3x3 cell neighbourhood so a vine approaching a proud stone
     * lifts before it reaches it, rather than clipping its edge and popping out.
     */
    sample(facadeX, y) {
      if (cells.size === 0) return 0;
      if (!Number.isFinite(facadeX) || !Number.isFinite(y)) return 0;
      const column = Math.round(facadeX / size);
      const row = Math.round(y / size);
      let maximum = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const found = cells.get(cellKey(column + dx, row + dy));
          if (found !== undefined && found > maximum) maximum = found;
        }
      }
      return maximum;
    },

    get size() {
      return cells.size;
    },
  };
}
