import {
  ELEVATED_PLACEMENT_TOLERANCE,
  MAX_HISTORY_ENTRIES,
  PAINT_INTERVAL_MS,
  PRIMARY_POINTER_BUTTON,
  TERRAIN_MODE_BY_SHORTCUT,
  TERRAIN_PREVIEW_COLORS,
  VALID_EDITOR_TOOLS,
  VALID_TERRAIN_MODES,
} from './constants.js';
import { createWorldDocument, loadWorldDocument } from './WorldDocument.js';
import { TILE_BY_SHORTCUT } from './tileCatalog.js';
import { executeConstructionCommand } from './construction/ConstructionCommands.js';
import {
  closestPointOnCubicBezierPath,
  createCubicBezierPathFromStroke,
  findCubicBezierSelfIntersections,
  moveCubicBezierAnchor,
} from './construction/curve/CubicBezierPath.js';
import {
  flattenHandlesAround,
  resolveAnchorSnap,
} from './construction/curve/CurveSnapping.js';
import {
  TOP_RADIUS_DEFAULT,
  TOP_RADIUS_RANGE,
  applyTopEdit,
  flattenTop,
} from './construction/masonry/WallTopEdit.js';
import { createWallTopProfile } from './construction/masonry/WallTopProfile.js';
import { resolveCutStroke } from './construction/ConstructionCutStroke.js';

/** Commit a raise/lower burst as one history entry once the keys settle. */
const TOP_EDIT_COMMIT_MS = 250;

const SECONDARY_POINTER_BUTTON = 2;
/**
 * Tap-versus-drag thresholds for the right button, mirroring
 * `POINTER_SELECT_DISTANCE` in the workshop material controller.
 */
const POINTER_TAP_DISTANCE = 6;
const POINTER_TAP_MS = 400;

/** Allocate an opening id that cannot collide with holes left by deletions. */
function nextOpeningFeatureId(record) {
  const used = new Set(record.features.map(({ id }) => id));
  let index = record.features.length + 1;
  let id = `opening-${record.id}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `opening-${record.id}-${index}`;
  }
  return id;
}

export class EditorController {
  constructor({
    tileMap,
    heightField,
    objectMap,
    terrainView,
    objectView,
    editorCamera,
    objectCatalog,
    brushSizes,
    defaultBrushSize,
    terrainConfig,
    constructionStore = null,
    constructionMaterialStore = null,
    constructionView = null,
    worldInputBlockedProvider = null,
  }) {
    this.tileMap = tileMap;
    this.heightField = heightField;
    this.objectMap = objectMap;
    this.terrainView = terrainView;
    this.objectView = objectView;
    this.editorCamera = editorCamera;
    this.objectCatalog = objectCatalog;
    this.brushSizes = brushSizes;
    this.terrainConfig = terrainConfig;
    this.constructionStore = constructionStore;
    this.constructionMaterialStore = constructionMaterialStore;
    this.constructionView = constructionView;
    this.worldInputBlockedProvider = worldInputBlockedProvider;
    /**
     * Set by the composition root to `() => viewModeController.camera`.
     *
     * Every picker already takes a camera argument, so routing them through
     * this getter is the whole of what editing from the player's first-person
     * camera requires — the orbit camera was only ever hardcoded because there
     * was nothing else to point at.
     */
    this.cameraProvider = null;
    /** Set by the composition root; the right button falls back to orbit only. */
    this.constructionPalette = null;
    /** `() => boolean` — true while paused for editing inside player mode. */
    this.playerEditingProvider = null;
    this.rightPointerStart = null;
    this.tool = 'terrain';
    this.terrainMode = 'paint';
    this.selectedTileId = 4;
    this.selectedObjectKey = objectCatalog[0].key;
    this.objectRotation = 0;
    this.selectedObjectId = null;
    this.selectedConstructionId = null;
    this.constructionMode = 'draw';
    this.constructionHeight = 3.5;
    this.constructionThickness = 0.8;
    this.constructionStroke = null;
    this.constructionDrawing = false;
    this.constructionAnchorDrag = null;
    /** The node under edit, so Delete removes a node rather than the wall. */
    this.selectedAnchorId = null;
    /** True while an Alt-drag is carving rather than drawing. */
    this.constructionCutStroke = false;
    /** `{ constructionId, s }` under the pointer, for the raise/lower gesture. */
    this.hoveredArc = null;
    this.constructionTopRadius = TOP_RADIUS_DEFAULT;
    /**
     * A held arrow key must not make forty history entries, so raise/lower
     * accumulates here and commits one command once the burst settles.
     */
    this.pendingTopEdit = null;
    this.pendingTopEditTimer = null;
    this.movingObjectId = null;
    this.brushSize = brushSizes.includes(defaultBrushSize) ? defaultBrushSize : brushSizes[0];
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
    this.strokeKind = null;
    this.painting = false;
    this.spacePressed = false;
    this.hoveredCell = null;
    this.lastPaintKey = null;
    this.lastPaintAt = 0;
    this.listeners = new Set();
    this.mapListeners = new Set();
    this.hoverListeners = new Set();
    this.noticeListeners = new Set();

    this.canvas = terrainView.renderer.domElement;
    this.boundHandlers = {
      pointerDown: (event) => this.onPointerDown(event),
      pointerMove: (event) => this.onPointerMove(event),
      pointerUp: (event) => this.onPointerUp(event),
      pointerLeave: () => this.onPointerLeave(),
      contextMenu: (event) => event.preventDefault(),
      keyDown: (event) => this.onKeyDown(event),
      keyUp: (event) => this.onKeyUp(event),
    };

    this.canvas.addEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.canvas.addEventListener('pointermove', this.boundHandlers.pointerMove);
    this.canvas.addEventListener('pointerup', this.boundHandlers.pointerUp);
    this.canvas.addEventListener('pointercancel', this.boundHandlers.pointerUp);
    this.canvas.addEventListener('pointerleave', this.boundHandlers.pointerLeave);
    this.canvas.addEventListener('contextmenu', this.boundHandlers.contextMenu);
    window.addEventListener('keydown', this.boundHandlers.keyDown);
    window.addEventListener('keyup', this.boundHandlers.keyUp);
  }

  get activeCamera() {
    return this.cameraProvider?.() ?? this.editorCamera.camera;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  subscribeMap(listener) {
    this.mapListeners.add(listener);
    return () => this.mapListeners.delete(listener);
  }

  subscribeHover(listener) {
    this.hoverListeners.add(listener);
    return () => this.hoverListeners.delete(listener);
  }

  subscribeNotice(listener) {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  getState() {
    const selectedObject = this.selectedObjectId
      ? this.objectMap.getById(this.selectedObjectId)
      : null;
    return {
      tool: this.tool,
      terrainMode: this.terrainMode,
      selectedTileId: this.selectedTileId,
      selectedObjectKey: this.selectedObjectKey,
      objectRotation: this.objectRotation,
      selectedObject,
      isMovingSelected: this.movingObjectId !== null,
      objectCount: this.objectMap.size,
      constructionCount: this.constructionStore?.size ?? 0,
      constructionMode: this.constructionMode,
      constructionHeight: this.constructionHeight,
      constructionThickness: this.constructionThickness,
      selectedConstruction: this.selectedConstructionId
        ? this.constructionStore?.get(this.selectedConstructionId) ?? null
        : null,
      isDrawingConstruction: this.constructionDrawing,
      isMovingConstructionAnchor: this.constructionAnchorDrag !== null,
      brushSize: this.brushSize,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  selectTool(tool) {
    if (!VALID_EDITOR_TOOLS.includes(tool)) {
      return;
    }
    // While paused inside player mode only construction editing is offered.
    // Terrain sculpting needs a rethought brush preview from a grazing
    // first-person view, and object placement needs an elevated-placement
    // story; neither is what in-world wall editing was asked for.
    if (this.playerEditingProvider?.() && tool !== 'construction') {
      this.emitNotice('Only wall building is available while paused in player mode.', true);
      return;
    }
    this.tool = tool;
    if (tool !== 'select') {
      this.setSelectedObject(null);
    }
    if (tool !== 'construction') {
      this.cancelConstructionGesture();
      this.setSelectedConstruction(null);
    }
    this.updatePreviews();
    this.emitState();
  }

  selectTerrainMode(mode) {
    if (!VALID_TERRAIN_MODES.includes(mode)) {
      return;
    }
    this.terrainMode = mode;
    this.tool = 'terrain';
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitState();
  }

  selectTile(tileId) {
    if (!this.tileMap.getTileDefinition?.(tileId)) {
      return;
    }
    this.selectedTileId = tileId;
    this.terrainMode = 'paint';
    this.tool = 'terrain';
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitState();
  }

  selectObjectDefinition(definitionKey) {
    if (!this.objectMap.definitionByKey.has(definitionKey)) {
      return;
    }
    this.selectedObjectKey = definitionKey;
    this.tool = 'object';
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitState();
  }

  selectBrush(brushSize) {
    if (!this.brushSizes.includes(brushSize)) {
      return;
    }
    this.brushSize = brushSize;
    this.updatePreviews();
    this.emitState();
  }

  selectConstructionMode(mode) {
    if (!['draw', 'edit'].includes(mode) || !this.constructionStore || !this.constructionView) {
      return;
    }
    this.cancelConstructionGesture();
    this.constructionMode = mode;
    this.tool = 'construction';
    if (mode === 'draw') this.setSelectedConstruction(null);
    this.setSelectedObject(null);
    this.updatePreviews();
    this.emitState();
  }

  setConstructionDimensions({ height, thickness }) {
    if (Number.isFinite(height)) {
      this.constructionHeight = Math.max(0.5, Math.min(30, height));
    }
    if (Number.isFinite(thickness)) {
      this.constructionThickness = Math.max(0.1, Math.min(10, thickness));
    }
    this.emitState();
  }

  setSelectedConstruction(constructionId) {
    const id = constructionId == null ? null : String(constructionId);
    this.selectedConstructionId = id && this.constructionStore?.get(id) ? id : null;
    this.constructionView?.setSelection(this.selectedConstructionId);
  }

  /** Run a construction command, commit it to history, and report failures. */
  runConstructionCommand(command) {
    if (!this.constructionStore) return null;
    try {
      const change = executeConstructionCommand(this.constructionStore, command);
      this.commitHistory(change);
      this.emitMap();
      return change;
    } catch (error) {
      this.emitNotice(error.message, true);
      return null;
    }
  }

  deleteSelectedConstruction() {
    if (!this.selectedConstructionId || !this.constructionStore) return;
    const constructionId = this.selectedConstructionId;
    this.setSelectedConstruction(null);
    if (!this.runConstructionCommand({ type: 'delete', constructionId })) {
      this.setSelectedConstruction(constructionId);
    }
  }

  rotatePlacement() {
    this.objectRotation = (this.objectRotation + 1) % 4;
    this.updatePreviews();
    this.emitState();
  }

  rotateSelected() {
    const before = this.selectedObjectId
      ? this.objectMap.getById(this.selectedObjectId)
      : null;
    if (!before) {
      return;
    }

    try {
      const after = this.objectMap.transform(before.id, {
        x: before.x,
        z: before.z,
        rotation: before.rotation + 1,
      });
      this.commitHistory({ kind: 'object', before, after });
      this.refreshObjects();
      this.emitMap();
    } catch (error) {
      this.emitNotice(error.message, true);
    }
  }

  startMoveSelected() {
    if (!this.selectedObjectId) {
      return;
    }
    this.movingObjectId = this.selectedObjectId;
    this.updatePreviews();
    this.emitState();
  }

  deleteSelected() {
    if (!this.selectedObjectId) {
      return;
    }
    const before = this.objectMap.remove(this.selectedObjectId);
    if (!before) {
      return;
    }
    this.selectedObjectId = null;
    this.movingObjectId = null;
    this.commitHistory({ kind: 'object', before, after: null });
    this.refreshObjects();
    this.emitMap();
  }

  undo() {
    // A buffered raise/lower burst has already changed the store but has no
    // history entry yet. Flush it first, or this undo pops the entry before it
    // and the burst then lands on top of the restored state.
    this.flushTopEdit();
    const entry = this.undoStack.pop();
    if (!entry) {
      return;
    }
    this.applyHistory(entry, 'undo');
    this.redoStack.push(entry);
    this.emitMap();
    this.emitState();
  }

  redo() {
    this.flushTopEdit();
    const entry = this.redoStack.pop();
    if (!entry) {
      return;
    }
    this.applyHistory(entry, 'redo');
    this.undoStack.push(entry);
    this.emitMap();
    this.emitState();
  }

  applyHistory(entry, direction) {
    if (entry.kind === 'terrain') {
      this.tileMap.applyPatch(entry.patch, direction);
      this.terrainView.updatePatch(entry.patch);
      return;
    }

    if (entry.kind === 'height') {
      this.heightField.applyPatch(entry.patch, direction);
      this.terrainView.updateHeightPatch(entry.patch);
      return;
    }

    if (entry.kind === 'object') {
      this.objectMap.applyChange(entry, direction);
      this.refreshObjects();
      return;
    }

    if (entry.kind === 'construction') {
      this.constructionStore?.applyChange(entry, direction);
      const target = direction === 'undo' ? entry.before : entry.after;
      this.setSelectedConstruction(target?.id ?? null);
      return;
    }

    if (entry.kind === 'world') {
      this.tileMap.applyPatch(entry.terrainPatch, direction);
      this.heightField.applyPatch(entry.heightPatch, direction);
      this.terrainView.updatePatch(entry.terrainPatch);
      this.terrainView.updateHeightPatch(entry.heightPatch);
      this.objectMap.replaceAll(direction === 'undo' ? entry.beforeObjects : entry.afterObjects);
      this.setSelectedObject(null);
      this.refreshObjects();
    }
  }

  clearWorld() {
    const beforeObjects = this.objectMap.clear();
    const terrainPatch = this.tileMap.fill(0);
    const heightPatch = this.heightField.fill(0);
    if (beforeObjects.length === 0
        && terrainPatch.indices.length === 0
        && heightPatch.indices.length === 0) {
      return;
    }

    this.commitHistory({
      kind: 'world',
      terrainPatch,
      heightPatch,
      beforeObjects,
      afterObjects: [],
    });
    this.setSelectedObject(null);
    this.terrainView.updatePatch(terrainPatch);
    this.terrainView.updateHeightPatch(heightPatch);
    this.refreshObjects();
    this.emitMap();
  }

  toDocument() {
    return createWorldDocument(this.tileMap, this.heightField, this.objectMap);
  }

  loadDocument(document) {
    loadWorldDocument(document, this.tileMap, this.heightField, this.objectMap);
    this.terrainView.refreshAll();
    this.refreshObjects();
    this.undoStack = [];
    this.redoStack = [];
    this.setSelectedObject(null);
    this.emitMap();
    this.emitState();
  }

  focusCell(x, z) {
    const world = this.terrainView.cellToWorld(x, z);
    this.editorCamera.focusWorld(world.x, world.z);
  }

  resetCamera() {
    this.editorCamera.reset();
  }

  isWorldInputBlocked() {
    return Boolean(this.worldInputBlockedProvider?.());
  }

  /** Drop in-progress paint/construction gestures when a gameplay overlay opens. */
  cancelBlockedWorldInteraction() {
    if (this.painting) {
      this.painting = false;
      this.stroke = null;
      this.strokeKind = null;
      this.lastPaintKey = null;
    }
    this.cancelConstructionGesture();
    this.movingObjectId = null;
  }

  onPointerDown(event) {
    if (this.isWorldInputBlocked()) {
      return;
    }
    // Right-drag is the only orbit control (EditorCamera binds RIGHT to
    // ROTATE and leaves LEFT null), so a right-click menu has to share the
    // button rather than take it. Record the press and decide on release:
    // a tap opens the palette, a drag orbits. Deliberately no preventDefault —
    // MapControls still needs the event to begin its orbit, and a tap therefore
    // leaks a few pixels of rotation, which is imperceptible and cheaper than
    // snapshotting camera state that would desync with damping.
    if (event.button === SECONDARY_POINTER_BUTTON) {
      this.rightPointerStart = this.tool === 'construction'
        ? { x: event.clientX, y: event.clientY, time: event.timeStamp }
        : null;
      return;
    }
    if (event.button !== PRIMARY_POINTER_BUTTON || this.spacePressed) {
      return;
    }

    event.preventDefault();
    if (this.tool === 'construction' && this.constructionStore && this.constructionView) {
      this.onConstructionPointerDown(event);
      return;
    }
    if (this.tool === 'terrain') {
      this.canvas.setPointerCapture(event.pointerId);
      this.painting = true;
      this.stroke = new Map();
      this.strokeKind = this.terrainMode === 'paint' ? 'terrain' : 'height';
      this.lastPaintKey = null;
      this.editTerrainFromPointer(event, true);
      return;
    }

    if (this.tool === 'object') {
      const cell = this.terrainView.pickCell(event.clientX, event.clientY, this.activeCamera);
      if (cell) {
        this.placeObject(cell);
      }
      return;
    }

    if (this.movingObjectId) {
      const cell = this.terrainView.pickCell(event.clientX, event.clientY, this.activeCamera);
      if (cell) {
        this.moveSelectedTo(cell);
      }
      return;
    }

    const objectId = this.objectView.pickObject(
      event.clientX,
      event.clientY,
      this.activeCamera,
    );
    this.setSelectedObject(objectId);
    this.emitState();
  }

  onPointerMove(event) {
    if (this.isWorldInputBlocked()) {
      if (this.painting || this.constructionDrawing || this.constructionAnchorDrag) {
        this.cancelBlockedWorldInteraction();
      }
      return;
    }
    const cell = this.terrainView.pickCell(event.clientX, event.clientY, this.activeCamera);
    this.hoveredCell = cell;
    this.updatePreviews();
    this.emitHover(cell);

    if (this.tool === 'construction' && this.constructionView) {
      this.onConstructionPointerMove(event);
      // Only track the hovered arc when no gesture owns the pointer, so a
      // drag cannot retarget the raise/lower keys mid-stroke.
      if (!this.constructionDrawing && !this.constructionAnchorDrag) {
        this.updateConstructionHover(event);
      }
    }

    if (this.painting && !this.spacePressed) {
      this.editTerrainFromPointer(event, false);
    }
  }

  onPointerUp(event) {
    if (event.button === SECONDARY_POINTER_BUTTON) {
      const start = this.rightPointerStart;
      this.rightPointerStart = null;
      if (!start) return;
      const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      const elapsed = event.timeStamp - start.time;
      if (travel <= POINTER_TAP_DISTANCE && elapsed <= POINTER_TAP_MS) {
        this.openConstructionPalette(event);
      }
      return;
    }
    if (
      event.button === PRIMARY_POINTER_BUTTON
      && (this.constructionDrawing || this.constructionAnchorDrag)
    ) {
      this.onConstructionPointerUp(event);
      return;
    }
    if (event.button !== PRIMARY_POINTER_BUTTON || !this.painting) {
      return;
    }

    this.painting = false;
    this.lastPaintKey = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.finishStroke();
  }

  pickCanonicalConstructionPoint(event) {
    const render = this.terrainView.pickWorld(
      event.clientX,
      event.clientY,
      this.activeCamera,
    );
    if (!render) return null;
    const canonical = this.terrainView.floatingOrigin
      ? this.terrainView.floatingOrigin.toCanonical(render.x, render.z)
      : render;
    return { x: canonical.x, z: canonical.z };
  }

  /**
   * Turn a finished Alt-drag into openings on the walls it touched.
   *
   * Each crossing becomes an arch; a stroke that stops against a wall becomes a
   * door. Repeated strokes stack arches until the field masonry between them is
   * consumed, which is how a standalone arcade gets built.
   */
  commitCutStroke(stroke) {
    if (!this.constructionStore || stroke.length < 2) return;
    const records = this.constructionStore.list();
    const cuts = resolveCutStroke(stroke, records, {
      arcTableFor: (id) => this.constructionView?.arcTableFor(id) ?? null,
      heightAt: (record, s) => {
        const arcTable = this.constructionView?.arcTableFor(record.id);
        if (!arcTable) return record.dimensions.height;
        return createWallTopProfile(record, arcTable).heightAt(s);
      },
    });
    if (cuts.length === 0) {
      this.emitNotice('Draw across a wall to carve an arch, or up to one for a door.', true);
      return;
    }
    let added = 0;
    for (const cut of cuts) {
      const record = this.constructionStore.get(cut.constructionId);
      if (!record) continue;
      const featureId = nextOpeningFeatureId(record);
      const change = this.runConstructionCommand({
        type: 'add_feature',
        constructionId: cut.constructionId,
        feature: {
          id: featureId,
          kind: cut.kind,
          segmentId: cut.segmentId,
          arcFraction: cut.arcFraction,
          width: cut.width,
          height: cut.height,
          sill: 0,
          profile: 'round',
          dressed: true,
        },
      });
      if (change) added += 1;
    }
    if (added > 0) {
      this.emitNotice(`Carved ${added} opening${added === 1 ? '' : 's'}.`);
      this.emitMap();
    }
  }

  /** Insert a node where the pointer meets a wall. Returns true if it landed. */
  insertConstructionAnchorAt(event) {
    const hit = this.constructionView.pickConstructionPoint(
      event.clientX,
      event.clientY,
      this.activeCamera,
    );
    if (!hit) return false;
    const record = this.constructionStore.get(hit.constructionId);
    if (!record) return false;
    const closest = closestPointOnCubicBezierPath(record.path, { x: hit.x, z: hit.z });
    if (!closest) return false;
    this.setSelectedConstruction(hit.constructionId);
    const change = this.runConstructionCommand({
      type: 'insert_anchor',
      constructionId: hit.constructionId,
      segmentId: closest.segmentId,
      t: closest.t,
    });
    this.emitState();
    return change !== null;
  }

  /** Delete the selected node, or the whole wall when no node is selected. */
  deleteConstructionSelection() {
    if (!this.selectedConstructionId) return;
    if (!this.selectedAnchorId) {
      this.deleteSelectedConstruction();
      return;
    }
    const anchorId = this.selectedAnchorId;
    this.selectedAnchorId = null;
    const change = this.runConstructionCommand({
      type: 'delete_anchor',
      constructionId: this.selectedConstructionId,
      anchorId,
    });
    if (change?.dropped > 0) {
      this.emitNotice(
        `Dropped ${change.dropped} wall detail${change.dropped === 1 ? '' : 's'} on the removed span.`,
      );
    }
    this.emitState();
  }

  onConstructionPointerDown(event) {
    if (this.constructionMode === 'edit') {
      const handle = this.constructionView.pickHandle(
        event.clientX,
        event.clientY,
        this.activeCamera,
      );
      if (handle) {
        const before = this.constructionStore.get(handle.constructionId);
        this.selectedAnchorId = handle.anchorId;
        this.constructionAnchorDrag = {
          ...handle,
          before,
          candidate: before,
          snap: null,
        };
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      this.selectedAnchorId = null;
      // Double-clicking a wall inserts a node there. The split is exact, so the
      // wall does not move — adding a control point must never feel like a
      // mistake the user has to undo.
      if (event.detail >= 2 && this.insertConstructionAnchorAt(event)) return;
      const constructionId = this.constructionView.pickConstruction(
        event.clientX,
        event.clientY,
        this.activeCamera,
      );
      this.setSelectedConstruction(constructionId);
      this.emitState();
      return;
    }

    const point = this.pickCanonicalConstructionPoint(event);
    if (!point) return;
    this.setSelectedConstruction(null);
    this.constructionStroke = [point];
    this.constructionDrawing = true;
    // Alt turns the freehand gesture into a cut: the stroke carves openings in
    // the walls it crosses instead of becoming a wall itself.
    this.constructionCutStroke = event.altKey;
    this.canvas.setPointerCapture(event.pointerId);
    this.emitState();
  }

  onConstructionPointerMove(event) {
    const point = this.pickCanonicalConstructionPoint(event);
    if (!point) return;
    if (this.constructionDrawing && this.constructionStroke) {
      const previous = this.constructionStroke.at(-1);
      if (Math.hypot(point.x - previous.x, point.z - previous.z) >= 0.12) {
        this.constructionStroke.push(point);
      }
      if (this.constructionCutStroke) {
        // A cut is not a wall, so it gets no wall preview. Masonry is never
        // touched during the drag either — the openings land on commit.
        return;
      }
      if (this.constructionStroke.length >= 2) {
        try {
          const path = createCubicBezierPathFromStroke(this.constructionStroke, {
            anchorPrefix: 'preview-anchor',
            segmentPrefix: 'preview-segment',
          });
          const record = this.constructionDraftRecord(path, 'construction-preview');
          this.constructionView.setDraft(record, {
            valid: findCubicBezierSelfIntersections(path).length === 0,
          });
        } catch {
          this.constructionView.clearDraft();
        }
      }
      return;
    }

    if (this.constructionAnchorDrag) {
      const drag = this.constructionAnchorDrag;
      // Snapping is on by default; Left Ctrl suppresses it. Both source
      // descriptions of the reference game reduce to this one rule.
      const snap = resolveAnchorSnap({
        candidate: point,
        path: drag.before.path,
        anchorId: drag.anchorId,
        others: this.otherConstructionPaths(drag.constructionId),
        enabled: !event.ctrlKey,
      });
      drag.snap = snap;
      let path = moveCubicBezierAnchor(
        drag.before.path,
        drag.anchorId,
        snap ? { x: snap.position[0], z: snap.position[1] } : point,
      );
      if (snap?.flattenHandles) path = flattenHandlesAround(path, drag.anchorId);
      drag.candidate = {
        ...drag.before,
        revision: drag.before.revision + 1,
        path,
        features: path.features,
      };
      this.constructionView.setDraft(drag.candidate, {
        constructionId: drag.constructionId,
        valid: findCubicBezierSelfIntersections(path).length === 0,
        snapKind: snap?.kind ?? null,
        anchorId: drag.anchorId,
      });
    }
  }

  /** Every other construction's path, as snap targets. */
  otherConstructionPaths(exceptId) {
    if (!this.constructionStore) return [];
    return this.constructionStore.list()
      .filter((record) => record.id !== exceptId && record.path.type === 'cubicBezier')
      .map((record) => ({ constructionId: record.id, path: record.path }));
  }

  onConstructionPointerUp(event) {
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    if (this.constructionDrawing) {
      const stroke = this.constructionStroke ?? [];
      const cutting = this.constructionCutStroke;
      this.constructionDrawing = false;
      this.constructionStroke = null;
      this.constructionCutStroke = false;
      this.constructionView.clearDraft();
      if (cutting) {
        this.commitCutStroke(stroke);
        this.emitState();
        return;
      }
      if (
        stroke.length < 2
        || Math.hypot(stroke.at(-1).x - stroke[0].x, stroke.at(-1).z - stroke[0].z) < 0.5
      ) {
        this.emitNotice('Drag at least 0.5 metres to create a wall.', true);
        this.emitState();
        return;
      }
      try {
        const id = this.constructionStore.nextConstructionId();
        const path = createCubicBezierPathFromStroke(stroke, {
          anchorPrefix: `${id}-anchor`,
          segmentPrefix: `${id}-segment`,
        });
        if (findCubicBezierSelfIntersections(path).length > 0) {
          throw new Error('Construction paths cannot intersect themselves.');
        }
        const change = executeConstructionCommand(this.constructionStore, {
          type: 'create',
          record: this.constructionDraftRecord(path, id),
        });
        this.commitHistory(change);
        this.setSelectedConstruction(id);
        this.constructionMode = 'edit';
        this.emitMap();
      } catch (error) {
        this.emitNotice(error.message, true);
      }
      this.emitState();
      return;
    }

    if (this.constructionAnchorDrag) {
      const drag = this.constructionAnchorDrag;
      this.constructionAnchorDrag = null;
      this.constructionView.clearDraft();
      try {
        if (findCubicBezierSelfIntersections(drag.candidate.path).length > 0) {
          throw new Error('Construction paths cannot intersect themselves.');
        }
        const anchor = drag.candidate.path.anchors.find(({ id }) => id === drag.anchorId);
        // Dragging one end onto the other closes the loop: the dragged anchor
        // is dropped and the wrap-around segment takes its place, so a circle
        // comes out seamless rather than with a doubled anchor at the seam.
        const change = drag.snap?.closesLoop
          ? executeConstructionCommand(this.constructionStore, {
            type: 'close_path',
            constructionId: drag.constructionId,
            dropAnchorId: drag.anchorId,
          })
          : executeConstructionCommand(this.constructionStore, {
            type: 'move_anchor',
            constructionId: drag.constructionId,
            anchorId: drag.anchorId,
            position: anchor.position,
            flattenHandles: drag.snap?.flattenHandles === true,
          });
        this.commitHistory(change);
        if (change.dropped > 0) {
          this.emitNotice(
            `Dropped ${change.dropped} wall detail${change.dropped === 1 ? '' : 's'} on the removed span.`,
          );
        }
        this.setSelectedConstruction(drag.constructionId);
        this.emitMap();
      } catch (error) {
        this.emitNotice(error.message, true);
      }
      this.emitState();
    }
  }

  constructionDraftRecord(path, id) {
    const numericId = Number.parseInt(String(id).match(/[0-9]+/)?.[0] ?? '1', 10);
    return {
      version: 1,
      id,
      revision: 1,
      seed: numericId,
      kind: 'wall',
      label: `Curved wall ${numericId}`,
      style: { key: 'coursed-rubble', version: 1 },
      dimensions: {
        height: this.constructionHeight,
        thickness: this.constructionThickness,
      },
      path,
      features: path.features,
    };
  }

  cancelConstructionGesture() {
    // Settle any buffered raise/lower first: leaving the store ahead of history
    // across a tool or selection change would strand the edit un-undoable.
    this.flushTopEdit();
    this.constructionDrawing = false;
    this.constructionStroke = null;
    this.constructionAnchorDrag = null;
    this.hoveredArc = null;
    this.constructionView?.clearDraft();
  }

  onPointerLeave() {
    if (this.painting) {
      return;
    }
    this.hoveredCell = null;
    this.updatePreviews();
    this.emitHover(null);
  }

  editTerrainFromPointer(event, force) {
    const now = performance.now();
    if (!force && now - this.lastPaintAt < PAINT_INTERVAL_MS) {
      return;
    }

    const cell = this.terrainView.pickCell(event.clientX, event.clientY, this.activeCamera);
    if (!cell) {
      return;
    }

    const key = `${cell.x}:${cell.z}`;
    if (!force && key === this.lastPaintKey) {
      return;
    }

    const patch = this.terrainMode === 'paint'
      ? this.paintTiles(cell)
      : this.sculptHeight(cell);
    this.lastPaintKey = key;
    this.lastPaintAt = now;

    if (patch.indices.length === 0) {
      return;
    }

    this.mergeStroke(patch);
    if (this.terrainMode === 'paint') {
      this.terrainView.updatePatch(patch);
    } else {
      this.terrainView.updateHeightPatch(patch);
      this.emitHover(cell);
    }
    this.emitMap(false);
  }

  paintTiles(cell) {
    return this.tileMap.paintSquare(
      cell.x,
      cell.z,
      this.brushSize,
      this.selectedTileId,
      (x, z) => this.objectMap.canSetTerrain(x, z, this.selectedTileId),
    );
  }

  sculptHeight(cell) {
    return this.heightField.sculpt({
      centerX: cell.x,
      centerZ: cell.z,
      brushSize: this.brushSize,
      operation: this.terrainMode,
      strength: this.terrainConfig.sculptStrength,
      smoothFactor: this.terrainConfig.smoothFactor,
      minHeight: this.terrainConfig.minHeight,
      maxHeight: this.terrainConfig.maxHeight,
      canEdit: (vertexX, vertexZ) => this.canSculptVertex(vertexX, vertexZ),
    });
  }

  canSculptVertex(vertexX, vertexZ) {
    for (let z = vertexZ - 1; z <= vertexZ; z += 1) {
      for (let x = vertexX - 1; x <= vertexX; x += 1) {
        if (this.tileMap.inBounds(x, z) && this.objectMap.findAt(x, z)) {
          return false;
        }
      }
    }
    return true;
  }

  mergeStroke(patch) {
    for (let offset = 0; offset < patch.indices.length; offset += 1) {
      const index = patch.indices[offset];
      const existing = this.stroke.get(index);
      if (existing) {
        existing.after = patch.after[offset];
      } else {
        this.stroke.set(index, {
          before: patch.before[offset],
          after: patch.after[offset],
        });
      }
    }
  }

  finishStroke() {
    if (!this.stroke || this.stroke.size === 0) {
      this.stroke = null;
      this.strokeKind = null;
      return;
    }

    const patch = { indices: [], before: [], after: [] };
    for (const [index, change] of this.stroke.entries()) {
      patch.indices.push(index);
      patch.before.push(change.before);
      patch.after.push(change.after);
    }

    const kind = this.strokeKind;
    this.stroke = null;
    this.strokeKind = null;
    this.commitHistory({ kind, patch });
    this.emitMap();
  }

  validateObjectPlacement({ definitionKey, x, z, rotation, ignoreObjectId = null }) {
    const validation = this.objectMap.validatePlacement({
      definitionKey,
      x,
      z,
      rotation,
      ignoreObjectId,
    });
    if (!validation.valid) {
      return validation;
    }

    const bounds = this.objectMap.getBounds(x, z, definitionKey, rotation);
    for (let vertexZ = bounds.minZ; vertexZ <= bounds.maxZ + 1; vertexZ += 1) {
      for (let vertexX = bounds.minX; vertexX <= bounds.maxX + 1; vertexX += 1) {
        const height = this.heightField.getVertex(vertexX, vertexZ) ?? 0;
        if (Math.abs(height) > ELEVATED_PLACEMENT_TOLERANCE) {
          return {
            valid: false,
            reason: 'Elevated object placement will be enabled in the next terrain phase.',
          };
        }
      }
    }

    return validation;
  }

  placeObject(cell) {
    const validation = this.validateObjectPlacement({
      definitionKey: this.selectedObjectKey,
      x: cell.x,
      z: cell.z,
      rotation: this.objectRotation,
    });
    if (!validation.valid) {
      this.emitNotice(validation.reason, true);
      return;
    }

    const after = this.objectMap.place({
      definitionKey: this.selectedObjectKey,
      x: cell.x,
      z: cell.z,
      rotation: this.objectRotation,
    });
    this.commitHistory({ kind: 'object', before: null, after });
    this.refreshObjects();
    this.emitMap();
  }

  moveSelectedTo(cell) {
    const before = this.movingObjectId
      ? this.objectMap.getById(this.movingObjectId)
      : null;
    if (!before) {
      this.movingObjectId = null;
      return;
    }

    const validation = this.validateObjectPlacement({
      definitionKey: before.definitionKey,
      x: cell.x,
      z: cell.z,
      rotation: before.rotation,
      ignoreObjectId: before.id,
    });
    if (!validation.valid) {
      this.emitNotice(validation.reason, true);
      return;
    }

    try {
      const after = this.objectMap.transform(before.id, {
        x: cell.x,
        z: cell.z,
        rotation: before.rotation,
      });
      this.movingObjectId = null;
      this.commitHistory({ kind: 'object', before, after });
      this.refreshObjects();
      this.emitMap();
    } catch (error) {
      this.emitNotice(error.message, true);
    }
  }

  /**
   * Track which point of which wall the pointer is over, in arc length.
   *
   * `closestPointOnCubicBezierPath` returns the Bézier parameter `t`, not an
   * arc fraction; converting through `arcFractionForParameter` is what keeps a
   * raise landing under the cursor on an unevenly parameterised curve.
   */
  updateConstructionHover(event) {
    if (this.tool !== 'construction' || !this.constructionView || !this.constructionStore) {
      this.hoveredArc = null;
      return;
    }
    const hit = this.constructionView.pickConstructionPoint(
      event.clientX,
      event.clientY,
      this.activeCamera,
    );
    if (!hit) {
      this.hoveredArc = null;
      return;
    }
    const record = this.constructionStore.get(hit.constructionId);
    const arcTable = this.constructionView.arcTableFor(hit.constructionId);
    if (!record || !arcTable) {
      this.hoveredArc = null;
      return;
    }
    const closest = closestPointOnCubicBezierPath(record.path, { x: hit.x, z: hit.z });
    this.hoveredArc = {
      constructionId: hit.constructionId,
      s: arcTable.toArc(
        closest.segmentId,
        arcTable.arcFractionForParameter(closest.segmentId, closest.t),
      ),
    };
  }

  adjustConstructionTopRadius(delta) {
    const [low, high] = TOP_RADIUS_RANGE;
    this.constructionTopRadius = Math.max(
      low,
      Math.min(high, this.constructionTopRadius + delta),
    );
    this.emitNotice(`Wall top radius ${this.constructionTopRadius.toFixed(1)} m`);
    this.emitState();
  }

  /**
   * Raise or lower the wall top under the pointer.
   *
   * The edit is applied to the store immediately so it is visible while the key
   * is held, but the history entry is deferred: `pendingTopEdit` keeps the
   * pre-burst record so one undo reverses the whole burst.
   */
  nudgeConstructionTop(direction) {
    if (this.tool !== 'construction' || !this.hoveredArc || !this.constructionStore) return;
    const { constructionId, s } = this.hoveredArc;
    const record = this.constructionStore.get(constructionId);
    const arcTable = this.constructionView?.arcTableFor(constructionId);
    if (!record || !arcTable) return;

    const top = applyTopEdit(record, arcTable, {
      centre: s,
      direction,
      radius: this.constructionTopRadius,
    });
    if (!top) return;

    if (!this.pendingTopEdit || this.pendingTopEdit.constructionId !== constructionId) {
      this.flushTopEdit();
      this.pendingTopEdit = { constructionId, before: record };
    }
    this.constructionStore.update(constructionId, { ...record, top }, {
      dirtySegmentIds: [...new Set([
        ...record.top.profile.map(({ segmentId }) => segmentId),
        ...top.profile.map(({ segmentId }) => segmentId),
      ])],
    });
    this.scheduleTopEditCommit();
    this.emitState();
  }

  scheduleTopEditCommit() {
    clearTimeout(this.pendingTopEditTimer);
    this.pendingTopEditTimer = setTimeout(() => this.flushTopEdit(), TOP_EDIT_COMMIT_MS);
  }

  /**
   * Turn a settled burst into one history entry.
   *
   * Must run before undo/redo: otherwise Ctrl+Z mid-burst would pop the
   * *previous* entry and the buffered edit would then land on top of it.
   */
  flushTopEdit() {
    clearTimeout(this.pendingTopEditTimer);
    this.pendingTopEditTimer = null;
    const pending = this.pendingTopEdit;
    this.pendingTopEdit = null;
    if (!pending) return;
    const after = this.constructionStore?.get(pending.constructionId);
    if (!after) return;
    const segments = new Set([
      ...pending.before.top.profile.map(({ segmentId }) => segmentId),
      ...after.top.profile.map(({ segmentId }) => segmentId),
    ]);
    this.commitHistory(Object.freeze({
      kind: 'construction',
      before: pending.before,
      after,
      dirtySegmentIds: Object.freeze([...segments]),
      materialOnly: false,
    }));
  }

  /**
   * Open the radial palette on the wall under the cursor.
   *
   * Set by the composition root; without one the right button is left entirely
   * to the camera, which is the correct fallback rather than a broken menu.
   */
  openConstructionPalette(event) {
    if (!this.constructionPalette || !this.constructionView) return;
    const constructionId = this.constructionView.pickConstruction(
      event.clientX,
      event.clientY,
      this.activeCamera,
    );
    if (!constructionId) return;
    this.setSelectedConstruction(constructionId);
    this.constructionPalette.open(constructionId, event);
    this.emitState();
  }

  /** Live material preview while a palette petal is hovered. */
  previewConstructionMaterial(constructionId, presetId) {
    this.constructionView?.setMaterialPreview(constructionId, presetId);
  }

  /** Palette action: discard the profile and keep the wall's mean height. */
  setConstructionTopStyle(style) {
    const constructionId = this.selectedConstructionId ?? this.hoveredArc?.constructionId;
    if (!constructionId || !this.constructionStore) return;
    const record = this.constructionStore.get(constructionId);
    const arcTable = this.constructionView?.arcTableFor(constructionId);
    if (!record || !arcTable) return;
    this.flushTopEdit();
    const top = style === 'flat'
      ? flattenTop(record, arcTable)
      : { ...record.top, style };
    this.runConstructionCommand({ type: 'set_top_profile', constructionId, top });
  }

  commitHistory(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.emitState();
  }

  /**
   * Build-tool key handling. Returns true when the press was consumed.
   *
   * Arrow keys raise and lower the wall top under the pointer; `[` and `]`
   * size the falloff. Both are only claimed while the Build tool is active and
   * a wall is actually hovered, so nothing is stolen from the other tools.
   */
  handleConstructionKeyDown(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!this.hoveredArc) return false;
        event.preventDefault();
        this.nudgeConstructionTop(event.key === 'ArrowUp' ? 1 : -1);
        return true;
      }
      case '[':
      case ']':
        event.preventDefault();
        this.adjustConstructionTopRadius(event.key === '[' ? -0.5 : 0.5);
        return true;
      default:
        return false;
    }
  }

  onKeyDown(event) {
    if (this.isWorldInputBlocked()) {
      return;
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.code === 'Space' && !this.spacePressed) {
      event.preventDefault();
      this.spacePressed = true;
      this.editorCamera.setLeftPanEnabled(true);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
      return;
    }

    // Build-tool keys are claimed before the shared shortcuts so the wall-top
    // gesture can reuse `[`/`]` without taking them away from the brush in
    // every other tool.
    if (this.tool === 'construction' && this.handleConstructionKeyDown(event)) {
      return;
    }

    const tile = TILE_BY_SHORTCUT.get(event.key);
    if (tile) {
      this.selectTile(tile.id);
      return;
    }

    const terrainMode = TERRAIN_MODE_BY_SHORTCUT[event.key.toLowerCase()];
    if (terrainMode) {
      this.selectTerrainMode(terrainMode);
      return;
    }

    switch (event.key.toLowerCase()) {
      case 't':
        this.selectTool('terrain');
        break;
      case 'o':
        this.selectTool('object');
        break;
      case 'v':
        this.selectTool('select');
        break;
      case 'c':
        this.selectTool('construction');
        break;
      case 'r':
        this.tool === 'select' ? this.rotateSelected() : this.rotatePlacement();
        break;
      case 'delete':
      case 'backspace':
        if (this.tool === 'construction' && this.selectedConstructionId) {
          event.preventDefault();
          this.deleteConstructionSelection();
        } else if (this.tool === 'select') {
          event.preventDefault();
          this.deleteSelected();
        }
        break;
      case 'escape':
        this.cancelConstructionGesture();
        this.movingObjectId = null;
        this.setSelectedObject(null);
        this.emitState();
        break;
      case '[':
        this.cycleBrush(-1);
        break;
      case ']':
        this.cycleBrush(1);
        break;
      default:
        break;
    }
  }

  onKeyUp(event) {
    if (event.code !== 'Space') {
      return;
    }
    this.spacePressed = false;
    this.editorCamera.setLeftPanEnabled(false);
  }

  cycleBrush(direction) {
    const currentIndex = this.brushSizes.indexOf(this.brushSize);
    const nextIndex = Math.max(0, Math.min(this.brushSizes.length - 1, currentIndex + direction));
    this.selectBrush(this.brushSizes[nextIndex]);
  }

  updatePreviews() {
    if (this.tool === 'construction') {
      this.terrainView.setPreview(null);
      this.objectView.setPreview(null);
      return;
    }
    if (this.tool === 'terrain') {
      const color = this.terrainMode === 'paint'
        ? this.tileMap.getTileDefinition(this.selectedTileId).color
        : TERRAIN_PREVIEW_COLORS[this.terrainMode];
      this.terrainView.setPreview(this.hoveredCell, this.brushSize, color);
      this.objectView.setPreview(null);
      return;
    }

    this.terrainView.setPreview(null);
    if (!this.hoveredCell) {
      this.objectView.setPreview(null);
      return;
    }

    if (this.tool === 'select' && this.movingObjectId) {
      const object = this.objectMap.getById(this.movingObjectId);
      const validation = this.validateObjectPlacement({
        definitionKey: object.definitionKey,
        x: this.hoveredCell.x,
        z: this.hoveredCell.z,
        rotation: object.rotation,
        ignoreObjectId: object.id,
      });
      this.objectView.setPreview({
        definitionKey: object.definitionKey,
        x: this.hoveredCell.x,
        z: this.hoveredCell.z,
        rotation: object.rotation,
        valid: validation.valid,
      });
      return;
    }

    if (this.tool !== 'object') {
      this.objectView.setPreview(null);
      return;
    }

    const validation = this.validateObjectPlacement({
      definitionKey: this.selectedObjectKey,
      x: this.hoveredCell.x,
      z: this.hoveredCell.z,
      rotation: this.objectRotation,
    });
    this.objectView.setPreview({
      definitionKey: this.selectedObjectKey,
      x: this.hoveredCell.x,
      z: this.hoveredCell.z,
      rotation: this.objectRotation,
      valid: validation.valid,
    });
  }

  setSelectedObject(objectId) {
    const numericId = objectId === null || objectId === undefined ? null : Number(objectId);
    this.selectedObjectId = numericId && this.objectMap.getById(numericId) ? numericId : null;
    if (!this.selectedObjectId) {
      this.movingObjectId = null;
    }
    this.objectView.setSelection(this.selectedObjectId);
  }

  refreshObjects() {
    if (this.selectedObjectId && !this.objectMap.getById(this.selectedObjectId)) {
      this.selectedObjectId = null;
    }
    this.objectView.refreshAll();
    this.objectView.setSelection(this.selectedObjectId);
    this.updatePreviews();
    this.emitState();
  }

  emitState() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  emitMap(final = true) {
    for (const listener of this.mapListeners) {
      listener({ final });
    }
  }

  emitHover(cell) {
    const tileId = cell ? this.tileMap.get(cell.x, cell.z) : null;
    const tile = tileId === null ? null : this.tileMap.getTileDefinition?.(tileId);
    const object = cell ? this.objectMap.findAt(cell.x, cell.z) : null;
    const objectDefinition = object
      ? this.objectMap.getDefinition(object.definitionKey)
      : null;
    const height = cell ? this.heightField.getCellHeight(cell.x, cell.z) : null;
    for (const listener of this.hoverListeners) {
      listener(cell ? { ...cell, height, tile, object, objectDefinition } : null);
    }
  }

  emitNotice(message, isError = false) {
    for (const listener of this.noticeListeners) {
      listener({ message, isError });
    }
  }

  dispose() {
    clearTimeout(this.pendingTopEditTimer);
    this.pendingTopEditTimer = null;
    this.canvas.removeEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.canvas.removeEventListener('pointermove', this.boundHandlers.pointerMove);
    this.canvas.removeEventListener('pointerup', this.boundHandlers.pointerUp);
    this.canvas.removeEventListener('pointercancel', this.boundHandlers.pointerUp);
    this.canvas.removeEventListener('pointerleave', this.boundHandlers.pointerLeave);
    this.canvas.removeEventListener('contextmenu', this.boundHandlers.contextMenu);
    window.removeEventListener('keydown', this.boundHandlers.keyDown);
    window.removeEventListener('keyup', this.boundHandlers.keyUp);
  }
}
