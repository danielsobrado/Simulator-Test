import { closestPointOnCubicBezierPath, sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';

/**
 * The walkable surface of a construction, as a height field.
 *
 * No rigid bodies and no per-stone colliders: doc 18 invariant 7 is explicit
 * that simulation uses structural intent, never render stones. A wall top is a
 * height field over a narrow ribbon, and the player controller already consumes
 * a height field — so this composes into the one function it calls.
 */

/** Cells of the rejection grid, per record bounding box. */
const GRID_RESOLUTION = 48;
/** Records kept resolved at once; the player is only ever near a few. */
const MAX_CACHED = 8;

export class ConstructionGroundProvider {
  constructor({ store, spatialIndex, terrainView }) {
    this.store = store;
    this.spatialIndex = spatialIndex;
    this.terrainView = terrainView;
    this.chunkWorldSize = spatialIndex?.chunkWorldSize ?? 64;
    this.cache = new Map();
    /** Query counters — the grid rejection rate is what keeps this affordable. */
    this.stats = { queries: 0, gridRejected: 0, curveSearches: 0 };
  }

  /**
   * Resolve a record's arc table, top profile and a coarse occupancy grid.
   *
   * `closestPointOnCubicBezierPath` is a 64-step brute force **per segment**
   * (`CubicBezierPath.js:312`), so a 40-segment wall costs 2560 evaluations —
   * far too much for a physics step. The grid rejects the common case (a point
   * nowhere near the ribbon) with one array lookup.
   */
  resolve(record) {
    const cached = this.cache.get(record.id);
    if (cached && cached.revision === record.revision) return cached;

    const sampled = sampleCubicBezierPath(record.path, { chordError: 0.08, maxSpacing: 0.5 });
    const arcTable = createCurveArcTable(sampled);
    const profile = createWallTopProfile(record, arcTable);
    const half = record.dimensions.thickness / 2;

    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const point of sampled.points) {
      minX = Math.min(minX, point.x);
      minZ = Math.min(minZ, point.z);
      maxX = Math.max(maxX, point.x);
      maxZ = Math.max(maxZ, point.z);
    }
    const margin = half + 0.5;
    minX -= margin; minZ -= margin; maxX += margin; maxZ += margin;
    const cellX = (maxX - minX) / GRID_RESOLUTION;
    const cellZ = (maxZ - minZ) / GRID_RESOLUTION;
    const occupied = new Uint8Array(GRID_RESOLUTION * GRID_RESOLUTION);
    // Stamp every sample's neighbourhood; the ribbon is narrow so a small
    // dilation covers its width without a polygon rasteriser.
    const reach = Math.ceil((half + Math.max(cellX, cellZ)) / Math.min(cellX, cellZ)) + 1;
    for (const point of sampled.points) {
      const gx = Math.floor((point.x - minX) / cellX);
      const gz = Math.floor((point.z - minZ) / cellZ);
      for (let dz = -reach; dz <= reach; dz += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const x = gx + dx;
          const z = gz + dz;
          if (x < 0 || z < 0 || x >= GRID_RESOLUTION || z >= GRID_RESOLUTION) continue;
          occupied[z * GRID_RESOLUTION + x] = 1;
        }
      }
    }

    const entry = {
      revision: record.revision,
      record,
      arcTable,
      profile,
      half,
      bounds: { minX, minZ, maxX, maxZ, cellX, cellZ },
      occupied,
    };
    this.cache.set(record.id, entry);
    if (this.cache.size > MAX_CACHED) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return entry;
  }

  /** Height of the wall surface at a canonical point, or null if not over one. */
  heightAt(canonicalX, canonicalZ) {
    this.stats.queries += 1;
    const records = this.candidates(canonicalX, canonicalZ);
    let best = null;
    for (const record of records) {
      if (record.path.type !== 'cubicBezier') continue;
      const entry = this.resolve(record);
      const { minX, minZ, maxX, maxZ, cellX, cellZ } = entry.bounds;
      if (canonicalX < minX || canonicalX > maxX || canonicalZ < minZ || canonicalZ > maxZ) {
        this.stats.gridRejected += 1;
        continue;
      }
      const gx = Math.min(GRID_RESOLUTION - 1, Math.floor((canonicalX - minX) / cellX));
      const gz = Math.min(GRID_RESOLUTION - 1, Math.floor((canonicalZ - minZ) / cellZ));
      if (!entry.occupied[gz * GRID_RESOLUTION + gx]) {
        this.stats.gridRejected += 1;
        continue;
      }

      this.stats.curveSearches += 1;
      const closest = closestPointOnCubicBezierPath(record.path, { x: canonicalX, z: canonicalZ });
      if (!closest || closest.distance > entry.half) continue;
      const arcFraction = entry.arcTable.arcFractionForParameter(closest.segmentId, closest.t);
      const s = entry.arcTable.toArc(closest.segmentId, arcFraction);
      // The profile is relative to grade, so the surface sits on the terrain
      // under the wall's own centreline rather than under the player's feet.
      const ground = this.terrainView?.getCanonicalHeight?.(closest.x, closest.z) ?? 0;
      // Crenellations are deliberately not collided against: `heightAt` returns
      // the merlon base, so the player walks the wall-walk between them. That
      // is both the right gameplay answer and much cheaper than a per-merlon
      // test.
      const surface = ground + entry.profile.heightAt(s);
      if (best === null || surface > best) best = surface;
    }
    return best;
  }

  candidates(canonicalX, canonicalZ) {
    if (!this.spatialIndex || !this.store) return this.store?.list() ?? [];
    const chunkX = Math.floor(canonicalX / this.chunkWorldSize);
    const chunkZ = Math.floor(canonicalZ / this.chunkWorldSize);
    const ids = this.spatialIndex.list(chunkX, chunkZ) ?? [];
    const records = [];
    for (const id of ids) {
      const record = this.store.get(id);
      if (record) records.push(record);
    }
    return records;
  }

  /**
   * Compose with terrain. `Math.max` rather than "the wall wins" so a wall that
   * dips below grade on a slope can never drop the player into the ground.
   */
  createGroundHeightFn(terrainHeightAt) {
    return (x, z) => {
      const terrain = terrainHeightAt(x, z);
      const wall = this.heightAt(x, z);
      return wall === null ? terrain : Math.max(terrain, wall);
    };
  }

  invalidate(constructionId = null) {
    if (constructionId) this.cache.delete(constructionId);
    else this.cache.clear();
  }
}
