import * as THREE from 'three/webgpu';
import { cubicBezierPathBounds, sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { buildModuleMasonry } from '../compile/ConstructionMasonryBuilder.js';
import { CONSTRUCTION_MATERIAL_SLOT } from './ConstructionMaterialSlots.js';
import { createConstructionMaterials } from './ConstructionMaterials.js';
import { coarsePlacements, moduleProjectedPixels } from './ConstructionLod.js';
import {
  evaluateBuildRequest,
  moduleBuildKey,
  resolveRequestedLodBand,
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

const HANDLE_RADIUS = 0.16;

/**
 * Record origins snap to this grid so an ordinary edit does not move the origin
 * and invalidate every module's geometry. 64 m is well inside float32's precise
 * range and coarse enough that dragging an anchor never crosses a cell.
 */
const ORIGIN_QUANTUM = 64;

/**
 * Per-frame ceiling on module rebuilds, so a large commit cannot hitch.
 *
 * One module per frame, matching the one-install-per-frame rule the stylized
 * variant residency already follows. The time budget is checked *before* a
 * build starts and a module cannot be interrupted once begun, so the real
 * worst-case frame is one module's build time — measured at ~9 ms for a dense
 * 12 m module. Allowing two put a 200 m commit over 18 ms per frame.
 */
const MODULE_BUILD_BUDGET_MS = 4;
const MODULE_BUILD_COUNT = 1;

function quantizeOrigin(value) {
  return Math.round(value / ORIGIN_QUANTUM) * ORIGIN_QUANTUM;
}

/**
 * Resolve the material for one resident mesh from its explicit slot.
 * Selection tints stone only — mortar stays dark so joints keep contrast.
 */
export function residentMaterial(mesh, materials, selected) {
  const slot = mesh.userData.constructionMaterialSlot;
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

export class ConstructionView {
  constructor({ terrainView, store, compilerClient = null, materialStore = null }) {
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
    /** id -> { group, origin, shellMesh, modules: Map<moduleId, {hash}>, plan } */
    this.entries = new Map();
    this.buildQueue = [];
    this.handleMeshes = [];
    this.selectedId = null;
    this.previewMesh = null;
    this.previewOrigin = { x: 0, z: 0 };
    this.previewedConstructionId = null;
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
      lodTransitionsCompleted: 0,
      duplicateBuildsSuppressed: 0,
      staleBuildsDiscarded: 0,
      nearBuilds: 0,
      coarseBuilds: 0,
      buildMs: 0,
      stoneBuildMs: 0,
      mortarBuildMs: 0,
    };
    this.wallMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#8d8879',
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.selectedMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#d1ad58',
      roughness: 0.84,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.previewMaterial = new THREE.MeshStandardNodeMaterial({
      color: '#73c99b',
      roughness: 0.88,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.invalidPreviewMaterial = this.previewMaterial.clone();
    this.invalidPreviewMaterial.color.set('#d26666');
    this.handleGeometry = new THREE.SphereGeometry(HANDLE_RADIUS, 12, 8);
    this.handleMaterial = new THREE.MeshBasicMaterial({
      color: '#ffe091',
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
    const entry = this.entries.get(constructionId);
    if (!entry) return;
    if (entry.ruinDebugMeshes?.length) {
      for (const mesh of entry.ruinDebugMeshes) entry.group.remove(mesh);
      disposeRuinDebugMeshes(entry.ruinDebugMeshes);
      entry.ruinDebugMeshes = [];
    }
    if (entry.shellMesh) entry.shellMesh.geometry.dispose();
    for (const module of entry.modules.values()) {
      for (const mesh of module.meshes ?? []) mesh.geometry.dispose();
      module.shellMesh?.geometry.dispose();
    }
    this.root.remove(entry.group);
    this.entries.delete(constructionId);
    this.buildQueue = this.buildQueue.filter((job) => job.constructionId !== constructionId);
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
        shellMesh: null,
        shellPath: null,
        modules: new Map(),
        plan: null,
        arcTable: null,
        materials: null,
      };
      this.entries.set(record.id, entry);
    }
    entry.record = record;
    this.positionGroup(entry);

    if (hint?.materialOnly && entry.shellMesh) {
      // Geometry is unchanged; only the material assignment can differ.
      entry.materials = this.createMaterials(record);
      this.applyEntryMaterials(entry);
      return;
    }

    // Rebuilt per revision: the arc table is the shared arc-length view the
    // masonry builder places against, and must match the path the plan solved.
    entry.arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
    entry.materials = this.createMaterials(record);

    // Cached so a module shell is a slice of the same sampled curve the record
    // shell used, rather than a second sampling that could seam differently.
    entry.shellPath = sampleShellPath(record);

    if (entry.shellMesh) {
      entry.group.remove(entry.shellMesh);
      entry.shellMesh.geometry.dispose();
    }
    const shellMesh = new THREE.Mesh(
      buildWallGeometry(record, this.terrainView, entry.origin),
      record.id === this.selectedId ? this.selectedMaterial : this.wallMaterial,
    );
    shellMesh.name = `construction-shell:${record.id}`;
    shellMesh.userData.constructionId = record.id;
    shellMesh.castShadow = true;
    shellMesh.receiveShadow = true;
    entry.group.add(shellMesh);
    entry.shellMesh = shellMesh;
    entry.group.visible = record.id !== this.previewedConstructionId;
    this.scheduleCompile(record, hint);
  }

  applyResidentMaterials(entry, selected) {
    if (!entry.materials) return;
    const shell = selected ? this.selectedMaterial : this.wallMaterial;
    for (const resident of entry.modules.values()) {
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
      entry.shellMesh.material = selected ? this.selectedMaterial : this.wallMaterial;
    }
    this.applyResidentMaterials(entry, selected);
  }

  onStoreChange(change) {
    if (change.kind === 'clear' || change.kind === 'replace') {
      this.refreshAll();
      return;
    }
    if (change.after) this.upsertRecord(change.after, change.hint ?? null);
    else if (change.id) this.removeRecord(change.id);
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    if (change.id === this.selectedId || !this.selectedId) this.rebuildHandles();
  }

  refreshAll() {
    for (const id of [...this.entries.keys()]) this.removeRecord(id);
    for (const record of this.store.list()) this.upsertRecord(record);
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    this.rebuildHandles();
  }

  /**
   * Floating-origin rebase. Because module geometry is origin-local this is a
   * transform update, not a rebuild — which is the difference between a
   * multi-hundred-millisecond hitch and nothing at all once masonry lands.
   */
  rebase() {
    for (const entry of this.entries.values()) this.positionGroup(entry);
    this.repositionHandles();
    if (this.previewMesh) {
      const render = this.floatingOrigin.toRender(this.previewOrigin.x, this.previewOrigin.z);
      this.previewMesh.position.set(render.x, 0, render.z);
    }
  }

  scheduleCompile(record, hint = null) {
    if (!this.compilerClient) return;
    this.compilerClient.compile(record).then((plan) => {
      if (this.store.get(record.id)?.revision !== plan.constructionRevision) return;
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
  // eslint-disable-next-line no-unused-vars
  applyPlan(record, plan, hint = null) {
    const entry = this.entries.get(record.id);
    if (!entry) return;
    entry.plan = plan;
    if (entry.shellMesh) entry.shellMesh.userData.structuralPlan = plan;
    this.rebuildRecordShell(entry, plan);
    const planned = new Set();
    for (const module of plan.modules) {
      planned.add(module.id);
      const existing = entry.modules.get(module.id);
      if (existing && existing.hash === module.contentHash) {
        this.stats.modulesSkippedByHash += 1;
        continue;
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
    this.refreshRuinDebug(entry, plan);
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
      : this.wallMaterial;
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
      entry.record.id === this.selectedId ? this.selectedMaterial : this.wallMaterial,
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

  enqueueModuleBuild(constructionId, module, requestedBand = null) {
    const entry = this.entries.get(constructionId);
    const resident = entry?.modules.get(module.id);
    const band = requestedBand
      ?? resident?.requestedBand
      ?? resident?.band
      ?? 'near';
    if (resident) {
      const buildKey = moduleBuildKey({
        constructionId,
        revision: entry.record.revision,
        moduleId: module.id,
        contentHash: module.contentHash,
        requestedBand: band,
      });
      const decision = evaluateBuildRequest({ resident, buildKey });
      if (!decision.enqueue) {
        this.stats.duplicateBuildsSuppressed += 1;
        return;
      }
      resident.pendingBuildKey = buildKey;
      resident.requestedBand = band;
      resident.requestedAt = performance.now();
    }
    this.buildQueue = this.buildQueue.filter((job) => (
      job.constructionId !== constructionId || job.module.id !== module.id
    ));
    this.buildQueue.push({ constructionId, module, requestedBand: band });
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
   * coarse tier is a build-time detail reduction rather than a separate mesh
   * set, so switching between them never waits on geometry.
   */
  updateLod(camera, viewportHeight) {
    if (!camera || !(viewportHeight > 0)) return;
    let nearCount = 0;
    let coarseCount = 0;
    let shellCount = 0;
    const now = performance.now();
    for (const entry of this.entries.values()) {
      if (!entry.plan) continue;
      const pinned = entry.record.id === this.selectedId;
      let uncovered = 0;
      for (const module of entry.plan.modules) {
        const resident = entry.modules.get(module.id);
        if (!resident) continue;
        const pixels = moduleProjectedPixels({
          camera,
          module,
          height: entry.record.dimensions.height,
          viewportHeight,
          // Module bounds are canonical; the camera is in render space.
          toRender: (x, z) => this.floatingOrigin.toRender(x, z),
          cameraY: camera.position.y,
        });
        const previousVisible = resident.visibleBand ?? resident.band ?? null;
        const band = resolveRequestedLodBand({
          pixels,
          previousVisible,
          pinned,
          now,
          visibleSince: resident.visibleSince ?? 0,
          styleKey: entry.record.style?.key,
          force: !resident.builtBand || resident.meshes.length === 0,
          // Metre hysteresis (`transition.hysteresisMetres`) activates only when
          // distanceMetres / nearDistanceMetres / shellDistanceMetres are passed.
          // Pixel hysteresis from selectConstructionLod remains the live path.
        });
        resident.requestedBand = band;
        if (band !== previousVisible) {
          this.stats.lodTransitionsStarted += 1;
          this.stats.lodTransitions += 1;
          const needsRebuild = (
            (band === 'near' || band === 'coarse')
            && resident.builtBand
            && resident.builtBand !== band
          );
          if (needsRebuild) {
            this.enqueueModuleBuild(entry.record.id, module, band);
            // Keep showing the previous band until the destination mesh lands.
          } else {
            resident.visibleBand = band;
            resident.visibleSince = now;
            resident.band = band;
          }
        } else {
          resident.band = band;
          resident.visibleBand = band;
        }
        const shown = resident.visibleBand ?? resident.band ?? band;
        const visible = shown !== 'shell' && resident.meshes.length > 0;
        for (const mesh of resident.meshes) mesh.visible = visible;
        // Each module's ribbon covers exactly the arc its masonry vacated.
        if (resident.shellMesh) resident.shellMesh.visible = !visible;
        if (!visible) uncovered += 1;
        if (band === 'near') nearCount += 1;
        else if (band === 'coarse') coarseCount += 1;
        else shellCount += 1;
      }
      // The record-wide ribbon is only the fallback for arcs no module owns a
      // shell for; once every module has one it would just double the surface.
      if (entry.shellMesh) {
        entry.shellMesh.visible = uncovered > 0 && !this.modulesOwnTheirShells(entry);
      }
    }
    this.stats.modulesNear = nearCount;
    this.stats.modulesCoarse = coarseCount;
    this.stats.modulesShell = shellCount;
  }

  update() {
    if (this.buildQueue.length === 0) return;
    const started = performance.now();
    let built = 0;
    while (
      this.buildQueue.length > 0
      && built < MODULE_BUILD_COUNT
      && performance.now() - started < MODULE_BUILD_BUDGET_MS
    ) {
      const job = this.buildQueue.shift();
      const entry = this.entries.get(job.constructionId);
      if (!entry || !entry.modules.has(job.module.id)) continue;
      const moduleStarted = performance.now();
      this.buildModule(entry, job.module);
      this.stats.buildMs += performance.now() - moduleStarted;
      this.stats.modulesRebuilt += 1;
      built += 1;
    }
    this.stats.queueDepth = this.buildQueue.length;
  }

  buildModule(entry, module) {
    const resident = entry.modules.get(module.id);
    if (!resident) return;
    // Prefer the LOD band updateLod already chose; default to near so the first
    // build is full detail until the camera has had a frame to classify it.
    const lodBand = (resident.requestedBand ?? resident.band) === 'coarse'
      ? 'coarse'
      : 'near';
    const expectedKey = moduleBuildKey({
      constructionId: entry.record.id,
      revision: entry.record.revision,
      moduleId: module.id,
      contentHash: module.contentHash,
      requestedBand: lodBand,
    });
    if (
      resident.pendingBuildKey
      && resident.pendingBuildKey !== expectedKey
    ) {
      this.stats.staleBuildsDiscarded += 1;
      return;
    }
    const source = module.placements ?? [];
    const placements = lodBand === 'coarse'
      ? coarsePlacements(source, { styleKey: entry.record.style?.key })
      : source;
    const built = placements.length
      ? buildModuleMasonry(placements, {
        record: entry.record,
        materials: entry.materials,
        arcTable: entry.arcTable,
        moduleOrigin: entry.origin,
        groundHeightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z) ?? 0,
        lodBand,
      })
      : { meshes: [], stats: null };
    // Reject if the module drifted while we were building.
    if (
      !entry.modules.has(module.id)
      || entry.modules.get(module.id).hash !== module.contentHash
    ) {
      this.stats.staleBuildsDiscarded += 1;
      for (const mesh of built.meshes ?? []) mesh.geometry.dispose();
      return;
    }
    if ((resident.requestedBand ?? lodBand) !== lodBand) {
      this.stats.staleBuildsDiscarded += 1;
      for (const mesh of built.meshes ?? []) mesh.geometry.dispose();
      return;
    }
    resident.builtBand = lodBand;
    resident.visibleBand = lodBand;
    resident.band = lodBand;
    resident.visibleSince = performance.now();
    resident.pendingBuildKey = null;
    this.stats.lodTransitionsCompleted += 1;
    if (lodBand === 'near') this.stats.nearBuilds += 1;
    else this.stats.coarseBuilds += 1;

    // Remove the old meshes in the same tick the new ones go in, so a module
    // never flickers to empty mid-swap (doc 18 §6).
    for (const stale of resident.meshes) {
      entry.group.remove(stale);
      stale.geometry.dispose();
    }
    for (const mesh of built.meshes) {
      const slot = mesh.userData.constructionMaterialSlot
        ?? CONSTRUCTION_MATERIAL_SLOT.STONE;
      mesh.name = [
        'construction-masonry',
        entry.record.id,
        module.id,
        slot,
      ].join(':');
      mesh.userData.constructionId = entry.record.id;
      entry.group.add(mesh);
    }
    resident.meshes = built.meshes;
    resident.stats = built.stats;
    this.refreshModuleStats();
    this.applySelectionMaterial(entry.record.id, entry);
    this.updateShellVisibility(entry);
  }

  /** Recompute stone/mortar counters from resident module stats (avoids drift). */
  refreshModuleStats() {
    let stones = 0;
    let mortarPrisms = 0;
    let stoneTriangles = 0;
    let mortarTriangles = 0;
    let reliefStones = 0;
    let reliefFallbacks = 0;
    let reliefClamped = 0;
    let reliefTriangles = 0;
    let reliefBuildMs = 0;
    let edgeWearEligible = 0;
    let edgeWearStones = 0;
    let edgeWearClamped = 0;
    let edgeWearFallbacks = 0;
    let flattenedCorners = 0;
    let edgeWearTriangles = 0;
    let edgeWearBuildMs = 0;
    let nearSoftStones = 0;
    let coarseSoftStones = 0;
    let nearSoftTriangles = 0;
    let coarseSoftTriangles = 0;
    let appearanceDescriptors = 0;
    let appearanceDescriptorMs = 0;
    let lodReductionMs = 0;
    let stoneBuildMs = 0;
    let mortarBuildMs = 0;
    for (const entry of this.entries.values()) {
      for (const other of entry.modules.values()) {
        stones += other.stats?.stones ?? 0;
        mortarPrisms += other.stats?.mortarPrisms ?? 0;
        stoneTriangles += other.stats?.stoneTriangles ?? 0;
        mortarTriangles += other.stats?.mortarTriangles ?? 0;
        reliefStones += other.stats?.reliefStones ?? 0;
        reliefFallbacks += other.stats?.reliefFallbacks ?? 0;
        reliefClamped += other.stats?.reliefClamped ?? 0;
        reliefTriangles += other.stats?.reliefTriangles ?? 0;
        reliefBuildMs += other.stats?.reliefBuildMs ?? 0;
        edgeWearEligible += other.stats?.edgeWearEligible ?? 0;
        edgeWearStones += other.stats?.edgeWearStones ?? 0;
        edgeWearClamped += other.stats?.edgeWearClamped ?? 0;
        edgeWearFallbacks += other.stats?.edgeWearFallbacks ?? 0;
        flattenedCorners += other.stats?.flattenedCorners ?? 0;
        edgeWearTriangles += other.stats?.edgeWearTriangles ?? 0;
        edgeWearBuildMs += other.stats?.edgeWearBuildMs ?? 0;
        nearSoftStones += other.stats?.nearSoftStones ?? 0;
        coarseSoftStones += other.stats?.coarseSoftStones ?? 0;
        nearSoftTriangles += other.stats?.nearSoftTriangles ?? 0;
        coarseSoftTriangles += other.stats?.coarseSoftTriangles ?? 0;
        appearanceDescriptors += other.stats?.appearanceDescriptors ?? 0;
        appearanceDescriptorMs += other.stats?.appearanceDescriptorMs ?? 0;
        lodReductionMs += other.stats?.lodReductionMs ?? 0;
        stoneBuildMs += other.stats?.stoneBuildMs ?? 0;
        mortarBuildMs += other.stats?.mortarBuildMs ?? 0;
      }
    }
    this.stats.stones = stones;
    this.stats.mortarPrisms = mortarPrisms;
    this.stats.stoneTriangles = stoneTriangles;
    this.stats.mortarTriangles = mortarTriangles;
    this.stats.reliefStones = reliefStones;
    this.stats.reliefFallbacks = reliefFallbacks;
    this.stats.reliefClamped = reliefClamped;
    this.stats.reliefTriangles = reliefTriangles;
    this.stats.reliefBuildMs = reliefBuildMs;
    this.stats.edgeWearEligible = edgeWearEligible;
    this.stats.edgeWearStones = edgeWearStones;
    this.stats.edgeWearClamped = edgeWearClamped;
    this.stats.edgeWearFallbacks = edgeWearFallbacks;
    this.stats.flattenedCorners = flattenedCorners;
    this.stats.edgeWearTriangles = edgeWearTriangles;
    this.stats.edgeWearBuildMs = edgeWearBuildMs;
    this.stats.nearSoftStones = nearSoftStones;
    this.stats.coarseSoftStones = coarseSoftStones;
    this.stats.nearSoftTriangles = nearSoftTriangles;
    this.stats.coarseSoftTriangles = coarseSoftTriangles;
    this.stats.appearanceDescriptors = appearanceDescriptors;
    this.stats.appearanceDescriptorMs = appearanceDescriptorMs;
    this.stats.lodReductionMs = lodReductionMs;
    this.stats.stoneBuildMs = stoneBuildMs;
    this.stats.mortarBuildMs = mortarBuildMs;
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
  updateShellVisibility(entry) {
    let pending = 0;
    for (const resident of entry.modules.values()) {
      // Same rule `updateLod` applies, so a build landing mid-frame cannot
      // un-hide the masonry of a module the camera already sent to the far band.
      const bare = resident.meshes.length === 0 || resident.band === 'shell';
      if (bare) pending += 1;
      if (resident.shellMesh) resident.shellMesh.visible = bare;
    }
    if (!entry.shellMesh) return;
    const covered = entry.modules.size > 0
      && (pending === 0 || this.modulesOwnTheirShells(entry));
    entry.shellMesh.visible = !covered;
  }

  setSelection(constructionId) {
    this.selectedId = constructionId && this.store.get(constructionId)
      ? String(constructionId)
      : null;
    for (const [id, entry] of this.entries) this.applySelectionMaterial(id, entry);
    this.rebuildHandles();
  }

  handleAnchorPosition(record, anchor) {
    const render = this.floatingOrigin.toRender(anchor.position[0], anchor.position[1]);
    const height = this.terrainView.getCanonicalHeight(anchor.position[0], anchor.position[1]) ?? 0;
    return { x: render.x, y: height + record.dimensions.height + 0.28, z: render.z };
  }

  rebuildHandles() {
    for (const mesh of this.handleMeshes) this.root.remove(mesh);
    this.handleMeshes = [];
    const record = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!record || record.path.type !== 'cubicBezier') return;
    for (const anchor of record.path.anchors) {
      const mesh = new THREE.Mesh(this.handleGeometry, this.handleMaterial);
      const at = this.handleAnchorPosition(record, anchor);
      mesh.position.set(at.x, at.y, at.z);
      mesh.renderOrder = 100;
      mesh.userData.constructionId = record.id;
      mesh.userData.anchorId = anchor.id;
      this.root.add(mesh);
      this.handleMeshes.push(mesh);
    }
  }

  repositionHandles() {
    const record = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!record || record.path.type !== 'cubicBezier') return;
    const anchors = new Map(record.path.anchors.map((anchor) => [anchor.id, anchor]));
    for (const mesh of this.handleMeshes) {
      const anchor = anchors.get(mesh.userData.anchorId);
      if (!anchor) continue;
      const at = this.handleAnchorPosition(record, anchor);
      mesh.position.set(at.x, at.y, at.z);
    }
  }

  /** Tint the dragged anchor's handle to show which snap is about to apply. */
  setSnapFeedback(anchorId, snapKind) {
    for (const mesh of this.handleMeshes) {
      const active = anchorId && mesh.userData.anchorId === anchorId && snapKind;
      mesh.material = active
        ? this.snapMaterials.get(snapKind) ?? this.handleMaterial
        : this.handleMaterial;
      mesh.scale.setScalar(active ? 1.35 : 1);
    }
  }

  setDraft(record, {
    valid = true,
    constructionId = null,
    snapKind = null,
    anchorId = null,
  } = {}) {
    this.clearDraft();
    this.setSnapFeedback(anchorId, snapKind);
    this.previewedConstructionId = constructionId;
    if (constructionId) {
      const entry = this.entries.get(constructionId);
      if (entry) entry.group.visible = false;
    }
    this.previewOrigin = originForRecord(record);
    this.previewMesh = new THREE.Mesh(
      buildWallGeometry(record, this.terrainView, this.previewOrigin),
      valid ? this.previewMaterial : this.invalidPreviewMaterial,
    );
    const render = this.floatingOrigin.toRender(this.previewOrigin.x, this.previewOrigin.z);
    this.previewMesh.position.set(render.x, 0, render.z);
    this.previewMesh.name = 'construction-preview';
    this.previewMesh.renderOrder = 20;
    this.root.add(this.previewMesh);
  }

  clearDraft() {
    this.setSnapFeedback(null, null);
    if (this.previewMesh) {
      this.root.remove(this.previewMesh);
      this.previewMesh.geometry.dispose();
      this.previewMesh = null;
    }
    if (this.previewedConstructionId) {
      const entry = this.entries.get(this.previewedConstructionId);
      if (entry) entry.group.visible = true;
    }
    this.previewedConstructionId = null;
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
      }
      : null;
  }

  dispose() {
    this.unsubscribe?.();
    this.clearDraft();
    for (const id of [...this.entries.keys()]) this.removeRecord(id);
    this.scene.remove(this.root);
    this.wallMaterial.dispose();
    this.selectedMaterial.dispose();
    this.previewMaterial.dispose();
    this.invalidPreviewMaterial.dispose();
    this.handleGeometry.dispose();
    this.handleMaterial.dispose();
    for (const material of this.snapMaterials.values()) material.dispose();
    this.snapMaterials.clear();
  }
}
