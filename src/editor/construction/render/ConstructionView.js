import * as THREE from 'three/webgpu';
import { cubicBezierPathBounds, sampleCubicBezierPath } from '../curve/CubicBezierPath.js';

const FOUNDATION_OVERLAP = 0.08;
const HANDLE_RADIUS = 0.16;

/**
 * Record origins snap to this grid so an ordinary edit does not move the origin
 * and invalidate every module's geometry. 64 m is well inside float32's precise
 * range and coarse enough that dragging an anchor never crosses a cell.
 */
const ORIGIN_QUANTUM = 64;

/** Per-frame ceiling on module rebuilds, so a large commit cannot hitch. */
const MODULE_BUILD_BUDGET_MS = 4;
const MODULE_BUILD_COUNT = 2;

function quantizeOrigin(value) {
  return Math.round(value / ORIGIN_QUANTUM) * ORIGIN_QUANTUM;
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
  constructor({ terrainView, store, compilerClient = null }) {
    this.terrainView = terrainView;
    this.floatingOrigin = terrainView.floatingOrigin;
    this.scene = terrainView.scene;
    this.store = store;
    this.compilerClient = compilerClient;
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
      entry = { group, origin, shellMesh: null, modules: new Map(), plan: null };
      this.entries.set(record.id, entry);
    }
    entry.record = record;
    this.positionGroup(entry);

    if (hint?.materialOnly && entry.shellMesh) {
      // Geometry is unchanged; only the material assignment can differ.
      this.applySelectionMaterial(record.id, entry);
      return;
    }

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

  applySelectionMaterial(constructionId, entry) {
    if (!entry.shellMesh) return;
    entry.shellMesh.material = constructionId === this.selectedId
      ? this.selectedMaterial
      : this.wallMaterial;
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
      this.buildModule(entry, job.module);
      this.stats.modulesRebuilt += 1;
      built += 1;
    }
    this.stats.queueDepth = this.buildQueue.length;
  }

  // eslint-disable-next-line class-methods-use-this, no-unused-vars
  buildModule(entry, module) {
    // Filled in by the masonry phase. The shell already covers this module's
    // arc range, so doing nothing here is visually correct, not a stub hole.
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

  setDraft(record, { valid = true, constructionId = null } = {}) {
    this.clearDraft();
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

  pickTargets() {
    const targets = [];
    for (const entry of this.entries.values()) {
      if (!entry.group.visible || !entry.shellMesh) continue;
      targets.push(entry.shellMesh);
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
  }
}
