import * as THREE from 'three/webgpu';
import { cubicBezierPathBounds, sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { CONSTRUCTION_MATERIAL_SLOT } from './ConstructionMaterialSlots.js';
import { createConstructionMaterials, releaseConstructionMaterials } from './ConstructionMaterials.js';
import { ConstructionBuildQueue } from './ConstructionBuildQueue.js';
import { ConstructionModuleBuilder } from './ConstructionModuleBuilder.js';
import { ConstructionLodCache, masonryStats } from './ConstructionLodCache.js';
import { MODULE_STAT_KEYS, ROUNDED_STAT_KEYS, updateModuleStats } from './ConstructionModuleStats.js';
import { ConstructionResidency } from './ConstructionResidency.js';
import { ConstructionModuleResidency } from './ConstructionModuleResidency.js';
import { updateConstructionLod } from './ConstructionLodController.js';
import { ConstructionShellMaterials } from './ConstructionShellMaterials.js';
import { applyShellDetail, loadShellDetailTexture } from './ConstructionShellDetail.js';
import { coarsePlacementsForModule } from './ConstructionLod.js';
import {
  evaluateBuildRequest,
  moduleBuildKey,
} from '../compile/ConstructionLodState.js';
import {
  buildShellGeometry,
  buildWallGeometry,
  sampleShellPath,
  shellSectionPoints,
} from './ConstructionShell.js';
import {
  buildRuinDebugMeshes,
  disposeRuinDebugMeshes,
  isConstructionRuinDebugEnabled,
} from './ConstructionRuinDebug.js';
import { sampleRuinEnvelopeHeight } from '../masonry/RuinEnvelope.js';
import { refreshConstructionGrowth } from './ConstructionGrowthResidency.js';

const HANDLE_RADIUS = 0.16;
const TANGENT_HANDLE_RADIUS = 0.09;

/**
 * Record origins snap to this grid so an ordinary edit does not move the origin
 * and invalidate every module's geometry. 64 m is well inside float32's precise
 * range and coarse enough that dragging an anchor never crosses a cell.
 */
const ORIGIN_QUANTUM = 64;

/**
 * One preparation/publication step per frame. Browser geometry generation and
 * merging run in a worker; the non-browser builder remains resumable.
 */
const MODULE_BUILD_BUDGET_MS = 4;
const MODULE_BUILD_COUNT = 1;

/**
 * Preview buffer floor. Buffers grow by doubling from here, so dragging an
 * anchor reallocates nothing and only a genuinely longer replaced arc pays.
 */
const PREVIEW_BUFFER_MIN = 64;

/**
 * How long a committed draft may hold its preview while the replaced arc is
 * rebuilt at one module per frame. Past it the preview gives way, which shows
 * the pre-existing mixed state rather than a stale shape drawn over a wall
 * that is already correct.
 */
const PREVIEW_HOLD_MS = 1000;

/** A draft with nothing local to replace previews the whole record. */
const WHOLE_SPAN = Object.freeze({ from: 0, to: 1, whole: true });

/**
 * Slack where the committed sampling and the plan's arc domain meet: the edit
 * changes the wall's arc length, so a module boundary lands a few centimetres
 * from where it was. The replaced arc ignores overlaps that small when it picks
 * the modules to hide, and pads its own edges by the same amount, so the
 * preview neither leaves a sliver of wall uncovered nor eats into masonry the
 * drag never reached.
 */
const PREVIEW_SPAN_TOLERANCE = 0.25;

function quantizeOrigin(value) {
  return Math.round(value / ORIGIN_QUANTUM) * ORIGIN_QUANTUM;
}


/**
 * Resolve the material for one resident mesh from its explicit slot.
 * Selection tints stone only — mortar stays dark so joints keep contrast.
 */
export function residentMaterial(mesh, materials, selected) {
  const slot = mesh.userData.constructionMaterialSlot;
  if (slot === CONSTRUCTION_MATERIAL_SLOT.GROWTH) return materials.growth;
  if (slot === CONSTRUCTION_MATERIAL_SLOT.MORTAR) {
    return materials.mortar;
  }
  if (slot === CONSTRUCTION_MATERIAL_SLOT.STONE || slot == null) {
    return selected ? materials.stoneSelected : materials.stone;
  }
  console.warn(`Unknown construction material slot "${slot}"; using stone.`);
  return selected ? materials.stoneSelected : materials.stone;
}

function originForRecord(record) {
  const bounds = cubicBezierPathBounds(record.path);
  return {
    x: quantizeOrigin((bounds.minX + bounds.maxX) / 2),
    z: quantizeOrigin((bounds.minZ + bounds.maxZ) / 2),
  };
}

/**
 * The appearance a record's stone derives from: exactly the inputs
 * `createConstructionMaterials` keys its cache on. A reshape never touches it,
 * so re-using the material set across a commit cannot reroll the wall.
 */
function appearanceKey(record) {
  const { key, version, materials } = record.style ?? {};
  return [record.seed, key, version, JSON.stringify(materials ?? {})].join('|');
}

/** True once the record draws masonry rather than only its ribbon placeholder. */
function hasResidentMasonry(entry) {
  for (const resident of entry.modules.values()) {
    if (resident.meshes.length > 0) return true;
  }
  return false;
}

/** Doubling growth from a floor, so only a genuinely longer arc reallocates. */
function growPreviewCapacity(needed) {
  return Math.max(PREVIEW_BUFFER_MIN, 2 ** Math.ceil(Math.log2(needed)));
}

/**
 * The segments an anchor drag moves. A cubic only changes where its own handles
 * change, so the segments touching the dragged anchor are the whole of a
 * reshape's structural delta.
 */
function draftDirtySegments(record, anchorId) {
  const dirty = new Set();
  if (!anchorId) return dirty;
  for (const segment of record.path?.segments ?? []) {
    if (segment.startAnchorId === anchorId || segment.endAnchorId === anchorId) {
      dirty.add(segment.id);
    }
  }
  return dirty;
}

export class ConstructionView {
  constructor({ terrainView, store, compilerClient = null, materialStore = null, residencyRadius = 512, lodCacheOptions = {} }) {
    this.terrainView = terrainView;
    this.floatingOrigin = terrainView.floatingOrigin;
    this.scene = terrainView.scene;
    this.store = store;
    this.compilerClient = compilerClient;
    /** Optional; custom imported presets live here, built-ins resolve without it. */
    this.materialStore = materialStore;
    this.root = new THREE.Group();
    this.root.name = 'live-constructions';
    this.scene.add(this.root);
    /**
     * id -> { group, origin, shellMesh, modules: Map<moduleId, {hash}>, plan }.
     * `structuralRevision` is the last revision whose geometry the entry was
     * rebuilt from; an appearance-only change advances the record revision
     * without moving it.
     */
    this.entries = new Map();
    this.residency = new ConstructionResidency({ store, floatingOrigin: this.floatingOrigin,
      radius: residencyRadius, chunkWorldSize: terrainView.chunkWorldSize ?? 128 });
    this.buildQueue = new ConstructionBuildQueue();
    this.moduleBuilder = new ConstructionModuleBuilder({ terrainView });
    this.lodCache = new ConstructionLodCache(lodCacheOptions);
    this.lodCameraState = new Int32Array(10);
    this.lodCameraState.fill(0x7fffffff);
    this.lodDirty = true;
    this.nextLodEvaluationAt = 0;
    this.handleMeshes = [];
    this.handleLines = [];
    this.selectedId = null;
    this.selectedAnchorId = null;
    this.previewMesh = null;
    this.previewGeometry = null;
    this.previewOrigin = { x: 0, z: 0 };
    this.previewedConstructionId = null;
    /** The live draft: its gesture identity and the arc it replaces. */
    this.previewDraft = null;
    /**
     * Committed products the draft replaces, with the flags cancel restores.
     * Hiding is per product, never per record: the wall stays on screen.
     */
    this.previewOcclusion = null;
    /** A draft parked past its gesture until its replacement product lands. */
    this.previewHold = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.ruinDebugEnabled = typeof window !== 'undefined'
      ? isConstructionRuinDebugEnabled(window.location.search)
      : false;
    this.stats = {
      modulesResident: 0,
      modulesRebuilt: 0,
      modulesSkippedByHash: 0,
      queueDepth: 0,
      modulesNear: 0,
      modulesCoarse: 0,
      modulesShell: 0,
      lodTransitions: 0,
      stones: 0,
      mortarPrisms: 0,
      stoneTriangles: 0,
      mortarTriangles: 0,
      reliefStones: 0,
      reliefFallbacks: 0,
      reliefClamped: 0,
      reliefTriangles: 0,
      reliefBuildMs: 0,
      edgeWearEligible: 0,
      edgeWearStones: 0,
      edgeWearClamped: 0,
      edgeWearFallbacks: 0,
      flattenedCorners: 0,
      edgeWearTriangles: 0,
      edgeWearBuildMs: 0,
      nearSoftStones: 0,
      coarseSoftStones: 0,
      nearSoftTriangles: 0,
      coarseSoftTriangles: 0,
      appearanceDescriptors: 0,
      appearanceDescriptorMs: 0,
      lodReductionMs: 0,
      lodTransitionsStarted: 0,
      // Frames a module spent waiting on a transition it had already started.
      lodTransitionWaitFrames: 0,
      lodTransitionsCompleted: 0,
      duplicateBuildsSuppressed: 0,
      staleBuildsDiscarded: 0,
      nearBuilds: 0,
      coarseBuilds: 0,
      lodCacheHits: 0,
      buildMs: 0,
      stoneBuildMs: 0,
      mortarBuildMs: 0,
      /** Reused preview buffers allocated; flat across a drag over one arc. */
      previewBufferAllocations: 0,
      previewBufferWrites: 0,
      /** How often a gesture's replaced arc was recomputed rather than reused. */
      previewSpanChanges: 0,
      /** Committed products the current draft hides (a gauge, not a total). */
      previewOccludedProducts: 0,
      previewHolds: 0,
      previewStaleDrops: 0,
      ...Object.fromEntries(ROUNDED_STAT_KEYS.map((key) => [key, 0])),
    };
    this.shellDetail = loadShellDetailTexture();
    this.wallMaterial = applyShellDetail(new THREE.MeshStandardNodeMaterial({
      color: '#8d8879',
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    }), this.shellDetail);
    // Rounded styles get a ribbon tinted to their own stone; soft styles keep
    // `wallMaterial` itself.
    this.shellMaterials = new ConstructionShellMaterials(this.wallMaterial);
    this.selectedMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#d1ad58',
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // A valid draft is drawn with the wall's own shell (`draftMaterial`); only an
    // invalid one gets a tool colour, translucent so the reason stays visible.
    this.invalidPreviewMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#d26666',
      roughness: 0.88,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.handleGeometry = new THREE.SphereGeometry(HANDLE_RADIUS, 12, 8);
    this.tangentHandleGeometry = new THREE.SphereGeometry(TANGENT_HANDLE_RADIUS, 10, 8);
    this.handleMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe091',
      depthTest: false,
    });
    this.tangentHandleMaterial = new THREE.MeshBasicMaterial({
      color: '#9ec5ff',
      depthTest: false,
    });
    this.tangentLineMaterial = new THREE.LineBasicMaterial({
      color: '#9ec5ff',
      depthTest: false,
    });
    // Snapping is silent otherwise: the anchor just lands somewhere slightly
    // else and the user cannot tell a junction join from a grid nudge until
    // after releasing, by which point it is a surprise.
    this.snapMaterials = new Map(Object.entries({
      anchor: '#7ef0a4',
      curve: '#7ad9f0',
      straight: '#f0d97a',
      grid: '#c3c9d4',
      angle: '#c3c9d4',
    }).map(([kind, color]) => [
      kind,
      new THREE.MeshBasicMaterial({ color, depthTest: false }),
    ]));
    this.unsubscribe = store.subscribe((change) => this.onStoreChange(change));
    this.refreshAll();
  }

  positionGroup(entry) {
    const render = this.floatingOrigin.toRender(entry.origin.x, entry.origin.z);
    entry.group.position.set(render.x, 0, render.z);
  }

  removeRecord(constructionId) {
    this.lodCache.invalidate(constructionId);
    const entry = this.entries.get(constructionId);
    if (!entry) return;
    // Nothing left to restore: the products the draft hid are being disposed.
    if (this.previewOcclusion?.constructionId === constructionId) {
      this.previewOcclusion = null;
    }
    if (entry.ruinDebugMeshes?.length) {
      for (const mesh of entry.ruinDebugMeshes) entry.group.remove(mesh);
      disposeRuinDebugMeshes(entry.ruinDebugMeshes);
      entry.ruinDebugMeshes = [];
    }
    if (entry.shellMesh) entry.shellMesh.geometry.dispose();
    for (const module of entry.modules.values()) {
      updateModuleStats(this.stats, module.stats, null);
      this.disposeResidentBuild(module);
      for (const mesh of module.meshes ?? []) mesh.geometry.dispose();
      module.shellMesh?.geometry.dispose();
    }
    releaseConstructionMaterials(entry.materials);
    this.root.remove(entry.group);
    this.entries.delete(constructionId);
    this.lodDirty = true;
    this.buildQueue.removeConstruction(constructionId);
    this.stats.queueDepth = this.buildQueue.length;
    this.refreshResidentCount();
  }

  refreshResidentCount() {
    let resident = 0;
    for (const entry of this.entries.values()) resident += entry.modules.size;
    this.stats.modulesResident = resident;
  }

  upsertRecord(record, hint = null) {
    if (record.path.type !== 'cubicBezier') {
      this.removeRecord(record.id);
      return;
    }
    let entry = this.entries.get(record.id);
    const origin = originForRecord(record);
    if (entry && (entry.origin.x !== origin.x || entry.origin.z !== origin.z)) {
      // The origin moved, so every cached module's local space is stale.
      this.removeRecord(record.id);
      entry = null;
    }
    if (!entry) {
      const group = new THREE.Group();
      group.name = `construction:${record.id}`;
      group.userData.constructionId = record.id;
      this.root.add(group);
      entry = {
        group,
        origin,
        structuralRevision: 0,
        shellMesh: null,
        shellPath: null,
        modules: new Map(),
        plan: null,
        planRevision: 0,
        arcTable: null,
        materials: null,
        appearanceKey: null,
      };
      this.entries.set(record.id, entry);
    }
    if (entry.record && entry.record.revision !== record.revision) this.lodCache.invalidate(record.id);
    entry.record = record;
    this.positionGroup(entry);

    if (hint?.decorationOnly && entry.shellMesh) {
      if (this.moduleBuilder.geometryWorker) {
        for (const module of entry.plan?.modules ?? []) {
          const resident = entry.modules.get(module.id);
          if (!resident?.meshes.length) continue;
          this.disposeResidentBuild(resident);
          resident.growthOnlyPending = true;
          resident.pendingBuildKey = null;
          this.buildQueue.upsert({ constructionId: record.id, module,
            requestedBand: resident.builtBand, priority: -1 });
        }
        return;
      }
      refreshConstructionGrowth(entry, this.terrainView);
      this.refreshModuleStats();
      return;
    }
    if (hint?.materialOnly && entry.shellMesh) {
      // Geometry is unchanged; only the material assignment can differ.
      this.assignMaterials(entry, record, { force: true });
      this.applyEntryMaterials(entry);
      return;
    }

    // Rebuilt per revision: the arc table is the shared arc-length view the
    // masonry builder places against, and must match the path the plan solved.
    entry.arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
    this.assignMaterials(entry, record);

    // Cached so a module shell is a slice of the same sampled curve the record
    // shell used, rather than a second sampling that could seam differently.
    entry.shellPath = sampleShellPath(record);

    if (entry.shellMesh) {
      entry.group.remove(entry.shellMesh);
      entry.shellMesh.geometry.dispose();
    }
    const shellMesh = new THREE.Mesh(
      buildWallGeometry(record, this.terrainView, entry.origin),
      record.id === this.selectedId ? this.selectedMaterial : this.shellMaterials.forRecord(record),
    );
    shellMesh.name = `construction-shell:${record.id}`;
    shellMesh.userData.constructionId = record.id;
    shellMesh.castShadow = true;
    shellMesh.receiveShadow = true;
    entry.group.add(shellMesh);
    entry.shellMesh = shellMesh;
    entry.structuralRevision = record.revision;
    this.scheduleCompile(record, hint);
  }

  /**
   * Stone and mortar materials derive from the record's style and seed alone.
   * An appearance that did not change keeps the existing set: re-creating it
   * only churns the material cache, and a commit that rerolled the wall's stone
   * character would break the continuity this preview policy exists to keep.
   */
  assignMaterials(entry, record, { force = false } = {}) {
    const appearance = appearanceKey(record);
    if (!force && entry.materials && entry.appearanceKey === appearance) return;
    const previous = entry.materials;
    entry.materials = this.createMaterials(record);
    entry.appearanceKey = appearance;
    releaseConstructionMaterials(previous);
  }

  applyResidentMaterials(entry, selected, residents = entry.modules.values()) {
    if (!entry.materials) return;
    const shell = selected ? this.selectedMaterial : this.shellMaterials.forRecord(entry.record);
    for (const resident of residents) {
      for (const mesh of resident.meshes) {
        mesh.material = residentMaterial(mesh, entry.materials, selected);
      }
      if (resident.shellMesh) resident.shellMesh.material = shell;
    }
  }

  applyEntryMaterials(entry) {
    this.applySelectionMaterial(entry.record.id, entry);
  }

  applySelectionMaterial(constructionId, entry) {
    const selected = constructionId === this.selectedId;
    if (entry.shellMesh) {
      entry.shellMesh.material = selected
        ? this.selectedMaterial
        : this.shellMaterials.forRecord(entry.record);
    }
    this.applyResidentMaterials(entry, selected);
  }

  onStoreChange(change) {
    if (change.kind === 'clear' || change.kind === 'replace') {
      this.refreshAll();
      return;
    }
    if (change.after) {
      this.residency.update(change.after);
      if (this.entries.has(change.id) || this.residency.query(null, [this.selectedId]).has(change.id)) {
        this.upsertRecord(change.after, change.hint ?? null);
      }
    } else if (change.id) {
      this.residency.remove(change.id);
      this.removeRecord(change.id);
    }
    this.lodDirty = true;
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    if (change.id === this.selectedId || !this.selectedId) this.rebuildHandles();
  }

  refreshAll() {
    for (const id of [...this.entries.keys()]) this.removeRecord(id);
    this.residency.reset();
    this.refreshResidency();
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    this.rebuildHandles();
  }

  refreshResidency(camera = null) {
    const candidates = this.residency.query(camera, [this.selectedId, this.previewedConstructionId]);
    for (const id of this.entries.keys()) if (!candidates.has(id)) this.removeRecord(id);
    const started = performance.now();
    let added = 0;
    for (const id of candidates) {
      if (this.entries.has(id)) continue;
      if (added >= 4 || performance.now() - started >= 2) {
        this.lodDirty = true;
        break;
      }
      const record = this.store.get(id);
      if (record) { this.upsertRecord(record); added += 1; }
    }
    this.stats.recordsResident = this.entries.size;
    this.stats.recordsCandidates = candidates.size;
  }

  /**
   * Floating-origin rebase. Because module geometry is origin-local this is a
   * transform update, not a rebuild — which is the difference between a
   * multi-hundred-millisecond hitch and nothing at all once masonry lands.
   */
  rebase() {
    this.lodDirty = true;
    for (const entry of this.entries.values()) this.positionGroup(entry);
    this.repositionHandles();
    if (this.previewMesh) {
      const render = this.floatingOrigin.toRender(this.previewOrigin.x, this.previewOrigin.z);
      this.previewMesh.position.set(render.x, 0, render.z);
    }
  }

  scheduleCompile(record, hint = null) {
    if (!this.compilerClient) return;
    const compiledRevision = this.entries.get(record.id)?.structuralRevision ?? record.revision;
    const scheduledEntry = this.entries.get(record.id);
    this.compilerClient.compile(record).then((plan) => {
      // A material tint bumps the record revision without invalidating the
      // structure the plan solved, so only a newer structural edit discards it.
      if (this.entries.get(record.id) !== scheduledEntry
          || scheduledEntry?.structuralRevision !== compiledRevision) return;
      this.applyPlan(record, plan, hint);
    }).catch((error) => {
      if (error?.name !== 'AbortError') {
        console.error(`Construction ${record.id} planning failed.`, error);
      }
    });
  }

  /**
   * Reconcile the module set against a fresh plan.
   *
   * The per-module content hash is the authority on what changed: an anchor
   * drag reports four dirty segments but usually alters far less, and a hash
   * match means the module's inputs are byte-identical whatever the hint said.
   * The hint is kept on the change for the compiler client to narrow its
   * request set, not to gate rebuilds here.
   */
  applyPlan(record, plan, hint = null) {
    const entry = this.entries.get(record.id);
    if (!entry) return;
    entry.plan = plan;
    entry.planRevision = entry.structuralRevision;
    this.lodDirty = true;
    if (entry.shellMesh) entry.shellMesh.userData.structuralPlan = plan;
    this.rebuildRecordShell(entry, plan);
    entry.moduleResidency = new ConstructionModuleResidency(plan.modules, this.residency.index.chunkWorldSize);
    this.reconcileModuleResidency(entry);
    this.refreshRuinDebug(entry, plan);
  }

  reconcileModuleResidency(entry) {
    const plan = entry.plan;
    const record = entry.record;
    const modules = entry.moduleResidency.query(this.residency.focus, this.residency.radius);
    if (!entry.moduleResidency.changed && entry.activePlanModules) return;
    entry.activePlanModules = modules;
    const planned = new Set();
    for (const module of modules) {
      planned.add(module.id);
      const existing = entry.modules.get(module.id);
      if (existing && existing.hash === module.contentHash) {
        this.stats.modulesSkippedByHash += 1;
        continue;
      }
      if (existing) {
        this.disposeResidentBuild(existing);
        this.lodCache.invalidate(record.id, module.id);
      }
      const resident = {
        ...existing,
        hash: module.contentHash,
        meshes: existing?.meshes ?? [],
        requestedBand: existing?.requestedBand ?? null,
        builtBand: existing?.builtBand ?? null,
        visibleBand: existing?.visibleBand ?? existing?.band ?? null,
        requestedAt: existing?.requestedAt ?? 0,
        visibleSince: existing?.visibleSince ?? 0,
        pendingBuildKey: null,
        transition: null,
      };
      entry.modules.set(module.id, resident);
      this.buildModuleShell(entry, module, resident, plan);
      this.enqueueModuleBuild(record.id, module);
    }
    for (const moduleId of [...entry.modules.keys()]) {
      if (planned.has(moduleId)) continue;
      const stale = entry.modules.get(moduleId);
      this.lodCache.invalidate(record.id, moduleId);
      updateModuleStats(this.stats, stale.stats, null);
      this.buildQueue.removeModule(entry.record.id, moduleId);
      this.disposeResidentBuild(stale);
      for (const mesh of stale.meshes ?? []) {
        entry.group.remove(mesh);
        mesh.geometry.dispose();
      }
      if (stale.shellMesh) {
        entry.group.remove(stale.shellMesh);
        stale.shellMesh.geometry.dispose();
      }
      entry.modules.delete(moduleId);
    }
    this.refreshResidentCount();
    this.updateShellVisibility(entry);
  }

  /**
   * Rebuild the whole-record ribbon once the plan's ruin envelope is known so
   * uncovered modules do not keep a nominal-height crown after compile.
   */
  rebuildRecordShell(entry, plan) {
    if (!entry.shellPath) return;
    const envelope = plan?.ruinEnvelope;
    const heightAt = envelope
      ? (s) => sampleRuinEnvelopeHeight(envelope, s)
      : null;
    const geometry = buildShellGeometry(entry.shellPath.points, {
      record: entry.record,
      terrainView: this.terrainView,
      origin: entry.origin,
      heightAt,
    });
    if (!geometry) return;
    const material = entry.record.id === this.selectedId
      ? this.selectedMaterial
      : this.shellMaterials.forRecord(entry.record);
    if (entry.shellMesh) {
      entry.group.remove(entry.shellMesh);
      entry.shellMesh.geometry.dispose();
    }
    const shellMesh = new THREE.Mesh(geometry, material);
    shellMesh.name = `construction-shell:${entry.record.id}`;
    shellMesh.userData.constructionId = entry.record.id;
    shellMesh.userData.structuralPlan = plan;
    shellMesh.castShadow = true;
    shellMesh.receiveShadow = true;
    entry.group.add(shellMesh);
    entry.shellMesh = shellMesh;
  }

  /**
   * The far band and the not-yet-built placeholder for one module.
   *
   * Per module, not per record: `updateLod` classifies each module separately,
   * so a record-wide ribbon shown for one distant module would also be drawn
   * through every near module's masonry — courses read as holes and the ribbon
   * z-fights the stones it passes through.
   */
  buildModuleShell(entry, module, resident, plan) {
    if (!entry.shellPath) return;
    const total = plan.totalLength;
    const [from, to] = module.pathInterval ?? [0, total];
    const points = total > 0
      ? shellSectionPoints(entry.shellPath, from / total, to / total)
      : entry.shellPath.points;
    const envelope = plan.ruinEnvelope;
    const heightAt = envelope
      ? (s) => sampleRuinEnvelopeHeight(envelope, s)
      : null;
    const geometry = buildShellGeometry(points, {
      record: entry.record,
      terrainView: this.terrainView,
      origin: entry.origin,
      heightAt,
    });
    if (!geometry) return;
    if (resident.shellMesh) {
      entry.group.remove(resident.shellMesh);
      resident.shellMesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(
      geometry,
      entry.record.id === this.selectedId
        ? this.selectedMaterial
        : this.shellMaterials.forRecord(entry.record),
    );
    mesh.name = `construction-shell:${entry.record.id}:${module.id}`;
    mesh.userData.constructionId = entry.record.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Hidden until `updateLod` or the build queue asks for it, so a module that
    // already has masonry does not flash its shell for a frame.
    mesh.visible = resident.meshes.length === 0;
    entry.group.add(mesh);
    resident.shellMesh = mesh;
  }

  refreshRuinDebug(entry, plan) {
    if (entry.ruinDebugMeshes?.length) {
      for (const mesh of entry.ruinDebugMeshes) entry.group.remove(mesh);
      disposeRuinDebugMeshes(entry.ruinDebugMeshes);
      entry.ruinDebugMeshes = [];
    }
    if (!this.ruinDebugEnabled || !plan?.ruinDiagnostics) return;
    const meshes = buildRuinDebugMeshes({
      survivors: plan.ruinDiagnostics.survivors ?? [],
      removals: plan.ruinDiagnostics.removals ?? [],
      arcTable: entry.arcTable,
      origin: entry.origin,
      groundHeightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z) ?? 0,
    });
    for (const mesh of meshes) {
      mesh.userData.constructionId = entry.record.id;
      entry.group.add(mesh);
    }
    entry.ruinDebugMeshes = meshes;
  }

  disposeResidentBuild(resident) {
    if (!resident?.buildState) return;
    this.moduleBuilder.dispose(resident.buildState);
    resident.buildState = null;
  }

  enqueueModuleBuild(constructionId, module, requestedBand = null, priority = 0) {
    const entry = this.entries.get(constructionId);
    const resident = entry?.modules.get(module.id);
    const band = requestedBand
      ?? resident?.requestedBand
      ?? resident?.band
      ?? 'near';
    if (resident) {
      const buildKey = moduleBuildKey({
        constructionId,
        revision: entry.structuralRevision,
        moduleId: module.id,
        contentHash: module.contentHash,
        requestedBand: band,
      });
      const decision = evaluateBuildRequest({ resident, buildKey });
      if (!decision.enqueue) {
        this.stats.duplicateBuildsSuppressed += 1;
        resident.buildPriority = priority;
        this.buildQueue.upsert({ constructionId, module, requestedBand: band, priority });
        return;
      }
      if (resident.buildState?.key !== undefined && resident.buildState.key !== buildKey) {
        this.disposeResidentBuild(resident);
      }
      resident.pendingBuildKey = buildKey;
      resident.requestedBand = band;
      resident.requestedAt = performance.now();
      resident.buildPriority = priority;
    }
    this.buildQueue.upsert({ constructionId, module, requestedBand: band, priority });
    this.stats.queueDepth = this.buildQueue.length;
  }

  /**
   * Drain the module build queue under a frame budget. Until a module's own
   * geometry lands, the record's shell stays visible, so nothing ever pops to
   * empty. Phase 1 has no per-module geometry to emit yet; the queue and its
   * budget exist so masonry can slot in without re-plumbing the frame loop.
   */
  /**
   * Choose an LOD band per module and show the matching geometry.
   *
   * `shell` shows the module's own slice of the extruded ribbon, so the far
   * band costs nothing to build and never overlaps a neighbouring module that
   * is drawing masonry. `near` and `coarse` both draw the module's masonry; the
   * coarse tier is generated on demand. Previously visited masonry tiers are
   * held in a bounded cache; uncached destinations keep the old geometry visible.
   */
  updateLod(camera, viewportHeight) {
    updateConstructionLod(this, camera, viewportHeight);
  }

  update({ budgetMs = MODULE_BUILD_BUDGET_MS, shouldYield = null } = {}) {
    this.updatePreviewHold();
    if (this.buildQueue.length === 0 || !(budgetMs > 0) || shouldYield?.()) {
      this.stats.queueDepth = this.buildQueue.length;
      this.enforceDraftOcclusion();
      return;
    }
    const started = performance.now();
    let built = 0;
    while (
      this.buildQueue.length > 0
      && built < MODULE_BUILD_COUNT
      && performance.now() - started < budgetMs
      && !shouldYield?.()
    ) {
      const job = this.buildQueue.shift();
      const entry = this.entries.get(job.constructionId);
      if (!entry || !entry.modules.has(job.module.id)) continue;
      const moduleStarted = performance.now();
      const completed = this.buildModule(entry, job.module);
      const elapsed = performance.now() - moduleStarted;
      this.stats.buildMs += elapsed;
      this.stats.maxBuildStepMs = Math.max(this.stats.maxBuildStepMs ?? 0, elapsed);
      if (completed) this.stats.modulesRebuilt += 1;
      built += 1;
    }
    this.stats.queueDepth = this.buildQueue.length;
    this.enforceDraftOcclusion();
  }

  buildModule(entry, module) {
    const resident = entry.modules.get(module.id);
    if (!resident || resident.hash !== module.contentHash) return false;

    if (resident.requestedBand === 'shell') {
      this.disposeResidentBuild(resident);
      resident.pendingBuildKey = null;
      return false;
    }

    const lodBand = (resident.requestedBand ?? resident.band) === 'coarse'
      ? 'coarse'
      : 'near';
    const expectedKey = moduleBuildKey({
      constructionId: entry.record.id,
      revision: entry.structuralRevision,
      moduleId: module.id,
      contentHash: module.contentHash,
      requestedBand: lodBand,
    });
    if (resident.pendingBuildKey && resident.pendingBuildKey !== expectedKey) {
      this.stats.staleBuildsDiscarded += 1;
      this.disposeResidentBuild(resident);
      resident.pendingBuildKey = null;
      if (resident.hash === module.contentHash) {
        this.enqueueModuleBuild(entry.record.id, module, lodBand, resident.buildPriority ?? 0);
      }
      return false;
    }

    const terrainRevision = this.terrainView.worldStore?.revision ?? 0;
    // Record revision covers appearance/decorative inputs beyond the structural
    // plan. Origin-local geometry survives floating-origin rebases unchanged.
    const geometryKey = `${expectedKey}|${entry.record.revision}|${terrainRevision}`;
    let state = resident.buildState;
    if (
      !state
      || state.key !== expectedKey
      || state.terrainRevision !== terrainRevision
      || state.record.revision !== entry.record.revision
    ) {
      this.disposeResidentBuild(resident);
      const cachedMasonry = resident.growthOnlyPending ? null : this.lodCache.take(geometryKey);
      const placements = cachedMasonry?.placements ?? (lodBand === 'coarse'
        ? coarsePlacementsForModule({
          record: entry.record,
          module,
          totalLength: entry.plan?.totalLength,
        })
        : module.placements ?? []);
      const source = resident.growthSource;
      const retainedGrowth = source?.recordRevision === entry.record.revision
        && source.contentHash === module.contentHash
        && source.placements === placements
        && source.terrainRevision === terrainRevision
        ? resident.meshes.find(mesh => (
          mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.GROWTH
        ))
        : null;
      state = this.moduleBuilder.createState({
        key: expectedKey,
        record: entry.record,
        materials: entry.materials,
        arcTable: entry.arcTable,
        moduleOrigin: entry.origin,
        pathInterval: module.pathInterval,
        lodBand,
        placements,
        terrainRevision,
        retainedGrowth,
        bounds: module.bounds,
        growthOnly: resident.growthOnlyPending && resident.builtBand === lodBand,
        cachedMasonry,
      });
      resident.buildState = state;
    }

    const result = this.moduleBuilder.advance(state);
    if (!result.done) {
      this.buildQueue.upsert({
        constructionId: entry.record.id,
        module,
        requestedBand: lodBand,
        priority: resident.buildPriority ?? 0,
      });
      return false;
    }

    resident.buildState = null;
    const built = result.built;
    if (!built) { this.moduleBuilder.dispose(state); return false; }
    if (state.growthOnly && !state.cacheHit) {
      const previous = resident.stats ?? {};
      const growthTriangles = built.stats.growthTriangles ?? 0;
      const totalTriangles = (previous.totalTriangles ?? 0) - (previous.growthTriangles ?? 0) + growthTriangles;
      built.stats = { ...previous, growthLeaves: built.stats.growthLeaves ?? 0,
        groundDetails: built.stats.groundDetails ?? 0, growthTriangles, totalTriangles, triangles: totalTriangles };
      built.meshes.unshift(...resident.meshes.filter(mesh =>
        mesh.userData.constructionMaterialSlot !== CONSTRUCTION_MATERIAL_SLOT.GROWTH));
    }
    resident.growthOnlyPending = false;

    const outgoing = resident.meshes.filter(mesh => !built.meshes.includes(mesh)
      && mesh.userData.constructionMaterialSlot !== CONSTRUCTION_MATERIAL_SLOT.GROWTH);
    const cacheOutgoing = outgoing.length > 0 && resident.builtBand !== lodBand && resident.builtGeometryKey
      && resident.growthSource?.recordRevision === entry.record.revision
      && resident.growthSource.contentHash === module.contentHash
      && resident.growthSource.terrainRevision === terrainRevision;
    if (cacheOutgoing) this.lodCache.put(resident.builtGeometryKey, entry.record.id, module.id,
      { meshes: outgoing, stats: masonryStats(resident.stats), placements: resident.growthSource?.placements });
    resident.builtBand = lodBand;
    resident.builtGeometryKey = geometryKey;
    resident.visibleBand = lodBand;
    resident.band = lodBand;
    resident.visibleSince = performance.now();
    resident.pendingBuildKey = null;
    resident.buildPriority = 0;
    resident.transitionTarget = null;
    this.stats.lodTransitionsCompleted += 1;
    if (state.cacheHit) this.stats.lodCacheHits += 1;
    else if (lodBand === 'near') this.stats.nearBuilds += 1;
    else this.stats.coarseBuilds += 1;

    for (const stale of resident.meshes) {
      if (built.meshes.includes(stale)) continue;
      entry.group.remove(stale);
      if (!cacheOutgoing || !outgoing.includes(stale)) stale.geometry.dispose();
    }
    for (const mesh of built.meshes) {
      mesh.visible = true;
      const slot = mesh.userData.constructionMaterialSlot
        ?? CONSTRUCTION_MATERIAL_SLOT.STONE;
      mesh.name = [
        'construction-masonry',
        entry.record.id,
        module.id,
        slot,
      ].join(':');
      mesh.userData.constructionId = entry.record.id;
      if (mesh.parent !== entry.group) entry.group.add(mesh);
    }
    resident.meshes = built.meshes;
    updateModuleStats(this.stats, resident.stats, built.stats);
    resident.stats = built.stats;
    resident.growthSource = {
      recordRevision: entry.record.revision,
      contentHash: module.contentHash,
      placements: state.placements,
      terrainRevision,
    };
    if (this.previewedMaterialId === entry.record.id) this.applySelectionMaterial(entry.record.id, entry);
    else this.applyResidentMaterials(entry, entry.record.id === this.selectedId, [resident]);
    this.updateShellVisibility(entry, resident);
    return true;
  }

  /** Reconcile totals after an explicit record-wide decoration edit. */
  refreshModuleStats() {
    for (const key of MODULE_STAT_KEYS) this.stats[key] = 0;
    for (const entry of this.entries.values()) {
      for (const other of entry.modules.values()) {
        updateModuleStats(this.stats, null, other.stats);
      }
    }
  }

  /** True once every resident module can show a ribbon for its own arc. */
  modulesOwnTheirShells(entry) {
    if (entry.modules.size === 0) return false;
    for (const resident of entry.modules.values()) {
      if (!resident.shellMesh) return false;
    }
    return true;
  }

  /**
   * The shell is the fallback, not a second layer: a module without masonry yet
   * shows a plain ribbon rather than a hole. Modules the budget refused keep
   * theirs visible forever, which is the intended degradation.
   *
   * Per module wherever module shells exist — a record-wide ribbon shown for a
   * single pending module is drawn straight through its finished neighbours.
   */
  updateShellVisibility(entry, changedResident = null) {
    // Residency reconciliation establishes coverage; publication changes only this module.
    if (changedResident && entry.modulesHaveShells) {
      changedResident.shellMesh.visible = changedResident.meshes.length === 0 || changedResident.band === 'shell';
      if (entry.shellMesh) entry.shellMesh.visible = false;
      return;
    }
    let pending = 0;
    let modulesHaveShells = entry.modules.size > 0;
    for (const resident of entry.modules.values()) {
      // Same rule `updateLod` applies, so a build landing mid-frame cannot
      // un-hide the masonry of a module the camera already sent to the far band.
      const bare = resident.meshes.length === 0 || resident.band === 'shell';
      if (bare) pending += 1;
      if (resident.shellMesh) resident.shellMesh.visible = bare;
      else modulesHaveShells = false;
    }
    entry.modulesHaveShells = modulesHaveShells;
    if (!entry.shellMesh) return;
    if (entry.moduleResidency && entry.activePlanModules?.length === 0) {
      entry.shellMesh.visible = false;
      return;
    }
    const covered = entry.modules.size > 0
      && (pending === 0 || modulesHaveShells);
    entry.shellMesh.visible = !covered;
  }

  setSelection(constructionId, anchorId = null) {
    const previousSelectedId = this.selectedId;
    this.selectedId = constructionId && this.store.get(constructionId)
      ? String(constructionId)
      : null;
    if (this.selectedId !== previousSelectedId) this.lodDirty = true;
    this.selectedAnchorId = this.selectedId && anchorId ? String(anchorId) : null;
    if (this.selectedId && !this.entries.has(this.selectedId)) {
      this.upsertRecord(this.store.get(this.selectedId));
    }
    for (const [id, entry] of this.entries) this.applySelectionMaterial(id, entry);
    this.rebuildHandles();
  }

  handleAnchorPosition(record, anchor) {
    const render = this.floatingOrigin.toRender(anchor.position[0], anchor.position[1]);
    const height = this.terrainView.getCanonicalHeight(anchor.position[0], anchor.position[1]) ?? 0;
    return { x: render.x, y: height + record.dimensions.height + 0.28, z: render.z };
  }

  rebuildHandles() {
    for (const mesh of this.handleMeshes) {
      this.root.remove(mesh);
      if (mesh.geometry && mesh.geometry !== this.handleGeometry
        && mesh.geometry !== this.tangentHandleGeometry) {
        mesh.geometry.dispose();
      }
    }
    for (const line of this.handleLines) {
      this.root.remove(line);
      line.geometry.dispose();
    }
    this.handleMeshes = [];
    this.handleLines = [];
    const record = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!record || record.path.type !== 'cubicBezier') return;
    const anchors = new Map(record.path.anchors.map((anchor) => [anchor.id, anchor]));
    for (const anchor of record.path.anchors) {
      const mesh = new THREE.Mesh(this.handleGeometry, this.handleMaterial);
      const at = this.handleAnchorPosition(record, anchor);
      mesh.position.set(at.x, at.y, at.z);
      mesh.renderOrder = 100;
      mesh.userData.constructionId = record.id;
      mesh.userData.anchorId = anchor.id;
      mesh.userData.handleKind = 'anchor';
      this.root.add(mesh);
      this.handleMeshes.push(mesh);
    }
    // Tangent gizmos only for the selected anchor — emitting them for every
    // node turns a long wall into a forest of always-on-top spheres.
    const selectedAnchor = this.selectedAnchorId
      ? anchors.get(this.selectedAnchorId)
      : null;
    if (!selectedAnchor) return;
    const anchorAt = this.handleAnchorPosition(record, selectedAnchor);
    for (const segment of record.path.segments) {
      const ends = [];
      if (segment.startAnchorId === selectedAnchor.id) {
        ends.push({ which: 'start', offset: segment.startHandle });
      }
      if (segment.endAnchorId === selectedAnchor.id) {
        ends.push({ which: 'end', offset: segment.endHandle });
      }
      for (const { which, offset } of ends) {
        const worldX = selectedAnchor.position[0] + offset[0];
        const worldZ = selectedAnchor.position[1] + offset[1];
        const render = this.floatingOrigin.toRender(worldX, worldZ);
        const height = this.terrainView.getCanonicalHeight(worldX, worldZ) ?? 0;
        const handleY = height + record.dimensions.height + 0.28;
        const mesh = new THREE.Mesh(this.tangentHandleGeometry, this.tangentHandleMaterial);
        mesh.position.set(render.x, handleY, render.z);
        mesh.renderOrder = 101;
        mesh.userData.constructionId = record.id;
        mesh.userData.anchorId = selectedAnchor.id;
        mesh.userData.handleKind = 'tangent';
        mesh.userData.segmentId = segment.id;
        mesh.userData.which = which;
        this.root.add(mesh);
        this.handleMeshes.push(mesh);

        const lineGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(anchorAt.x, anchorAt.y, anchorAt.z),
          new THREE.Vector3(render.x, handleY, render.z),
        ]);
        const line = new THREE.Line(lineGeometry, this.tangentLineMaterial);
        line.renderOrder = 99;
        line.frustumCulled = false;
        this.root.add(line);
        this.handleLines.push(line);
      }
    }
  }

  repositionHandles() {
    const record = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!record || record.path.type !== 'cubicBezier') return;
    // Tangents and connector lines depend on handle offsets; cheapest correct
    // path after an origin rebase is a full rebuild.
    this.rebuildHandles();
  }

  /** Tint the dragged anchor's handle to show which snap is about to apply. */
  setSnapFeedback(anchorId, snapKind) {
    for (const mesh of this.handleMeshes) {
      if (mesh.userData.handleKind === 'tangent') continue;
      const active = anchorId && mesh.userData.anchorId === anchorId && snapKind;
      mesh.material = active
        ? this.snapMaterials.get(snapKind) ?? this.handleMaterial
        : this.handleMaterial;
      mesh.scale.setScalar(active ? 1.35 : 1);
    }
  }

  /**
   * Preview the arc a draft replaces (phase 11 §8, the W3 gate).
   *
   * A draft never hides the record: one reusable ribbon covers the arc its
   * gesture dirties, only the committed products inside that arc step aside,
   * and the rest of the wall keeps drawing. The ribbon's buffers are allocated
   * once and rewritten in place, so dragging allocates no preview product, and
   * the gesture's identity — entity id and seed — is minted once and carried
   * through commit so the masonry cannot reroll.
   */
  setDraft(record, {
    valid = true,
    constructionId = null,
    snapKind = null,
    anchorId = null,
  } = {}) {
    this.setSnapFeedback(anchorId, snapKind);
    const entry = constructionId ? this.entries.get(constructionId) ?? null : null;
    const constructionKey = entry?.record.id ?? null;
    // A gesture belongs to one record: moving to another one — or to a draw, or
    // past a preview that is waiting to hand over — starts a fresh preview.
    if (this.previewedConstructionId !== constructionKey || this.previewHold) {
      this.finishPreviewDraft();
    }

    const previous = this.previewDraft;
    const spanKey = this.draftSpanKey(constructionKey, record, anchorId, entry);
    const span = previous?.spanKey === spanKey
      ? previous.span
      : this.draftSpan(entry, record, anchorId);
    if (span !== previous?.span) this.stats.previewSpanChanges += 1;
    this.previewDraft = {
      identity: previous?.identity ?? {
        entityId: constructionKey ?? record.id,
        seed: record.seed ?? entry?.record.seed ?? null,
      },
      spanKey,
      span,
      fromRevision: previous?.fromRevision ?? entry?.structuralRevision ?? null,
    };
    this.previewedConstructionId = constructionKey;
    this.previewOrigin = originForRecord(record);
    const render = this.floatingOrigin.toRender(this.previewOrigin.x, this.previewOrigin.z);
    this.ensurePreviewMesh();
    this.previewMesh.position.set(render.x, 0, render.z);
    this.previewMesh.material = valid ? this.draftMaterial(record) : this.invalidPreviewMaterial;
    const source = this.buildPreviewSource(record, span);
    const drawn = source ? this.writePreviewGeometry(source) : false;
    // The shared shell builder hands back a scratch geometry; copying it into
    // the reused buffers is what keeps the preview product itself stable.
    source?.dispose();
    if (!drawn) {
      // Nothing to draw for this arc: leave the committed wall on screen rather
      // than hide it behind an empty preview.
      this.previewMesh.visible = false;
      this.endDraftOcclusion();
      return;
    }
    if (entry) this.occludeDraftSpan(entry, span);
  }

  /**
   * End the gesture.
   *
   * A reshape parks the preview instead of deleting it: the commit runs in this
   * same tick, and `update` hands over to the committed product only once the
   * replaced arc is rebuilt — no blank frame, no double wall. A gesture that
   * commits nothing releases on the next frame, which is an exact restore
   * because nothing else moved. A new-wall draft has no committed product to
   * wait for and retires at once.
   */
  clearDraft() {
    this.setSnapFeedback(null, null);
    const constructionId = this.previewedConstructionId;
    const draft = this.previewDraft;
    this.previewedConstructionId = null;
    const entry = constructionId ? this.entries.get(constructionId) : null;
    if (!entry || !draft || (draft.span.whole && !hasResidentMasonry(entry))) {
      this.finishPreviewDraft();
      return;
    }
    this.previewDraft = null;
    this.previewHold = {
      constructionId,
      fromRevision: draft.fromRevision,
      startedAt: performance.now(),
    };
    this.stats.previewHolds += 1;
  }

  /** Retire the draft now: release the replaced arc and hide the preview. */
  finishPreviewDraft() {
    this.endDraftOcclusion();
    if (this.previewMesh) this.previewMesh.visible = false;
    this.previewDraft = null;
    this.previewHold = null;
    this.previewedConstructionId = null;
  }

  /**
   * Resolve a parked preview. The commit runs in the same tick as `clearDraft`,
   * so a record whose structural revision never moved was cancelled — restore
   * at once rather than leave a ghost. When it did move, the preview stays
   * until the plan and the builds for the replaced arc have landed, so the swap
   * covers the same arc in the same tick. A record that vanished under the
   * draft (undo, delete) or a worker that never answers is dropped instead of
   * resurrecting an older shape.
   */
  updatePreviewHold() {
    const hold = this.previewHold;
    if (!hold) return;
    const entry = this.entries.get(hold.constructionId);
    if (!entry || entry.structuralRevision === hold.fromRevision) {
      if (!entry) this.stats.previewStaleDrops += 1;
      this.finishPreviewDraft();
      return;
    }
    if (performance.now() - hold.startedAt > PREVIEW_HOLD_MS) {
      this.stats.previewStaleDrops += 1;
      this.finishPreviewDraft();
      return;
    }
    if (!entry.planRevision || entry.planRevision <= hold.fromRevision) return;
    if (this.buildQueue.some((job) => job.constructionId === hold.constructionId)) return;
    this.finishPreviewDraft();
  }

  /**
   * What a valid draft looks like: the wall's own shell — its style colour and
   * stone pattern, or the selection tint when the wall is selected — so a new
   * wall grows under the pointer as stone and a reshaped arc matches the wall
   * around it (phase 11 §4, §8: "a matching opaque shaded shell").
   */
  draftMaterial(record) {
    return record.id === this.selectedId ? this.selectedMaterial : this.shellMaterials.forRecord(record);
  }

  /** The single reusable preview mesh; its buffers outlive every gesture. */
  ensurePreviewMesh() {
    if (this.previewMesh) return;
    this.previewGeometry = new THREE.BufferGeometry();
    this.previewGeometry.name = 'construction-preview-buffers';
    this.previewMesh = new THREE.Mesh(this.previewGeometry, this.invalidPreviewMaterial);
    this.previewMesh.name = 'construction-preview';
    this.previewMesh.renderOrder = 20;
    this.previewMesh.visible = false;
    this.root.add(this.previewMesh);
  }

  /**
   * Gesture-stable key for the arc a draft replaces. The arc and its occlusion
   * are recomputed only when this changes; an anchor that keeps moving inside
   * the same segments only rewrites vertex data.
   */
  draftSpanKey(constructionId, record, anchorId, entry = null) {
    const dirty = draftDirtySegments(record, anchorId);
    return [
      constructionId ?? record.id,
      dirty.size > 0 && this.isLocalDraft(entry, record) ? 'local' : 'record',
      [...dirty].join(','),
    ].join('|');
  }

  /**
   * True when a draft changes only the shape of the segments the dragged anchor
   * joins. Thickness, height, style, openings and a whole-wall move each change
   * every module's inputs, so they replace the record's whole arc instead.
   */
  isLocalDraft(entry, record) {
    const committed = entry?.record;
    if (!committed || !hasResidentMasonry(entry)) return false;
    return committed.dimensions.height === record.dimensions.height
      && committed.dimensions.thickness === record.dimensions.thickness
      && committed.style?.key === record.style?.key
      && committed.seed === record.seed
      && committed.top?.style === record.top?.style
      && (committed.features?.length ?? 0) === (record.features?.length ?? 0)
      && committed.path?.closed === record.path?.closed
      && (committed.path?.anchors?.length ?? 0) === (record.path?.anchors?.length ?? 0)
      && (committed.path?.segments?.length ?? 0) === (record.path?.segments?.length ?? 0);
  }

  /**
   * The arc a draft replaces, as fractions of the record's path.
   *
   * Segment-local, because a cubic only moves where its own handles moved: an
   * anchor drag dirties the segments touching that anchor, and the masonry
   * beyond them keeps its geometry and stays on screen (phases 11 §8, §9.5).
   * The range is widened to whole modules so the preview covers exactly what it
   * hides. A draft with nothing local to replace — a new wall, a whole-wall
   * move or thickness change, a wall that is still only its ribbon — previews
   * the whole record.
   */
  draftSpan(entry, record, anchorId) {
    const dirty = draftDirtySegments(record, anchorId);
    if (dirty.size === 0 || !this.isLocalDraft(entry, record)) return WHOLE_SPAN;
    // The committed sampling, not the draft's: the plan's module intervals live
    // in that arc domain, and the two only have to agree closely enough to pick
    // the same modules.
    const sampled = entry.shellPath;
    const total = sampled?.totalDistance ?? 0;
    if (!(total > 0)) return WHOLE_SPAN;
    let from = Infinity;
    let to = -Infinity;
    for (const point of sampled.points) {
      if (!dirty.has(point.segmentId)) continue;
      from = Math.min(from, point.distance);
      to = Math.max(to, point.distance);
    }
    if (!(to > from)) return WHOLE_SPAN;

    // Widen to the modules the range cuts through: hiding half a module without
    // previewing its other half would leave a hole in the wall.
    const planTotal = entry.plan?.totalLength ?? 0;
    const tolerance = planTotal > 0 ? PREVIEW_SPAN_TOLERANCE / planTotal : 0;
    let spanFrom = from / total;
    let spanTo = to / total;
    if (planTotal > 0) {
      for (let pass = 0; pass < 3; pass += 1) {
        for (const module of entry.plan.modules) {
          const [start, end] = module.pathInterval ?? [0, planTotal];
          const moduleFrom = start / planTotal;
          const moduleTo = end / planTotal;
          if (moduleTo <= spanFrom + tolerance || moduleFrom >= spanTo - tolerance) continue;
          spanFrom = Math.min(spanFrom, moduleFrom);
          spanTo = Math.max(spanTo, moduleTo);
        }
      }
    }
    const whole = spanFrom <= 0 && spanTo >= 1;
    return {
      from: Math.max(0, spanFrom - tolerance),
      to: Math.min(1, spanTo + tolerance),
      whole,
    };
  }

  /**
   * One ribbon over the draft's replaced arc, built from the draft record the
   * way a module shell is, so the preview and the committed product agree about
   * silhouette, thickness and opening contours (phase 11 §8).
   */
  buildPreviewSource(record, span) {
    const sampled = sampleShellPath(record);
    const points = span.whole
      ? sampled.points
      : shellSectionPoints(sampled, span.from, span.to);
    return buildShellGeometry(points, {
      record,
      terrainView: this.terrainView,
      origin: this.previewOrigin,
    });
  }

  /** Copy a scratch ribbon into the reused preview buffers, counted for QA. */
  writePreviewGeometry(source) {
    const geometry = this.previewGeometry;
    const index = source.getIndex();
    if (!(source.getAttribute('position')?.count > 2 && index?.count > 2)) return false;
    this.writePreviewAttribute('position', source.getAttribute('position'), 3);
    this.writePreviewAttribute('normal', source.getAttribute('normal'), 3);
    this.writePreviewAttribute('uv', source.getAttribute('uv'), 2);
    this.writePreviewIndex(index);
    const { identity } = this.previewDraft;
    geometry.userData.constructionId = identity.entityId;
    geometry.userData.constructionSeed = identity.seed;
    // The spare capacity is stale; let the cull rebuild both volumes from the
    // live count instead of carrying geometry that is no longer drawn.
    geometry.boundingBox = null;
    geometry.boundingSphere = null;
    this.previewMesh.visible = true;
    this.stats.previewBufferWrites += 1;
    return true;
  }

  /**
   * Write one attribute in place. Buffers double from `PREVIEW_BUFFER_MIN` and
   * keep their identity while `count` tracks the live range, so a drag over a
   * stable arc allocates no buffer, re-creates no GPU buffer and rebinds
   * nothing — it only re-uploads the vertices that moved.
   */
  writePreviewAttribute(name, source, itemSize) {
    const geometry = this.previewGeometry;
    const needed = source.count * itemSize;
    let attribute = geometry.getAttribute(name);
    if (!attribute || attribute.array.length < needed) {
      attribute = new THREE.BufferAttribute(
        new Float32Array(growPreviewCapacity(needed)),
        itemSize,
      );
      geometry.setAttribute(name, attribute);
      this.stats.previewBufferAllocations += 1;
    }
    attribute.array.set(source.array, 0);
    attribute.count = source.count;
    attribute.needsUpdate = true;
  }

  /** The index buffer follows the same rule, in whole-number elements. */
  writePreviewIndex(source) {
    const geometry = this.previewGeometry;
    let attribute = geometry.getIndex();
    if (!attribute || attribute.array.length < source.count) {
      attribute = new THREE.BufferAttribute(
        new Uint32Array(growPreviewCapacity(source.count)),
        1,
      );
      geometry.setIndex(attribute);
      this.stats.previewBufferAllocations += 1;
    }
    attribute.array.set(source.array, 0);
    attribute.count = source.count;
    attribute.needsUpdate = true;
  }

  /**
   * Step the committed products inside the replaced arc aside, recording the
   * flags cancel has to restore. Recomputed only when the arc changes, so a
   * moving anchor does not re-walk the wall.
   */
  occludeDraftSpan(entry, span) {
    const occlusion = this.previewOcclusion;
    if (occlusion?.constructionId === entry.record.id
      && occlusion.spanKey === this.previewDraft.spanKey) {
      this.enforceDraftOcclusion();
      return;
    }
    this.endDraftOcclusion();
    const products = this.draftSpanProducts(entry, span)
      .map((object) => ({ object, visible: object.visible }));
    this.previewOcclusion = {
      constructionId: entry.record.id,
      spanKey: this.previewDraft.spanKey,
      span,
      products,
    };
    this.stats.previewOccludedProducts = products.filter(({ visible }) => visible).length;
    this.enforceDraftOcclusion();
  }

  /**
   * Hide the replaced arc again after a pass that recomputed visibility. The
   * LOD and shell rules keep running every frame; this only overrides their
   * answer for the arc the preview owns, so a build landing mid-drag cannot
   * flash stale stones back over the preview.
   */
  enforceDraftOcclusion() {
    const occlusion = this.previewOcclusion;
    if (!occlusion) return;
    const entry = this.entries.get(occlusion.constructionId);
    if (!entry) {
      this.previewOcclusion = null;
      return;
    }
    for (const { object } of occlusion.products) object.visible = false;
    for (const object of this.draftSpanProducts(entry, occlusion.span)) {
      object.visible = false;
    }
  }

  /** Restore the flags the draft hid. A cancel is exact: nothing else moved. */
  endDraftOcclusion() {
    const occlusion = this.previewOcclusion;
    this.previewOcclusion = null;
    this.stats.previewOccludedProducts = 0;
    if (!occlusion) return;
    const hidden = new Set(occlusion.products.map(({ object }) => object));
    for (const { object, visible } of occlusion.products) object.visible = visible;
    const entry = this.entries.get(occlusion.constructionId);
    if (!entry) return;
    // A committed reshape replaced some of those products while the draft was
    // up: hand the replacements to the shell rules rather than the old flags.
    for (const object of this.draftSpanProducts(entry, occlusion.span)) {
      if (!hidden.has(object)) object.visible = true;
    }
    this.updateShellVisibility(entry);
  }

  /** Every committed product drawing inside the replaced arc. */
  draftSpanProducts(entry, span) {
    const products = [];
    // The record-wide ribbon is the pre-masonry placeholder: the preview
    // supersedes it wherever it shows, and it has no per-arc split to keep.
    if (entry.shellMesh) products.push(entry.shellMesh);
    const total = entry.plan?.totalLength ?? 0;
    // The same tolerance `draftSpan` widened with, so the modules the preview
    // covers and the modules it hides are always the same set.
    const tolerance = total > 0 ? PREVIEW_SPAN_TOLERANCE / total : 0;
    for (const [moduleId, resident] of entry.modules) {
      const module = entry.plan?.modules.find((candidate) => candidate.id === moduleId);
      const start = module?.pathInterval?.[0] ?? 0;
      const end = module?.pathInterval?.[1] ?? total;
      if (total > 0) {
        const moduleFrom = start / total;
        const moduleTo = end / total;
        if (moduleTo <= span.from + tolerance || moduleFrom >= span.to - tolerance) continue;
      }
      if (resident.shellMesh) products.push(resident.shellMesh);
      products.push(...resident.meshes);
    }
    return products;
  }

  setPointer(clientX, clientY) {
    const bounds = this.terrainView.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      (clientX - bounds.left) / bounds.width * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
  }

  /**
   * The shell doubles as the pick volume while it is visible. Once masonry
   * covers a record the shell is hidden, so picking has to fall through to the
   * module meshes or a finished wall becomes unselectable.
   */
  pickTargets() {
    const targets = [];
    for (const entry of this.entries.values()) {
      if (!entry.group.visible) continue;
      if (entry.shellMesh?.visible) targets.push(entry.shellMesh);
      for (const resident of entry.modules.values()) {
        // A module in the far band is pickable through its own ribbon; the
        // masonry it replaced is hidden and would otherwise not be hit.
        if (resident.shellMesh?.visible) targets.push(resident.shellMesh);
        else targets.push(...resident.meshes);
      }
    }
    return targets;
  }

  pickConstruction(clientX, clientY, camera) {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, camera);
    const found = this.raycaster.intersectObjects(this.pickTargets(), false)
      .find(({ object }) => object.visible);
    return found?.object.userData.constructionId ?? null;
  }

  /** Canonical world point where the pointer meets a construction, or null. */
  pickConstructionPoint(clientX, clientY, camera) {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, camera);
    const found = this.raycaster.intersectObjects(this.pickTargets(), false)
      .find(({ object }) => object.visible);
    if (!found) return null;
    const canonical = this.floatingOrigin.toCanonical(found.point.x, found.point.z);
    return {
      constructionId: found.object.userData.constructionId,
      x: canonical.x,
      z: canonical.z,
      y: found.point.y,
    };
  }

  /** The arc table the masonry was placed against, for hover and edit maths. */
  arcTableFor(constructionId) {
    return this.entries.get(constructionId)?.arcTable ?? null;
  }

  createMaterials(record) {
    return createConstructionMaterials(record, this.materialStore?.document ?? null);
  }

  /**
   * Swap a record's stone material without touching geometry, so hovering a
   * palette petal previews instantly. Passing `null` restores the committed
   * material.
   */
  setMaterialPreview(constructionId, presetId) {
    // Restore any wall that still carries a hover preview before applying the
    // next one (or clearing). Closing the palette passes null ids; without this
    // the last preview material stays on the meshes.
    const previousId = this.previewedMaterialId;
    if (previousId && previousId !== constructionId) {
      this.restoreMaterialAssignment(previousId);
    }
    if (!constructionId || !presetId) {
      if (constructionId) this.restoreMaterialAssignment(constructionId);
      this.previewedMaterialId = null;
      return;
    }
    const entry = this.entries.get(constructionId);
    if (!entry) {
      this.previewedMaterialId = null;
      return;
    }
    this.previewedMaterialId = constructionId;
    const materials = this.createMaterials({
      ...entry.record,
      style: {
        ...entry.record.style,
        materials: { ...entry.record.style.materials, stone: presetId },
      },
    });
    for (const resident of entry.modules.values()) {
      for (const mesh of resident.meshes) {
        // Palette hover only previews the stone slot; mortar stays put.
        if (mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.MORTAR) {
          mesh.material = materials.mortar;
          continue;
        }
        mesh.material = materials.stone;
      }
    }
  }

  restoreMaterialAssignment(constructionId) {
    const entry = this.entries.get(constructionId);
    if (!entry?.materials) return;
    this.applySelectionMaterial(constructionId, entry);
  }

  pickHandle(clientX, clientY, camera) {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, camera);
    const found = this.raycaster.intersectObjects(this.handleMeshes, false)[0];
    return found
      ? {
        constructionId: found.object.userData.constructionId,
        anchorId: found.object.userData.anchorId,
        handleKind: found.object.userData.handleKind ?? 'anchor',
        segmentId: found.object.userData.segmentId ?? null,
        which: found.object.userData.which ?? null,
      }
      : null;
  }

  dispose() {
    this.unsubscribe?.();
    this.moduleBuilder.shutdown();
    this.finishPreviewDraft();
    for (const id of [...this.entries.keys()]) this.removeRecord(id);
    this.lodCache.clear();
    this.scene.remove(this.root);
    if (this.previewMesh) this.root.remove(this.previewMesh);
    this.previewGeometry?.dispose();
    this.previewMesh = null;
    this.previewGeometry = null;
    this.shellMaterials.dispose();
    this.wallMaterial.dispose();
    this.shellDetail?.dispose();
    this.selectedMaterial.dispose();
    this.invalidPreviewMaterial.dispose();
    this.handleGeometry.dispose();
    this.tangentHandleGeometry.dispose();
    this.handleMaterial.dispose();
    this.tangentHandleMaterial.dispose();
    this.tangentLineMaterial.dispose();
    for (const material of this.snapMaterials.values()) material.dispose();
    this.snapMaterials.clear();
  }
}
