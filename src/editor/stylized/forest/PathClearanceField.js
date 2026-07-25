import { TileDistanceField } from './TileDistanceField.js';

/**
 * Keeps trees, bushes and boulders off roads and their shoulders. A thin policy
 * layer over `TileDistanceField`: the cleared band is measured from the canonical
 * tile map, so it matches the painted path exactly and never depends on which
 * chunks happen to be resident.
 */
export class PathClearanceField {
  constructor({
    tileAt,
    tileSize,
    chunkSize,
    roadTileId = 13,
    clearCells = 3,
    revisionProvider = null,
  }) {
    this.clearCells = Math.max(0, Number(clearCells) || 0);
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
    this.signature = this.field.signature;
  }

  get enabled() {
    return this.clearCells > 0;
  }

  get stats() {
    return this.field.stats;
  }

  distanceAt(worldX, worldZ) {
    return this.field.cellDistanceAt(worldX, worldZ);
  }

  blocks(worldX, worldZ) {
    return this.distanceAt(worldX, worldZ) < this.clearCells;
  }

  /** Rejection predicate in the shape `createForestPlacementEvaluator` expects. */
  exclusion() {
    if (!this.enabled) return null;
    return (candidate) => this.blocks(candidate.x, candidate.z);
  }
}
