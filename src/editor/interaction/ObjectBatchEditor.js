import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

function freezeObjectSnapshot(object) {
  return object ? Object.freeze({ ...object }) : null;
}

function objectChange(before, after) {
  return Object.freeze({
    kind: 'object',
    before: freezeObjectSnapshot(before),
    after: freezeObjectSnapshot(after),
  });
}

function freezeSelectionSnapshot(snapshot) {
  if (!snapshot) return null;
  const ids = [];
  const seen = new Set();
  for (const id of snapshot.ids ?? []) {
    if (!Number.isSafeInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  const requestedPrimary = snapshot.primaryId;
  const primaryId = ids.includes(requestedPrimary) ? requestedPrimary : ids[0] ?? null;
  return Object.freeze({ ids: Object.freeze(ids), primaryId });
}

function boundsForObjects(objectMap, objects) {
  if (objects.length === 0) return null;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const object of objects) {
    const bounds = objectMap.getBounds(object.x, object.z, object.definitionKey, object.rotation);
    minX = Math.min(minX, bounds.minX);
    minZ = Math.min(minZ, bounds.minZ);
    maxX = Math.max(maxX, bounds.maxX);
    maxZ = Math.max(maxZ, bounds.maxZ);
  }
  return { width: maxX - minX + 1, depth: maxZ - minZ + 1 };
}

function assertGroupFootprintsDoNotOverlap(objectMap, objects) {
  const occupied = new Set();
  for (const object of objects) {
    for (const cell of objectMap.getCells(
      object.x,
      object.z,
      object.definitionKey,
      object.rotation,
    )) {
      const key = `${cell.x}:${cell.z}`;
      if (occupied.has(key)) throw new Error('Selection members would overlap each other.');
      occupied.add(key);
    }
  }
}

function removeExisting(objectMap, objects) {
  for (const object of objects) objectMap.remove(object.id);
}

function restoreAll(objectMap, objects) {
  for (const object of objects) objectMap.restore(object);
}

function rollbackReplacement(objectMap, targets, originals) {
  removeExisting(objectMap, targets);
  restoreAll(objectMap, originals);
}

export function rotateObjectAroundPrimary(object, primary) {
  const deltaX = object.x - primary.x;
  const deltaZ = object.z - primary.z;
  return {
    ...object,
    x: primary.x - deltaZ,
    z: primary.z + deltaX,
    rotation: (object.rotation + 1) % 4,
  };
}

export function createObjectBatchHistory(
  changes,
  { beforeSelection = null, afterSelection = null } = {},
) {
  return Object.freeze({
    kind: 'object-batch',
    changes: Object.freeze([...changes]),
    beforeSelection: freezeSelectionSnapshot(beforeSelection),
    afterSelection: freezeSelectionSnapshot(afterSelection),
  });
}

export class ObjectBatchEditor {
  constructor(controller) {
    this.controller = controller;
  }

  validateTargets(targets) {
    assertGroupFootprintsDoNotOverlap(this.controller.objectMap, targets);
    for (const target of targets) {
      const validation = this.controller.validateObjectPlacement(target);
      if (!validation.valid) throw new Error(validation.reason);
    }
  }

  transform(originals, createTarget) {
    if (originals.length === 0) return { ok: false, error: null, changes: [] };
    const targets = originals.map(createTarget);
    removeExisting(this.controller.objectMap, originals);
    try {
      this.validateTargets(targets);
      restoreAll(this.controller.objectMap, targets);
      return {
        ok: true,
        error: null,
        changes: originals.map((before, index) => objectChange(before, targets[index])),
      };
    } catch (error) {
      rollbackReplacement(this.controller.objectMap, targets, originals);
      return { ok: false, error, changes: [] };
    }
  }

  delete(originals) {
    const changes = [];
    for (const before of originals) {
      const removed = this.controller.objectMap.remove(before.id);
      if (removed) changes.push(objectChange(removed, null));
    }
    return changes;
  }

  duplicate(originals) {
    if (originals.length === 0) return { ok: false, created: [], error: null };
    const bounds = boundsForObjects(this.controller.objectMap, originals);
    const gap = NATURAL_EDITOR_UI_CONFIG.selection.duplicateGapCells;
    const offsets = [
      [bounds.width + gap, 0],
      [0, bounds.depth + gap],
      [-(bounds.width + gap), 0],
      [0, -(bounds.depth + gap)],
    ];
    let lastError = null;

    for (const [deltaX, deltaZ] of offsets) {
      const candidates = originals.map((source) => ({
        definitionKey: source.definitionKey,
        x: source.x + deltaX,
        z: source.z + deltaZ,
        rotation: source.rotation,
      }));
      try {
        this.validateTargets(candidates);
      } catch (error) {
        lastError = error;
        continue;
      }

      const created = [];
      try {
        for (const candidate of candidates) {
          created.push(this.controller.objectMap.place(candidate));
        }
        return {
          ok: true,
          created,
          error: null,
          changes: created.map((after) => objectChange(null, after)),
        };
      } catch (error) {
        lastError = error;
        removeExisting(this.controller.objectMap, created);
      }
    }

    return { ok: false, created: [], changes: [], error: lastError };
  }

  applyHistory(entry, direction) {
    const changes = entry.changes;
    const sources = changes
      .map((change) => direction === 'undo' ? change.after : change.before)
      .filter(Boolean);
    const targets = changes
      .map((change) => direction === 'undo' ? change.before : change.after)
      .filter(Boolean);
    removeExisting(this.controller.objectMap, sources);
    try {
      restoreAll(this.controller.objectMap, targets);
      return targets;
    } catch (error) {
      rollbackReplacement(this.controller.objectMap, targets, sources);
      throw error;
    }
  }
}
