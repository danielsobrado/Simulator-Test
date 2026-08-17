import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

function objectChange(before, after) {
  return Object.freeze({ kind: 'object', before, after });
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

export function createObjectBatchHistory(changes) {
  return Object.freeze({ kind: 'object-batch', changes: Object.freeze(changes) });
}

export class ObjectBatchEditor {
  constructor(controller) {
    this.controller = controller;
  }

  transform(originals, createTarget) {
    if (originals.length === 0) return { ok: false, error: null, changes: [] };
    const snapshot = this.controller.objectMap.list();
    const targets = originals.map(createTarget);
    try {
      for (const object of originals) this.controller.objectMap.remove(object.id);
      for (const target of targets) {
        const validation = this.controller.validateObjectPlacement(target);
        if (!validation.valid) throw new Error(validation.reason);
        this.controller.objectMap.restore(target);
      }
      return {
        ok: true,
        error: null,
        changes: originals.map((before, index) => objectChange(before, targets[index])),
      };
    } catch (error) {
      this.controller.objectMap.replaceAll(snapshot);
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
    const snapshot = this.controller.objectMap.list();
    let lastError = null;

    for (const [deltaX, deltaZ] of offsets) {
      const created = [];
      try {
        for (const source of originals) {
          const candidate = {
            definitionKey: source.definitionKey,
            x: source.x + deltaX,
            z: source.z + deltaZ,
            rotation: source.rotation,
          };
          const validation = this.controller.validateObjectPlacement(candidate);
          if (!validation.valid) throw new Error(validation.reason);
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
        this.controller.objectMap.replaceAll(snapshot);
      }
    }

    return { ok: false, created: [], changes: [], error: lastError };
  }

  applyHistory(entry, direction) {
    const snapshot = this.controller.objectMap.list();
    const changes = direction === 'undo' ? [...entry.changes].reverse() : entry.changes;
    try {
      for (const change of changes) {
        const source = direction === 'undo' ? change.after : change.before;
        if (source) this.controller.objectMap.remove(source.id);
      }
      for (const change of changes) {
        const target = direction === 'undo' ? change.before : change.after;
        if (target) this.controller.objectMap.restore(target);
      }
      return changes
        .map((change) => direction === 'undo' ? change.before : change.after)
        .filter(Boolean);
    } catch (error) {
      this.controller.objectMap.replaceAll(snapshot);
      throw error;
    }
  }
}
