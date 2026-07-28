import * as THREE from 'three/webgpu';
import { cubicBezierPathBounds, sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { buildModuleMasonry } from '../compile/ConstructionMasonryBuilder.js';
import { CONSTRUCTION_MATERIAL_SLOT } from './ConstructionMaterialSlots.js';
import { createConstructionMaterials } from './ConstructionMaterials.js';
import { coarsePlacements, moduleProjectedPixels, selectConstructionLod } from './ConstructionLod.js';

const FOUNDATION_OVERLAP = 0.08;
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

/**
 * The semantic wall shell: a terrain-following extruded ribbon.
 *
 * Vertices are **origin-local**, never render-space. Baking
 * `floatingOrigin.toRender` into a vertex costs float32 precision at world
 * scale — at 3 km out a 2 mm mortar inset is not representable — and forces a
 * full rebuild on every rebase. Parenting to a group whose position carries the
 * render offset fixes both.
 */
function buildWallGeometry(record, terrainView, origin) {
  const sampled = sampleCubicBezierPath(record.path, {
    chordError: 0.08,
    maxSpacing: 0.65,
  });
  const positions = [];
  const indices = [];
  const halfWidth = record.dimensions.thickness / 2;
  for (const entry of sampled.points) {
    const leftX = entry.x + entry.normalX * halfWidth - origin.x;
    const leftZ = entry.z + entry.normalZ * halfWidth - origin.z;
    const rightX = entry.x - entry.normalX * halfWidth - origin.x;
    const rightZ = entry.z - entry.normalZ * halfWidth - origin.z;
    const centerHeight = terrainView.getCanonicalHeight(entry.x, entry.z) ?? 0;
    const bottom = centerHeight - FOUNDATION_OVERLAP;
    const top = centerHeight + record.dimensions.height;
    positions.push(
      leftX, bottom, leftZ,
      rightX, bottom, rightZ,
      leftX, top, leftZ,
      rightX, top, rightZ,
    );
  }

  for (let index = 0; index < sampled.points.length - 1; index += 1) {
    const current = index * 4;
    const next = current + 4;
    indices.push(
      current, current + 2, next + 2,
      current, next + 2, next,
      current + 1, next + 1, next + 3,
      current + 1, next + 3, current + 3,
      current + 2, current + 3, next + 3,
      current + 2, next + 3, next + 2,
      current, next, next + 1,
      current, next + 1, current + 1,
    );
  }
  const last = (sampled.points.length - 1) * 4;
  indices.push(
    0, 1, 3,
    0, 3, 2,
    last, last + 2, last + 3,
    last, last + 3, last + 1,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.constructionId = record.id;
  geometry.userData.constructionRevision = record.revision;
  return geometry;
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
    if (entry.shellMesh) entry.shellMesh.geometry.dispose();
    for (const module of entry.modules.values()) {
      for (const mesh of module.meshes ?? []) mesh.geometry.dispose();
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
    for (const resident of entry.modules.values()) {
      for (const mesh of resident.meshes) {
        mesh.material = residentMaterial(mesh, entry.materials, selected);
      }
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
    const planned = new Set();
    for (const module of plan.modules) {
      planned.add(module.id);
      const existing = entry.modules.get(module.id);
      if (existing && existing.hash === module.contentHash) {
        this.stats.modulesSkippedByHash += 1;
        continue;
      }
      entry.modules.set(module.id, { hash: module.contentHash, meshes: existing?.meshes ?? [] });
      this.enqueueModuleBuild(record.id, module);
    }
    for (const moduleId of [...entry.modules.keys()]) {
      if (planned.has(moduleId)) continue;
      const stale = entry.modules.get(moduleId);
      for (const mesh of stale.meshes ?? []) {
        entry.group.remove(mesh);
        mesh.geometry.dispose();
      }
      entry.modules.delete(moduleId);
    }
    this.refreshResidentCount();
  }

  enqueueModuleBuild(constructionId, module) {
    this.buildQueue = this.buildQueue.filter((job) => (
      job.constructionId !== constructionId || job.module.id !== module.id
    ));
    this.buildQueue.push({ constructionId, module });
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
   * `shell` reuses the record's existing ribbon, so the far band costs nothing
   * to build. `near` and `coarse` both draw the module's masonry; the coarse
   * tier is a build-time detail reduction rather than a separate mesh set, so
   * switching between them never waits on geometry.
   */
  updateLod(camera, viewportHeight) {
    if (!camera || !(viewportHeight > 0)) return;
    let nearCount = 0;
    let coarseCount = 0;
    let shellCount = 0;
    for (const entry of this.entries.values()) {
      if (!entry.plan) continue;
      const pinned = entry.record.id === this.selectedId;
      let anyShell = false;
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
        const band = selectConstructionLod({ pixels, previous: resident.band ?? null, pinned });
        if (band !== resident.band) {
          resident.band = band;
          this.stats.lodTransitions += 1;
          // near↔coarse is a build-time detail change. Rebuild when the resident
          // mesh was built for a different band; keep the old mesh visible until
          // the queue drains so the swap never flashes empty.
          if (
            (band === 'near' || band === 'coarse')
            && resident.builtBand
            && resident.builtBand !== band
          ) {
            this.enqueueModuleBuild(entry.record.id, module);
          }
        }
        const visible = band !== 'shell' && resident.meshes.length > 0;
        for (const mesh of resident.meshes) mesh.visible = visible;
        if (!visible) anyShell = true;
        if (band === 'near') nearCount += 1;
        else if (band === 'coarse') coarseCount += 1;
        else shellCount += 1;
      }
      // The shell covers whatever the module meshes are not drawing.
      if (entry.shellMesh) entry.shellMesh.visible = anyShell;
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
    const lodBand = resident.band === 'coarse' ? 'coarse' : 'near';
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
    resident.builtBand = lodBand;

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
    let stoneBuildMs = 0;
    let mortarBuildMs = 0;
    for (const entry of this.entries.values()) {
      for (const other of entry.modules.values()) {
        stones += other.stats?.stones ?? 0;
        mortarPrisms += other.stats?.mortarPrisms ?? 0;
        stoneTriangles += other.stats?.stoneTriangles ?? 0;
        mortarTriangles += other.stats?.mortarTriangles ?? 0;
        stoneBuildMs += other.stats?.stoneBuildMs ?? 0;
        mortarBuildMs += other.stats?.mortarBuildMs ?? 0;
      }
    }
    this.stats.stones = stones;
    this.stats.mortarPrisms = mortarPrisms;
    this.stats.stoneTriangles = stoneTriangles;
    this.stats.mortarTriangles = mortarTriangles;
    this.stats.stoneBuildMs = stoneBuildMs;
    this.stats.mortarBuildMs = mortarBuildMs;
  }

  /**
   * The shell is the fallback, not a second layer: it stays visible until every
   * module has its own geometry, so a wall mid-build shows a plain ribbon
   * rather than holes. Modules the budget refused keep it visible forever,
   * which is the intended degradation.
   */
  updateShellVisibility(entry) {
    if (!entry.shellMesh) return;
    let pending = 0;
    for (const resident of entry.modules.values()) {
      if (resident.meshes.length === 0) pending += 1;
    }
    const covered = entry.modules.size > 0 && pending === 0;
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
      if (entry.shellMesh?.visible) {
        targets.push(entry.shellMesh);
        continue;
      }
      for (const resident of entry.modules.values()) targets.push(...resident.meshes);
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
