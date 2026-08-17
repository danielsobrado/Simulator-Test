import { EditorController } from '../EditorController.js';
import { TerrainAwareEditorController } from '../TerrainAwareEditorController.js';
import { ObjectSelectionController } from '../interaction/ObjectSelectionController.js';
import { OBJECT_SELECTION_ADDITIVE_MODE_EVENT } from '../interaction/ObjectSelectionEvents.js';

const PATCH_MARK = Symbol.for('drusniel.natural-editor-interactions');
const SELECTION = Symbol.for('drusniel.natural-editor-selection');
const PRIMARY_POINTER_BUTTON = 0;
const DEFAULT_RETURN_TOOL = 'terrain';
let additivePointerMode = false;

function effectiveTerrainGestureMode(event) {
  if (event.ctrlKey || event.metaKey) return 'smooth';
  if (event.shiftKey) return 'lower';
  return null;
}

function historyLabel(entry) {
  switch (entry?.kind) {
    case 'terrain': return 'terrain paint';
    case 'height': return 'terrain sculpt';
    case 'object':
    case 'object-batch': return 'object edit';
    case 'construction':
    case 'construction-batch': return 'construction edit';
    case 'world':
    case 'infinite-world': return 'world edit';
    default: return 'edit';
  }
}

function installNaturalEditorInteractions() {
  const prototype = EditorController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });
  globalThis.window?.addEventListener?.(OBJECT_SELECTION_ADDITIVE_MODE_EVENT, (event) => {
    additivePointerMode = event.detail?.enabled === true;
  });

  const baseSetSelectedObject = prototype.setSelectedObject;
  const selectionFor = (controller) => {
    if (!controller[SELECTION]) {
      controller[SELECTION] = new ObjectSelectionController(
        controller,
        (id) => baseSetSelectedObject.call(controller, id),
      );
    }
    return controller[SELECTION];
  };

  const restoreSelectionTool = (controller) => {
    const selection = selectionFor(controller);
    if (controller.tool !== 'select' || selection.size > 0 || controller.movingObjectId) return;
    controller.tool = selection.returnTool ?? DEFAULT_RETURN_TOOL;
    controller.updatePreviews();
    controller.emitState();
  };

  const restoreConstructionTool = (controller) => {
    const returnTool = controller.naturalConstructionReturnTool;
    if (!returnTool) return false;
    controller.naturalConstructionReturnTool = null;
    controller.setSelectedConstruction(null);
    controller.constructionGizmo?.close();
    controller.tool = returnTool;
    controller.updatePreviews();
    controller.emitState();
    return true;
  };

  prototype.setSelectedObject = function naturalSetSelectedObject(objectId) {
    selectionFor(this).replace(objectId);
  };

  const getState = prototype.getState;
  prototype.getState = function naturalGetState() {
    const state = getState.call(this);
    const selection = selectionFor(this);
    return {
      ...state,
      selectedObjects: selection.objects(),
      selectedObjectCount: selection.size,
    };
  };

  const selectTool = prototype.selectTool;
  prototype.selectTool = function naturalSelectTool(tool) {
    const selection = selectionFor(this);
    if (tool !== 'select') selection.returnTool = tool;
    this.naturalConstructionReturnTool = null;
    selection.drag = null;
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
    const selection = selectionFor(this);
    if (
      !this.isWorldInputBlocked()
      && event.button === PRIMARY_POINTER_BUTTON
      && !this.spacePressed
      && !this.movingObjectId
    ) {
      const objectId = this.objectView.pickObject(
        event.clientX,
        event.clientY,
        this.activeCamera,
      );
      if (objectId) {
        selection.returnTool = this.tool === 'select'
          ? selection.returnTool ?? DEFAULT_RETURN_TOOL
          : this.tool;
        this.naturalConstructionReturnTool = null;
        if (this.tool === 'construction') {
          this.cancelConstructionGesture();
          this.setSelectedConstruction(null);
          this.constructionGizmo?.close();
        }
        this.tool = 'select';
        const additive = event.shiftKey || additivePointerMode;
        const selected = selection.selectDirect(objectId, { additive });
        if (!additive && selected) selection.beginDirectDrag(objectId, event);
        this.updatePreviews();
        this.emitState();
        event.preventDefault();
        if (additive && selection.size === 0) restoreSelectionTool(this);
        return;
      }

      if (this.tool !== 'construction' && this.constructionView && this.constructionStore) {
        const constructionId = this.constructionView.pickConstruction(
          event.clientX,
          event.clientY,
          this.activeCamera,
        );
        if (constructionId) {
          this.naturalConstructionReturnTool = this.tool === 'select'
            ? selection.returnTool ?? DEFAULT_RETURN_TOOL
            : this.tool;
          this.cancelConstructionGesture();
          selection.clear();
          this.tool = 'construction';
          this.constructionMode = 'edit';
          this.setSelectedConstruction(constructionId);
          this.constructionGizmo?.open(constructionId, event);
          this.updatePreviews();
          this.emitState();
          event.preventDefault();
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
    selectionFor(this).updateDirectDrag(event);
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
    if (!this.naturalTerrainGestureMode) return editTerrainFromPointer.call(this, event, force);
    const savedMode = this.terrainMode;
    this.terrainMode = this.naturalTerrainGestureMode;
    try {
      return editTerrainFromPointer.call(this, event, force);
    } finally {
      this.terrainMode = savedMode;
    }
  };

  const updatePreviews = prototype.updatePreviews;
  prototype.updatePreviews = function naturalUpdatePreviews() {
    const selection = selectionFor(this);
    selection.overlay.clearPreview();
    if (this.tool === 'select' && this.movingObjectId && selection.size > 1) {
      this.terrainView.setPreview(null);
      this.objectView.setPreview(null);
      const primary = selection.primaryId
        ? this.objectMap.getById(selection.primaryId)
        : null;
      if (primary && this.hoveredCell) {
        selection.overlay.previewTranslation(
          selection.objects(),
          this.hoveredCell.x - primary.x,
          this.hoveredCell.z - primary.z,
        );
      }
      return;
    }
    return updatePreviews.call(this);
  };

  const pointerUp = prototype.onPointerUp;
  prototype.onPointerUp = function naturalPointerUp(event) {
    if (selectionFor(this).finishDirectDrag(event)) {
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

  prototype.startMoveSelected = function naturalStartMoveSelected() {
    selectionFor(this).startMove();
  };

  prototype.moveSelectedTo = function naturalMoveSelectedTo(cell) {
    return selectionFor(this).moveTo(cell);
  };

  const rotateSelection = function naturalRotateSelected() {
    return selectionFor(this).rotate();
  };
  prototype.rotateSelected = rotateSelection;
  TerrainAwareEditorController.prototype.rotateSelected = rotateSelection;

  prototype.duplicateSelected = function naturalDuplicateSelected() {
    return selectionFor(this).duplicate();
  };

  prototype.deleteSelected = function naturalDeleteSelected() {
    const selection = selectionFor(this);
    const hadSelection = selection.size > 0;
    const result = selection.delete();
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

  const applyHistory = prototype.applyHistory;
  prototype.applyHistory = function naturalApplyHistory(entry, direction) {
    if (entry?.kind === 'object-batch') {
      selectionFor(this).applyHistory(entry, direction);
      return;
    }
    return applyHistory.call(this, entry, direction);
  };

  const refreshObjects = prototype.refreshObjects;
  prototype.refreshObjects = function naturalRefreshObjects() {
    const result = refreshObjects.call(this);
    selectionFor(this).retainExisting();
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
    const selection = selectionFor(this);
    if (
      (event.ctrlKey || event.metaKey)
      && event.key.toLowerCase() === 'd'
      && selection.size > 0
    ) {
      event.preventDefault();
      selection.duplicate();
      return;
    }
    const escapeConstructionReturn = event.key.toLowerCase() === 'escape'
      && Boolean(this.naturalConstructionReturnTool);
    const result = keyDown.call(this, event);
    if (event.key.toLowerCase() === 'escape') {
      selection.drag = null;
      restoreSelectionTool(this);
    }
    if (escapeConstructionReturn) restoreConstructionTool(this);
    return result;
  };

  const dispose = prototype.dispose;
  prototype.dispose = function naturalDispose() {
    this[SELECTION]?.dispose();
    this[SELECTION] = null;
    return dispose.call(this);
  };
}

installNaturalEditorInteractions();
