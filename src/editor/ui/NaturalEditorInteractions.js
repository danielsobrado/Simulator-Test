import { TerrainAwareEditorController } from '../TerrainAwareEditorController.js';
import { ObjectSelectionController } from '../interaction/ObjectSelectionController.js';
import { OBJECT_SELECTION_ADDITIVE_MODE_EVENT } from '../interaction/ObjectSelectionEvents.js';
import { installNaturalConstructionContextBridge } from './NaturalConstructionContextBridge.js';
import { installNaturalEditorHoverBridge } from './NaturalEditorHoverBridge.js';

const BOOTSTRAP_MARK = Symbol.for('drusniel.natural-editor-interactions-bootstrap');
const PRIMARY_POINTER_BUTTON = 0;
const DEFAULT_RETURN_TOOL = 'terrain';
const OVERRIDDEN_METHODS = Object.freeze([
  'setSelectedObject',
  'getState',
  'selectTool',
  'selectTerrainMode',
  'selectTile',
  'selectObjectDefinition',
  'selectConstructionMode',
  'cancelBlockedWorldInteraction',
  'onConstructionPointerDown',
  'onPointerDown',
  'onPointerMove',
  'editTerrainFromPointer',
  'updatePreviews',
  'onPointerUp',
  'startMoveSelected',
  'moveSelectedTo',
  'rotateSelected',
  'duplicateSelected',
  'deleteSelected',
  'deleteSelectedConstruction',
  'applyHistory',
  'refreshObjects',
  'undo',
  'redo',
  'onKeyDown',
  'dispose',
]);

function isTextControl(target) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true;
}

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

function captureMethods(controller, names) {
  return Object.fromEntries(names.map((name) => [
    name,
    typeof controller[name] === 'function' ? controller[name].bind(controller) : null,
  ]));
}

function restoreMethods(controller, original, names) {
  for (const name of names) {
    if (original[name]) controller[name] = original[name];
    else delete controller[name];
  }
}

export function installNaturalEditorInteractions(controller) {
  if (controller.naturalEditorInteractions) return controller.naturalEditorInteractions;

  const original = captureMethods(controller, OVERRIDDEN_METHODS);
  const abort = new AbortController();
  const selection = new ObjectSelectionController(controller, original.setSelectedObject);
  const hoverBridge = installNaturalEditorHoverBridge(controller);
  const constructionContextBridge = installNaturalConstructionContextBridge(controller);
  let additivePointerMode = false;
  let terrainPointerId = null;
  let disposed = false;

  globalThis.window?.addEventListener?.(OBJECT_SELECTION_ADDITIVE_MODE_EVENT, (event) => {
    additivePointerMode = event.detail?.enabled === true;
  }, { signal: abort.signal });

  const restoreSelectionTool = () => {
    if (controller.tool !== 'select' || selection.size > 0 || controller.movingObjectId) return;
    controller.tool = selection.returnTool ?? DEFAULT_RETURN_TOOL;
    controller.updatePreviews();
    controller.emitState();
  };

  const restoreConstructionTool = () => {
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

  const releaseTerrainPointer = () => {
    const pointerId = terrainPointerId;
    terrainPointerId = null;
    if (
      pointerId !== null
      && controller.canvas?.hasPointerCapture?.(pointerId)
    ) {
      controller.canvas.releasePointerCapture(pointerId);
    }
  };

  const settleTerrainStroke = () => {
    const wasPainting = controller.painting;
    if (wasPainting) {
      controller.painting = false;
      controller.lastPaintKey = null;
      controller.finishStroke();
    }
    releaseTerrainPointer();
    return wasPainting;
  };

  const cancelNaturalPointerGestures = ({ updateState = false } = {}) => {
    controller.naturalTerrainGestureMode = null;
    return selection.cancelPointerGestures({ updateState });
  };

  const settleBeforeModeChange = (action, ...args) => {
    settleTerrainStroke();
    cancelNaturalPointerGestures();
    return action(...args);
  };

  controller.setSelectedObject = (objectId) => selection.replace(objectId);

  controller.getState = () => ({
    ...original.getState(),
    selectedObjects: selection.objects(),
    selectedObjectCount: selection.size,
  });

  controller.selectTool = (tool) => {
    settleTerrainStroke();
    const cancelled = cancelNaturalPointerGestures();
    const previousTool = controller.tool;
    const result = original.selectTool(tool);
    if (controller.tool === tool) {
      if (tool !== 'select') selection.returnTool = tool;
      controller.naturalConstructionReturnTool = null;
    } else {
      if (controller.tool !== previousTool && controller.tool !== 'select') {
        selection.returnTool = controller.tool;
      }
      if (cancelled) controller.emitState();
    }
    return result;
  };

  controller.selectTerrainMode = (mode) => settleBeforeModeChange(original.selectTerrainMode, mode);
  controller.selectTile = (tileId) => settleBeforeModeChange(original.selectTile, tileId);
  controller.selectObjectDefinition = (definitionKey) => (
    settleBeforeModeChange(original.selectObjectDefinition, definitionKey)
  );
  controller.selectConstructionMode = (mode) => (
    settleBeforeModeChange(original.selectConstructionMode, mode)
  );

  controller.cancelBlockedWorldInteraction = () => {
    const wasMovingSelection = controller.movingObjectId !== null;
    settleTerrainStroke();
    cancelNaturalPointerGestures();
    const result = original.cancelBlockedWorldInteraction();
    selection.overlay.clearPreview();
    controller.terrainView.setPreview(null);
    controller.objectView.setPreview(null);
    if (wasMovingSelection) controller.emitState();
    return result;
  };

  controller.onConstructionPointerDown = (event) => {
    if (controller.constructionStore && controller.constructionView) {
      const handle = controller.constructionView.pickHandle(
        event.clientX,
        event.clientY,
        controller.activeCamera,
      );
      const constructionId = handle
        ? handle.constructionId
        : controller.constructionView.pickConstruction(
          event.clientX,
          event.clientY,
          controller.activeCamera,
        );
      if (!handle && !constructionId && controller.naturalConstructionReturnTool) {
        restoreConstructionTool();
        event.preventDefault();
        return;
      }
      controller.constructionMode = handle || constructionId ? 'edit' : 'draw';
    }
    return original.onConstructionPointerDown(event);
  };

  controller.onPointerDown = (event) => {
    if (controller.isWorldInputBlocked()) {
      controller.cancelBlockedWorldInteraction();
      return;
    }

    if (
      event.button === PRIMARY_POINTER_BUTTON
      && !controller.spacePressed
      && !controller.movingObjectId
    ) {
      const objectId = controller.objectView.pickObject(
        event.clientX,
        event.clientY,
        controller.activeCamera,
      );
      if (objectId) {
        selection.returnTool = controller.tool === 'select'
          ? selection.returnTool ?? DEFAULT_RETURN_TOOL
          : controller.tool;
        controller.naturalConstructionReturnTool = null;
        if (controller.tool === 'construction') {
          controller.cancelConstructionGesture();
          controller.setSelectedConstruction(null);
          controller.constructionGizmo?.close();
        }
        controller.tool = 'select';
        const additive = event.shiftKey || additivePointerMode;
        const selected = selection.selectDirect(objectId, { additive });
        if (!additive && selected) selection.beginDirectDrag(objectId, event);
        controller.updatePreviews();
        controller.emitState();
        event.preventDefault();
        if (additive && selection.size === 0) restoreSelectionTool();
        return;
      }

      const additive = event.shiftKey || additivePointerMode;
      if (
        additive
        && controller.tool === 'select'
        && !controller.playerEditingProvider?.()
        && selection.marquee.begin(event)
      ) return;

      if (
        controller.tool !== 'construction'
        && controller.constructionView
        && controller.constructionStore
      ) {
        const constructionId = controller.constructionView.pickConstruction(
          event.clientX,
          event.clientY,
          controller.activeCamera,
        );
        if (constructionId) {
          controller.naturalConstructionReturnTool = controller.tool === 'select'
            ? selection.returnTool ?? DEFAULT_RETURN_TOOL
            : controller.tool;
          controller.cancelConstructionGesture();
          selection.clear();
          controller.tool = 'construction';
          controller.constructionMode = 'edit';
          controller.setSelectedConstruction(constructionId);
          controller.constructionGizmo?.open(constructionId, event);
          controller.updatePreviews();
          controller.emitState();
          event.preventDefault();
          return;
        }
      }
    }

    const wasSelect = controller.tool === 'select';
    const terrainPointer = (
      controller.tool === 'terrain'
      && event.button === PRIMARY_POINTER_BUTTON
      && !controller.spacePressed
    );
    const terrainGesture = terrainPointer ? effectiveTerrainGestureMode(event) : null;
    if (event.button === PRIMARY_POINTER_BUTTON && !controller.spacePressed) {
      controller.naturalTerrainGestureMode = terrainGesture;
    }
    const savedMode = controller.terrainMode;
    if (terrainGesture) controller.terrainMode = terrainGesture;
    try {
      const result = original.onPointerDown(event);
      if (terrainPointer && controller.painting) terrainPointerId = event.pointerId;
      return result;
    } finally {
      if (terrainGesture) controller.terrainMode = savedMode;
      if (wasSelect) restoreSelectionTool();
    }
  };

  controller.onPointerMove = (event) => {
    if (controller.isWorldInputBlocked()) {
      controller.cancelBlockedWorldInteraction();
      return;
    }
    if (selection.marquee.update(event)) return;
    selection.updateDirectDrag(event);
    if (!controller.naturalTerrainGestureMode) return original.onPointerMove(event);
    const savedMode = controller.terrainMode;
    controller.terrainMode = controller.naturalTerrainGestureMode;
    try {
      return original.onPointerMove(event);
    } finally {
      controller.terrainMode = savedMode;
    }
  };

  controller.editTerrainFromPointer = (event, force) => {
    if (!controller.naturalTerrainGestureMode) {
      return original.editTerrainFromPointer(event, force);
    }
    const savedMode = controller.terrainMode;
    controller.terrainMode = controller.naturalTerrainGestureMode;
    try {
      return original.editTerrainFromPointer(event, force);
    } finally {
      controller.terrainMode = savedMode;
    }
  };

  controller.updatePreviews = () => {
    selection.overlay.clearPreview();
    if (controller.tool === 'select' && controller.movingObjectId && selection.size > 1) {
      controller.terrainView.setPreview(null);
      controller.objectView.setPreview(null);
      const primary = selection.primaryId
        ? controller.objectMap.getById(selection.primaryId)
        : null;
      if (primary && controller.hoveredCell) {
        selection.overlay.previewTranslation(
          selection.visibleObjects(),
          controller.hoveredCell.x - primary.x,
          controller.hoveredCell.z - primary.z,
        );
      }
      return;
    }
    return original.updatePreviews();
  };

  controller.onPointerUp = (event) => {
    if (controller.isWorldInputBlocked()) {
      controller.cancelBlockedWorldInteraction();
      return;
    }
    if (selection.marquee.finish(event)) return;
    if (selection.finishDirectDrag(event)) {
      controller.naturalTerrainGestureMode = null;
      return;
    }
    try {
      return original.onPointerUp(event);
    } finally {
      if (event.pointerId === terrainPointerId) terrainPointerId = null;
      if (event.button === PRIMARY_POINTER_BUTTON || event.type === 'pointercancel') {
        controller.naturalTerrainGestureMode = null;
      }
    }
  };

  controller.startMoveSelected = () => selection.startMove();
  controller.moveSelectedTo = (cell) => selection.moveTo(cell);
  controller.rotateSelected = () => selection.rotate();
  controller.duplicateSelected = () => selection.duplicate();

  controller.deleteSelected = () => {
    const hadSelection = selection.size > 0;
    const result = selection.delete();
    if (hadSelection) restoreSelectionTool();
    return result;
  };

  controller.deleteSelectedConstruction = () => {
    const shouldReturn = Boolean(controller.naturalConstructionReturnTool);
    const result = original.deleteSelectedConstruction();
    if (shouldReturn && !controller.selectedConstructionId) restoreConstructionTool();
    return result;
  };

  controller.applyHistory = (entry, direction) => {
    if (entry?.kind === 'object-batch') {
      selection.applyHistory(entry, direction);
      return;
    }
    return original.applyHistory(entry, direction);
  };

  controller.refreshObjects = () => {
    const result = original.refreshObjects();
    const selectionChanged = selection.retainExisting();
    if (selectionChanged) controller.emitState();
    return result;
  };

  controller.undo = () => {
    const entry = controller.undoStack.at(-1);
    const before = controller.undoStack.length;
    const result = original.undo();
    if (entry && controller.undoStack.length < before) {
      controller.emitNotice(`Undo ${historyLabel(entry)}.`);
    }
    return result;
  };

  controller.redo = () => {
    const entry = controller.redoStack.at(-1);
    const before = controller.redoStack.length;
    const result = original.redo();
    if (entry && controller.redoStack.length < before) {
      controller.emitNotice(`Redo ${historyLabel(entry)}.`);
    }
    return result;
  };

  controller.onKeyDown = (event) => {
    if (isTextControl(event.target)) return;
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
      && Boolean(controller.naturalConstructionReturnTool);
    if (event.key.toLowerCase() === 'escape') {
      settleTerrainStroke();
      cancelNaturalPointerGestures();
    }
    const result = original.onKeyDown(event);
    if (event.key.toLowerCase() === 'escape') restoreSelectionTool();
    if (escapeConstructionReturn) restoreConstructionTool();
    return result;
  };

  const integration = {
    selection,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      settleTerrainStroke();
      constructionContextBridge.dispose();
      hoverBridge.dispose();
      selection.dispose();
      restoreMethods(controller, original, OVERRIDDEN_METHODS);
      controller.naturalTerrainGestureMode = null;
      controller.naturalConstructionReturnTool = null;
      controller.naturalEditorInteractions = null;
    },
  };
  controller.naturalEditorInteractions = integration;
  controller.dispose = () => {
    integration.dispose();
    return original.dispose();
  };
  return integration;
}

function installBootstrapHook() {
  const prototype = TerrainAwareEditorController.prototype;
  if (prototype[BOOTSTRAP_MARK]) return;
  Object.defineProperty(prototype, BOOTSTRAP_MARK, { value: true });
  const subscribe = prototype.subscribe;
  prototype.subscribe = function naturalSubscribe(listener) {
    installNaturalEditorInteractions(this);
    return subscribe.call(this, listener);
  };
}

installBootstrapHook();
