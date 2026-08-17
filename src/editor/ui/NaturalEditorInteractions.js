import { EditorController } from '../EditorController.js';

const PATCH_MARK = Symbol.for('drusniel.natural-editor-interactions');
const PRIMARY_POINTER_BUTTON = 0;
const DEFAULT_RETURN_TOOL = 'terrain';
const OBJECT_DRAG_DISTANCE_PX = 5;

function effectiveTerrainGestureMode(event) {
  if (event.ctrlKey || event.metaKey) return 'smooth';
  if (event.shiftKey) return 'lower';
  return null;
}

function historyLabel(entry) {
  switch (entry?.kind) {
    case 'terrain': return 'terrain paint';
    case 'height': return 'terrain sculpt';
    case 'object': return 'object edit';
    case 'construction':
    case 'construction-batch': return 'construction edit';
    case 'world': return 'world edit';
    default: return 'edit';
  }
}

function restoreSelectionTool(controller) {
  if (controller.tool !== 'select' || controller.selectedObjectId || controller.movingObjectId) return;
  controller.tool = controller.naturalReturnTool ?? DEFAULT_RETURN_TOOL;
  controller.updatePreviews();
  controller.emitState();
}

function restoreConstructionTool(controller) {
  const returnTool = controller.naturalConstructionReturnTool;
  if (!returnTool) return false;
  controller.naturalConstructionReturnTool = null;
  controller.setSelectedConstruction(null);
  controller.constructionGizmo?.close();
  controller.tool = returnTool;
  controller.updatePreviews();
  controller.emitState();
  return true;
}

function clearObjectDrag(controller, event) {
  controller.naturalObjectDrag = null;
  if (controller.canvas?.hasPointerCapture?.(event.pointerId)) {
    controller.canvas.releasePointerCapture(event.pointerId);
  }
}

function selectObjectDirectly(controller, objectId, event) {
  const returnTool = controller.naturalConstructionReturnTool
    ?? (controller.tool === 'select'
      ? controller.naturalReturnTool ?? DEFAULT_RETURN_TOOL
      : controller.tool);
  controller.naturalReturnTool = returnTool;
  controller.naturalConstructionReturnTool = null;
  if (controller.tool === 'construction') {
    controller.cancelConstructionGesture();
    controller.setSelectedConstruction(null);
    controller.constructionGizmo?.close();
  }
  controller.tool = 'select';
  controller.setSelectedObject(objectId);
  controller.naturalObjectDrag = {
    pointerId: event.pointerId,
    objectId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moving: false,
  };
  controller.canvas?.setPointerCapture?.(event.pointerId);
  controller.updatePreviews();
  controller.emitState();
  event.preventDefault();
}

function selectConstructionDirectly(controller, constructionId, event) {
  controller.naturalConstructionReturnTool = controller.tool === 'select'
    ? controller.naturalReturnTool ?? DEFAULT_RETURN_TOOL
    : controller.tool;
  controller.cancelConstructionGesture();
  controller.naturalObjectDrag = null;
  controller.setSelectedObject(null);
  controller.tool = 'construction';
  controller.constructionMode = 'edit';
  controller.setSelectedConstruction(constructionId);
  controller.constructionGizmo?.open(constructionId, event);
  controller.updatePreviews();
  controller.emitState();
  event.preventDefault();
}

function updateObjectDrag(controller, event) {
  const drag = controller.naturalObjectDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  if (!drag.moving) {
    const distance = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY,
    );
    if (distance >= OBJECT_DRAG_DISTANCE_PX) {
      controller.startMoveSelected();
      drag.moving = controller.movingObjectId === drag.objectId;
    }
  }
  return drag.moving;
}

function finishObjectDrag(controller, event) {
  const drag = controller.naturalObjectDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;

  if (event.type === 'pointercancel') {
    controller.movingObjectId = null;
    controller.updatePreviews();
    controller.emitState();
    clearObjectDrag(controller, event);
    return true;
  }

  if (drag.moving && controller.movingObjectId) {
    const cell = controller.terrainView.pickCell(
      event.clientX,
      event.clientY,
      controller.activeCamera,
    );
    if (cell) controller.moveSelectedTo(cell);
    else {
      controller.movingObjectId = null;
      controller.updatePreviews();
      controller.emitState();
    }
    event.preventDefault();
  }
  clearObjectDrag(controller, event);
  return true;
}

function installNaturalEditorInteractions() {
  const prototype = EditorController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const selectTool = prototype.selectTool;
  prototype.selectTool = function naturalSelectTool(tool) {
    if (tool !== 'select') this.naturalReturnTool = tool;
    this.naturalConstructionReturnTool = null;
    this.naturalObjectDrag = null;
    return selectTool.call(this, tool);
  };

  const constructionPointerDown = prototype.onConstructionPointerDown;
  prototype.onConstructionPointerDown = function naturalConstructionPointerDown(event) {
    if (this.constructionStore && this.constructionView) {
      const handle = this.constructionView.pickHandle(
        event.clientX,
        event.clientY,
        this.activeCamera,
      );
      const constructionId = handle
        ? handle.constructionId
        : this.constructionView.pickConstruction(
          event.clientX,
          event.clientY,
          this.activeCamera,
        );
      if (!handle && !constructionId && this.naturalConstructionReturnTool) {
        restoreConstructionTool(this);
        event.preventDefault();
        return;
      }
      this.constructionMode = handle || constructionId ? 'edit' : 'draw';
    }
    return constructionPointerDown.call(this, event);
  };

  const pointerDown = prototype.onPointerDown;
  prototype.onPointerDown = function naturalPointerDown(event) {
    if (
      !this.isWorldInputBlocked()
      && event.button === PRIMARY_POINTER_BUTTON
      && !this.spacePressed
      && !this.movingObjectId
    ) {
      if (!this.playerEditingProvider?.()) {
        const objectId = this.objectView.pickObject(
          event.clientX,
          event.clientY,
          this.activeCamera,
        );
        if (objectId) {
          selectObjectDirectly(this, objectId, event);
          return;
        }
      }

      if (this.tool !== 'construction' && this.constructionView && this.constructionStore) {
        const constructionId = this.constructionView.pickConstruction(
          event.clientX,
          event.clientY,
          this.activeCamera,
        );
        if (constructionId) {
          selectConstructionDirectly(this, constructionId, event);
          return;
        }
      }
    }

    const wasSelect = this.tool === 'select';
    const terrainGesture = (
      this.tool === 'terrain'
      && event.button === PRIMARY_POINTER_BUTTON
      && !this.spacePressed
    ) ? effectiveTerrainGestureMode(event) : null;
    const savedMode = this.terrainMode;
    if (terrainGesture) {
      this.naturalTerrainGestureMode = terrainGesture;
      this.terrainMode = terrainGesture;
    }
    try {
      return pointerDown.call(this, event);
    } finally {
      if (terrainGesture) this.terrainMode = savedMode;
      if (wasSelect) restoreSelectionTool(this);
    }
  };

  const pointerMove = prototype.onPointerMove;
  prototype.onPointerMove = function naturalPointerMove(event) {
    updateObjectDrag(this, event);
    if (!this.naturalTerrainGestureMode) return pointerMove.call(this, event);
    const savedMode = this.terrainMode;
    this.terrainMode = this.naturalTerrainGestureMode;
    try {
      return pointerMove.call(this, event);
    } finally {
      this.terrainMode = savedMode;
    }
  };

  const editTerrainFromPointer = prototype.editTerrainFromPointer;
  prototype.editTerrainFromPointer = function naturalEditTerrainFromPointer(event, force) {
    if (!this.naturalTerrainGestureMode) {
      return editTerrainFromPointer.call(this, event, force);
    }
    const savedMode = this.terrainMode;
    this.terrainMode = this.naturalTerrainGestureMode;
    try {
      return editTerrainFromPointer.call(this, event, force);
    } finally {
      this.terrainMode = savedMode;
    }
  };

  const pointerUp = prototype.onPointerUp;
  prototype.onPointerUp = function naturalPointerUp(event) {
    if (finishObjectDrag(this, event)) {
      this.naturalTerrainGestureMode = null;
      return;
    }
    try {
      return pointerUp.call(this, event);
    } finally {
      if (event.button === PRIMARY_POINTER_BUTTON && !this.painting) {
        this.naturalTerrainGestureMode = null;
      }
    }
  };

  prototype.duplicateSelected = function duplicateSelected() {
    const selected = this.selectedObjectId
      ? this.objectMap.getById(this.selectedObjectId)
      : null;
    if (!selected) return;
    this.selectedObjectKey = selected.definitionKey;
    this.objectRotation = selected.rotation;
    this.naturalReturnTool = 'object';
    this.tool = 'object';
    this.naturalObjectDrag = null;
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitNotice('Place the duplicate where you want it.');
    this.emitState();
  };

  const deleteSelected = prototype.deleteSelected;
  prototype.deleteSelected = function naturalDeleteSelected() {
    const hadSelection = Boolean(this.selectedObjectId);
    this.naturalObjectDrag = null;
    const result = deleteSelected.call(this);
    if (hadSelection) restoreSelectionTool(this);
    return result;
  };

  const deleteSelectedConstruction = prototype.deleteSelectedConstruction;
  prototype.deleteSelectedConstruction = function naturalDeleteSelectedConstruction() {
    const shouldReturn = Boolean(this.naturalConstructionReturnTool);
    const result = deleteSelectedConstruction.call(this);
    if (shouldReturn && !this.selectedConstructionId) restoreConstructionTool(this);
    return result;
  };

  const undo = prototype.undo;
  prototype.undo = function naturalUndo() {
    const entry = this.undoStack.at(-1);
    const before = this.undoStack.length;
    const result = undo.call(this);
    if (entry && this.undoStack.length < before) this.emitNotice(`Undo ${historyLabel(entry)}.`);
    return result;
  };

  const redo = prototype.redo;
  prototype.redo = function naturalRedo() {
    const entry = this.redoStack.at(-1);
    const before = this.redoStack.length;
    const result = redo.call(this);
    if (entry && this.redoStack.length < before) this.emitNotice(`Redo ${historyLabel(entry)}.`);
    return result;
  };

  const keyDown = prototype.onKeyDown;
  prototype.onKeyDown = function naturalKeyDown(event) {
    if (
      (event.ctrlKey || event.metaKey)
      && event.key.toLowerCase() === 'd'
      && this.selectedObjectId
    ) {
      event.preventDefault();
      this.duplicateSelected();
      return;
    }
    const escapeConstructionReturn = event.key.toLowerCase() === 'escape'
      && Boolean(this.naturalConstructionReturnTool);
    const result = keyDown.call(this, event);
    if (event.key.toLowerCase() === 'escape') {
      this.naturalObjectDrag = null;
      restoreSelectionTool(this);
    }
    if (escapeConstructionReturn) restoreConstructionTool(this);
    return result;
  };
}

installNaturalEditorInteractions();
