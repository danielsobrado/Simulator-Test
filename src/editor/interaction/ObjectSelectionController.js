import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';
import { ObjectSelectionModel } from './ObjectSelectionModel.js';
import { ObjectSelectionOverlay } from './ObjectSelectionOverlay.js';

const SELECTION_EVENT = 'drusniel:natural-selection-change';

function objectChange(before, after) {
  return Object.freeze({ kind: 'object', before, after });
}

function batchChange(changes) {
  return Object.freeze({ kind: 'object-batch', changes: Object.freeze(changes) });
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
  return { minX, minZ, maxX, maxZ, width: maxX - minX + 1, depth: maxZ - minZ + 1 };
}

export class ObjectSelectionController {
  constructor(controller, applyPrimarySelection) {
    this.controller = controller;
    this.applyPrimarySelection = applyPrimarySelection;
    this.model = new ObjectSelectionModel();
    this.overlay = new ObjectSelectionOverlay(controller.objectView);
    this.drag = null;
    this.returnTool = 'terrain';
  }

  get size() {
    return this.model.size;
  }

  get primaryId() {
    return this.model.primaryId;
  }

  ids() {
    return this.model.values();
  }

  objects() {
    return this.ids().map((id) => this.controller.objectMap.getById(id)).filter(Boolean);
  }

  emit() {
    const detail = Object.freeze({
      ids: Object.freeze(this.ids()),
      primaryId: this.primaryId,
      count: this.size,
    });
    globalThis.window?.dispatchEvent?.(new CustomEvent(SELECTION_EVENT, { detail }));
  }

  syncVisuals() {
    this.applyPrimarySelection(this.primaryId);
    this.overlay.sync(this.ids(), this.primaryId);
    this.emit();
  }

  replace(id) {
    const object = id == null ? null : this.controller.objectMap.getById(id);
    this.model.replace(object?.id ?? null);
    if (!object) this.drag = null;
    this.syncVisuals();
  }

  selectDirect(id, { additive = false } = {}) {
    const object = this.controller.objectMap.getById(id);
    if (!object) return false;
    if (additive) this.model.toggle(object.id);
    else if (this.model.has(object.id)) this.model.setPrimary(object.id);
    else this.model.replace(object.id);
    this.syncVisuals();
    return this.model.has(object.id);
  }

  clear() {
    this.model.clear();
    this.drag = null;
    this.syncVisuals();
  }

  retainExisting() {
    this.model.retain(this.ids().filter((id) => this.controller.objectMap.getById(id)));
    this.syncVisuals();
  }

  beginDirectDrag(id, event) {
    if (!this.model.has(id)) return false;
    this.model.setPrimary(id);
    this.syncVisuals();
    this.drag = {
      pointerId: event.pointerId,
      objectId: id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moving: false,
    };
    this.controller.canvas?.setPointerCapture?.(event.pointerId);
    return true;
  }

  updateDirectDrag(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (!drag.moving) {
      const distance = Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      );
      if (distance >= NATURAL_EDITOR_UI_CONFIG.selection.dragThresholdPx) {
        this.startMove();
        drag.moving = this.controller.movingObjectId === drag.objectId;
      }
    }
    return drag.moving;
  }

  finishDirectDrag(event) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (this.controller.canvas?.hasPointerCapture?.(event.pointerId)) {
      this.controller.canvas.releasePointerCapture(event.pointerId);
    }
    this.drag = null;

    if (event.type === 'pointercancel') {
      this.controller.movingObjectId = null;
      this.controller.updatePreviews();
      this.controller.emitState();
      return true;
    }

    if (drag.moving && this.controller.movingObjectId) {
      const cell = this.controller.terrainView.pickCell(
        event.clientX,
        event.clientY,
        this.controller.activeCamera,
      );
      if (cell) this.moveTo(cell);
      else {
        this.controller.movingObjectId = null;
        this.controller.updatePreviews();
        this.controller.emitState();
      }
      event.preventDefault();
    }
    return true;
  }

  startMove() {
    if (!this.primaryId) return;
    this.controller.movingObjectId = this.primaryId;
    this.controller.updatePreviews();
    this.controller.emitState();
  }

  transformSelected(createTarget, label) {
    const originals = this.objects();
    if (originals.length === 0) return false;
    const snapshot = this.controller.objectMap.list();
    const targets = originals.map(createTarget);
    try {
      for (const object of originals) this.controller.objectMap.remove(object.id);
      for (const target of targets) {
        const validation = this.controller.validateObjectPlacement(target);
        if (!validation.valid) throw new Error(validation.reason);
        this.controller.objectMap.restore(target);
      }
    } catch (error) {
      this.controller.objectMap.replaceAll(snapshot);
      this.controller.emitNotice(error.message, true);
      return false;
    }

    const changes = originals.map((before, index) => objectChange(before, targets[index]));
    this.controller.commitHistory(batchChange(changes));
    this.controller.movingObjectId = null;
    this.controller.refreshObjects();
    this.controller.emitMap();
    this.controller.emitNotice(`${label} ${changes.length} object${changes.length === 1 ? '' : 's'}.`);
    return true;
  }

  moveTo(cell) {
    const primary = this.primaryId ? this.controller.objectMap.getById(this.primaryId) : null;
    if (!primary) {
      this.controller.movingObjectId = null;
      return false;
    }
    const deltaX = cell.x - primary.x;
    const deltaZ = cell.z - primary.z;
    if (deltaX === 0 && deltaZ === 0) {
      this.controller.movingObjectId = null;
      this.controller.updatePreviews();
      this.controller.emitState();
      return false;
    }
    return this.transformSelected(
      (object) => ({ ...object, x: object.x + deltaX, z: object.z + deltaZ }),
      'Moved',
    );
  }

  rotate() {
    return this.transformSelected(
      (object) => ({ ...object, rotation: (object.rotation + 1) % 4 }),
      'Rotated',
    );
  }

  delete() {
    const originals = this.objects();
    if (originals.length === 0) return false;
    for (const object of originals) this.controller.objectMap.remove(object.id);
    this.model.clear();
    this.drag = null;
    this.controller.movingObjectId = null;
    this.controller.commitHistory(batchChange(originals.map((before) => objectChange(before, null))));
    this.controller.refreshObjects();
    this.syncVisuals();
    this.controller.emitMap();
    this.controller.emitNotice(`Deleted ${originals.length} object${originals.length === 1 ? '' : 's'}.`);
    return true;
  }

  duplicate() {
    const originals = this.objects();
    if (originals.length === 0) return false;
    const bounds = boundsForObjects(this.controller.objectMap, originals);
    const gap = NATURAL_EDITOR_UI_CONFIG.selection.duplicateGapCells;
    const offsets = [
      [bounds.width + gap, 0],
      [0, bounds.depth + gap],
      [-(bounds.width + gap), 0],
      [0, -(bounds.depth + gap)],
    ];
    const snapshot = this.controller.objectMap.list();

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
        this.model.clear();
        for (const object of created) this.model.add(object.id);
        this.controller.commitHistory(batchChange(created.map((after) => objectChange(null, after))));
        this.controller.refreshObjects();
        this.syncVisuals();
        this.controller.emitMap();
        this.controller.emitNotice(`Duplicated ${created.length} object${created.length === 1 ? '' : 's'}.`);
        return true;
      } catch {
        this.controller.objectMap.replaceAll(snapshot);
      }
    }

    this.controller.emitNotice('No nearby space is available for this duplicate.', true);
    return false;
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
    } catch (error) {
      this.controller.objectMap.replaceAll(snapshot);
      throw error;
    }
    const targets = changes
      .map((change) => direction === 'undo' ? change.before : change.after)
      .filter(Boolean);
    this.model.clear();
    for (const target of targets) this.model.add(target.id);
    this.controller.refreshObjects();
    this.syncVisuals();
  }

  dispose() {
    this.overlay.dispose();
    this.drag = null;
  }
}

export { SELECTION_EVENT };
