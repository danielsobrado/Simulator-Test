import {
  VALID_PATCH_STATES,
  normalizeForestEditDocument,
} from '../../forest/ForestEditDocument.js';

export class ForestEditStore {
  constructor(document = null) {
    this.felled = new Set();
    this.planted = new Map();
    this.patchStates = new Map();
    this.revision = 0;
    if (document) this.loadDocument(document);
  }

  fell(stableId) {
    if (typeof stableId !== 'string' || stableId.length === 0) return false;
    const previous = this.felled.size;
    this.felled.add(stableId);
    if (this.felled.size !== previous) this.revision += 1;
    return this.felled.size !== previous;
  }

  restore(stableId) {
    const removed = this.felled.delete(stableId);
    if (removed) this.revision += 1;
    return removed;
  }

  plant(record) {
    const normalized = normalizeForestEditDocument({ planted: [record] }).planted[0];
    this.planted.set(normalized.stableId, normalized);
    this.revision += 1;
    return normalized;
  }

  removePlant(stableId) {
    const removed = this.planted.delete(stableId);
    if (removed) this.revision += 1;
    return removed;
  }

  setPatchState(patchId, state, progress = 0) {
    if (typeof patchId !== 'string' || !VALID_PATCH_STATES.has(state)) {
      throw new Error('Forest patch state must identify a patch and use a supported state.');
    }
    this.patchStates.set(patchId, Object.freeze({
      state,
      progress: Math.min(1, Math.max(0, Number(progress) || 0)),
    }));
    this.revision += 1;
  }

  allows(record) {
    if (this.felled.has(record.stableId)) return false;
    const patch = this.patchStates.get(record.patchId);
    if (!patch) return true;
    if (patch.state === 'cleared') return false;
    if (patch.state === 'burned') return record.priority < patch.progress * 0.15;
    return record.priority < Math.max(record.forestSuitability ?? 0, patch.progress);
  }

  plantedForChunk(chunkX, chunkZ, chunkWorldSize) {
    const minimumX = chunkX * chunkWorldSize;
    const maximumX = (chunkX + 1) * chunkWorldSize;
    const maximumZ = -chunkZ * chunkWorldSize;
    const minimumZ = -(chunkZ + 1) * chunkWorldSize;
    return [...this.planted.values()].filter((record) => (
      record.x >= minimumX
      && record.x < maximumX
      && record.z >= minimumZ
      && record.z < maximumZ
    ));
  }

  toDocument() {
    return normalizeForestEditDocument({
      version: 1,
      felled: [...this.felled],
      planted: [...this.planted.values()],
      patches: [...this.patchStates.entries()].map(([patchId, value]) => ({ patchId, ...value })),
    });
  }

  loadDocument(document = {}) {
    const normalized = normalizeForestEditDocument(document);
    this.felled = new Set(normalized.felled);
    this.planted = new Map(normalized.planted.map((record) => [record.stableId, record]));
    this.patchStates = new Map(normalized.patches.map((patch) => [
      patch.patchId,
      Object.freeze({ state: patch.state, progress: patch.progress }),
    ]));
    this.revision += 1;
  }
}
