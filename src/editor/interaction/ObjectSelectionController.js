import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';
import {
  ObjectBatchEditor,
  createObjectBatchHistory,
  rotateObjectAroundPrimary,
} from './ObjectBatchEditor.js';
import { ObjectMarqueeSelection } from './ObjectMarqueeSelection.js';
import { OBJECT_SELECTION_CHANGED_EVENT } from './ObjectSelectionEvents.js';
import { ObjectSelectionModel } from './ObjectSelectionModel.js';
import { ObjectSelectionOverlay } from './ObjectSelectionOverlay.js';

export class ObjectSelectionController {
  constructor(controller, applyPrimarySelection) {
    this.controller = controller;
    this.applyPrimarySelection = applyPrimarySelection;
    this.model = new ObjectSelectionModel();
    this.overlay = new ObjectSelectionOverlay(controller.objectView);
    this.batchEditor = new ObjectBatchEditor(controller);
    this.marquee = new ObjectMarqueeSelection(controller, this);
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
    globalThis.window?.dispatchEvent?.(
      new CustomEvent(OBJECT_SELECTION_CHANGED_EVENT, { detail }),
    );
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

  addMany(ids) {
    const previousPrimary = this.primaryId;
    let changed = false;
    for (const id of ids) {
      if (!this.controller.objectMap.getById(id)) continue;
      changed = this.model.add(id) || changed;
    }
    if (previousPrimary !== null && this.model.has(previousPrimary)) {
      this.model.setPrimary(previousPrimary);
    }
    if (changed) this.syncVisuals();
    return changed;
  }

  clear() {
    this.model.clear();
    this.drag = null;
    this.marquee.cancel();
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
      this.cancelMove();
      return true;
    }

    if (drag.moving && this.controller.movingObjectId) {
      const cell = this.controller.terrainView.pickCell(
        event.clientX,
        event.clientY,
        this.controller.activeCamera,
      );
      if (cell) this.moveTo(cell);
      else this.cancelMove();
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

  cancelMove() {
    this.controller.movingObjectId = null;
    this.controller.updatePreviews();
    this.controller.emitState();
  }

  commitTransform(createTarget, label) {
    const result = this.batchEditor.transform(this.objects(), createTarget);
    if (!result.ok) {
      this.cancelMove();
      if (result.error) this.controller.emitNotice(result.error.message, true);
      return false;
    }
    this.controller.commitHistory(createObjectBatchHistory(result.changes));
    this.controller.movingObjectId = null;
    this.controller.refreshObjects();
    this.controller.emitMap();
    this.controller.emitNotice(
      `${label} ${result.changes.length} object${result.changes.length === 1 ? '' : 's'}.`,
    );
    return true;
  }

  moveTo(cell) {
    const primary = this.primaryId ? this.controller.objectMap.getById(this.primaryId) : null;
    if (!primary) {
      this.cancelMove();
      return false;
    }
    const deltaX = cell.x - primary.x;
    const deltaZ = cell.z - primary.z;
    if (deltaX === 0 && deltaZ === 0) {
      this.cancelMove();
      return false;
    }
    return this.commitTransform(
      (object) => ({ ...object, x: object.x + deltaX, z: object.z + deltaZ }),
      'Moved',
    );
  }

  rotate() {
    const primary = this.primaryId ? this.controller.objectMap.getById(this.primaryId) : null;
    if (!primary) return false;
    return this.commitTransform(
      (object) => rotateObjectAroundPrimary(object, primary),
      'Rotated',
    );
  }

  delete() {
    const originals = this.objects();
    if (originals.length === 0) return false;
    const changes = this.batchEditor.delete(originals);
    if (changes.length === 0) return false;
    this.model.clear();
    this.drag = null;
    this.controller.movingObjectId = null;
    this.controller.commitHistory(createObjectBatchHistory(changes));
    this.controller.refreshObjects();
    this.syncVisuals();
    this.controller.emitMap();
    this.controller.emitNotice(`Deleted ${changes.length} object${changes.length === 1 ? '' : 's'}.`);
    return true;
  }

  duplicate() {
    const originals = this.objects();
    const primaryIndex = originals.findIndex(({ id }) => id === this.primaryId);
    const result = this.batchEditor.duplicate(originals);
    if (!result.ok) {
      this.controller.emitNotice('No nearby space is available for this duplicate.', true);
      return false;
    }
    this.model.clear();
    for (const object of result.created) this.model.add(object.id);
    if (primaryIndex >= 0 && result.created[primaryIndex]) {
      this.model.setPrimary(result.created[primaryIndex].id);
    }
    this.controller.commitHistory(createObjectBatchHistory(result.changes));
    this.controller.refreshObjects();
    this.syncVisuals();
    this.controller.emitMap();
    this.controller.emitNotice(
      `Duplicated ${result.created.length} object${result.created.length === 1 ? '' : 's'}.`,
    );
    return true;
  }

  applyHistory(entry, direction) {
    const targets = this.batchEditor.applyHistory(entry, direction);
    this.model.clear();
    for (const target of targets) this.model.add(target.id);
    this.controller.refreshObjects();
    this.syncVisuals();
  }

  dispose() {
    this.marquee.dispose();
    this.overlay.dispose();
    this.drag = null;
  }
}
