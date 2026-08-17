import { EditorController } from '../EditorController.js';

const PATCH_MARK = Symbol.for('drusniel.natural-editor-interactions');
const PRIMARY_POINTER_BUTTON = 0;
const DEFAULT_RETURN_TOOL = 'terrain';

function effectiveTerrainGestureMode(event) {
  if (event.ctrlKey || event.metaKey) return 'smooth';
  if (event.shiftKey) return 'lower';
  return null;
}

function restoreSelectionTool(controller) {
  if (controller.tool !== 'select' || controller.selectedObjectId || controller.movingObjectId) return;
  controller.tool = controller.naturalReturnTool ?? DEFAULT_RETURN_TOOL;
  controller.updatePreviews();
  controller.emitState();
}

function selectObjectDirectly(controller, objectId, event) {
  controller.naturalReturnTool = controller.tool === 'select'
    ? controller.naturalReturnTool ?? DEFAULT_RETURN_TOOL
    : controller.tool;
  if (controller.tool === 'construction') {
    controller.cancelConstructionGesture();
    controller.setSelectedConstruction(null);
    controller.constructionGizmo?.close();
  }
  controller.tool = 'select';
  controller.setSelectedObject(objectId);
  controller.updatePreviews();
  controller.emitState();
  event.preventDefault();
}

function installNaturalEditorInteractions() {
  const prototype = EditorController.prototype;
  if (prototype[PATCH_MARK]) return;
  Object.defineProperty(prototype, PATCH_MARK, { value: true });

  const selectTool = prototype.selectTool;
  prototype.selectTool = function naturalSelectTool(tool) {
    if (tool !== 'select') this.naturalReturnTool = tool;
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
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitNotice('Place the duplicate where you want it.');
    this.emitState();
  };

  const deleteSelected = prototype.deleteSelected;
  prototype.deleteSelected = function naturalDeleteSelected() {
    const hadSelection = Boolean(this.selectedObjectId);
    const result = deleteSelected.call(this);
    if (hadSelection) restoreSelectionTool(this);
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
    const result = keyDown.call(this, event);
    if (event.key.toLowerCase() === 'escape') restoreSelectionTool(this);
    return result;
  };
}

installNaturalEditorInteractions();
