const VALID_PATCH_STATES = new Set(['burned', 'regrowing', 'cleared']);

function normalizePlant(record) {
  if (!record || typeof record.stableId !== 'string' || record.stableId.length === 0) {
    throw new Error('Planted forests require a stableId.');
  }
  if (!Number.isFinite(record.x) || !Number.isFinite(record.z)) {
    throw new Error('Planted forest coordinates must be finite.');
  }
  return Object.freeze({
    stableId: record.stableId,
    x: record.x,
    z: record.z,
    speciesId: String(record.speciesId ?? 'broadleaf_round'),
    ageClass: String(record.ageClass ?? 'sapling'),
    plantedAt: Number.isFinite(record.plantedAt) ? record.plantedAt : 0,
  });
}

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
    const planted = normalizePlant(record);
    this.planted.set(planted.stableId, planted);
    this.revision += 1;
    return planted;
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
    return {
      version: 1,
      felled: [...this.felled].sort(),
      planted: [...this.planted.values()].sort((a, b) => a.stableId.localeCompare(b.stableId)),
      patches: [...this.patchStates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([patchId, value]) => ({ patchId, ...value })),
    };
  }

  loadDocument(document = {}) {
    const felled = new Set();
    for (const stableId of document.felled ?? []) {
      if (typeof stableId === 'string' && stableId.length > 0) felled.add(stableId);
    }
    const planted = new Map();
    for (const record of document.planted ?? []) {
      const normalized = normalizePlant(record);
      planted.set(normalized.stableId, normalized);
    }
    const patchStates = new Map();
    for (const patch of document.patches ?? []) {
      if (typeof patch?.patchId !== 'string' || !VALID_PATCH_STATES.has(patch.state)) continue;
      patchStates.set(patch.patchId, Object.freeze({
        state: patch.state,
        progress: Math.min(1, Math.max(0, Number(patch.progress) || 0)),
      }));
    }
    this.felled = felled;
    this.planted = planted;
    this.patchStates = patchStates;
    this.revision += 1;
  }
}
