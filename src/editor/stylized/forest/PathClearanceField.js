import { TileDistanceField } from './TileDistanceField.js';
import {
  naturalTrailMaskAt,
  normalizeNaturalTrailConfig,
} from '../naturalTrailMath.js';

/**
 * Keeps trees, bushes and boulders off roads and their shoulders. Authored roads
 * are measured from the canonical tile map; deterministic natural trails use the
 * same continuous field as the materials. Neither depends on resident chunks.
 */
export class PathClearanceField {
  constructor({
    tileAt,
    tileSize,
    chunkSize,
    roadTileId = 13,
    clearCells = 3,
    naturalTrail = null,
    revisionProvider = null,
  }) {
    this.clearCells = Math.max(0, Number(clearCells) || 0);
    this.naturalTrail = normalizeNaturalTrailConfig(naturalTrail ?? {});
    this.field = new TileDistanceField({
      tileAt,
      tileSize,
      chunkSize,
      targetTileId: roadTileId,
      maxCells: this.clearCells,
      label: 'path',
      revisionProvider,
    });
    this.roadTileId = roadTileId;
    this.signature = [
      this.field.signature,
      'natural-trail',
      this.naturalTrail.enabled ? 1 : 0,
      this.naturalTrail.scale,
      this.naturalTrail.level,
      this.naturalTrail.width,
      this.naturalTrail.softness,
      this.naturalTrail.warp,
      this.naturalTrail.clearThreshold,
    ].join(':');
  }

  get enabled() {
    return this.clearCells > 0 || this.naturalTrail.enabled;
  }

  get stats() {
    return this.field.stats;
  }

  distanceAt(worldX, worldZ) {
    return this.field.cellDistanceAt(worldX, worldZ);
  }

  blocks(worldX, worldZ) {
    const roadBlocked = this.clearCells > 0
      && this.distanceAt(worldX, worldZ) < this.clearCells;
    if (roadBlocked) return true;
    return this.naturalTrail.enabled
      && naturalTrailMaskAt(worldX, worldZ, this.naturalTrail)
        >= this.naturalTrail.clearThreshold;
  }

  /** Rejection predicate in the shape `createForestPlacementEvaluator` expects. */
  exclusion() {
    if (!this.enabled) return null;
    return (candidate) => this.blocks(candidate.x, candidate.z);
  }
}
