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

export function normalizeForestEditDocument(document = {}) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Forest edits must be an object.');
  }
  if (document.version != null && document.version !== 1) {
    throw new Error(`Unsupported forest edit version: ${document.version}.`);
  }
  if (document.felled !== undefined && !Array.isArray(document.felled)) {
    throw new Error('Forest felled edits must be an array.');
  }
  if (document.planted !== undefined && !Array.isArray(document.planted)) {
    throw new Error('Forest planted edits must be an array.');
  }
  if (document.patches !== undefined && !Array.isArray(document.patches)) {
    throw new Error('Forest patch edits must be an array.');
  }

  const felled = [...new Set((document.felled ?? []).filter(
    (stableId) => typeof stableId === 'string' && stableId.length > 0,
  ))].sort();
  const planted = new Map();
  for (const record of document.planted ?? []) {
    const normalized = normalizePlant(record);
    planted.set(normalized.stableId, normalized);
  }
  const patches = new Map();
  for (const patch of document.patches ?? []) {
    if (typeof patch?.patchId !== 'string' || !VALID_PATCH_STATES.has(patch.state)) continue;
    patches.set(patch.patchId, Object.freeze({
      patchId: patch.patchId,
      state: patch.state,
      progress: Math.min(1, Math.max(0, Number(patch.progress) || 0)),
    }));
  }

  return Object.freeze({
    version: 1,
    felled: Object.freeze(felled),
    planted: Object.freeze(
      [...planted.values()].sort((left, right) => left.stableId.localeCompare(right.stableId)),
    ),
    patches: Object.freeze(
      [...patches.values()].sort((left, right) => left.patchId.localeCompare(right.patchId)),
    ),
  });
}

export { VALID_PATCH_STATES };
