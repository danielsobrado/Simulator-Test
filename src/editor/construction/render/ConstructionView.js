import * as THREE from 'three/webgpu';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';

const FOUNDATION_OVERLAP = 0.08;
const HANDLE_RADIUS = 0.16;

function buildWallGeometry(record, terrainView, floatingOrigin) {
  const sampled = sampleCubicBezierPath(record.path, {
    chordError: 0.08,
    maxSpacing: 0.65,
  });
  const positions = [];
  const indices = [];
  const halfWidth = record.dimensions.thickness / 2;
  for (const entry of sampled.points) {
    const leftCanonical = {
      x: entry.x + entry.normalX * halfWidth,
      z: entry.z + entry.normalZ * halfWidth,
    };
    const rightCanonical = {
      x: entry.x - entry.normalX * halfWidth,
      z: entry.z - entry.normalZ * halfWidth,
    };
    const left = floatingOrigin.toRender(leftCanonical.x, leftCanonical.z);
    const right = floatingOrigin.toRender(rightCanonical.x, rightCanonical.z);
    const centerHeight = terrainView.getCanonicalHeight(entry.x, entry.z) ?? 0;
    const bottom = centerHeight - FOUNDATION_OVERLAP;
    const top = centerHeight + record.dimensions.height;
    positions.push(
      left.x, bottom, left.z,
      right.x, bottom, right.z,
      left.x, top, left.z,
      right.x, top, right.z,
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
    this.plans = new Map();
    this.root = new THREE.Group();
    this.root.name = 'live-constructions';
    this.scene.add(this.root);
    this.meshes = new Map();
    this.handleMeshes = [];
    this.selectedId = null;
    this.previewMesh = null;
    this.previewedConstructionId = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
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

  removeRecord(constructionId) {
    const mesh = this.meshes.get(constructionId);
    if (mesh) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
      this.meshes.delete(constructionId);
    }
    this.plans.delete(constructionId);
  }

  upsertRecord(record) {
    this.removeRecord(record.id);
    if (record.path.type !== 'cubicBezier') return;
    const mesh = new THREE.Mesh(
      buildWallGeometry(record, this.terrainView, this.floatingOrigin),
      record.id === this.selectedId ? this.selectedMaterial : this.wallMaterial,
    );
    mesh.name = `construction:${record.id}`;
    mesh.userData.constructionId = record.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (record.id === this.previewedConstructionId) mesh.visible = false;
    this.root.add(mesh);
    this.meshes.set(record.id, mesh);
    this.scheduleCompile(record);
  }

  onStoreChange(change) {
    if (change.kind === 'clear' || change.kind === 'replace') {
      this.refreshAll();
      return;
    }
    if (change.after) this.upsertRecord(change.after);
    else if (change.id) this.removeRecord(change.id);
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    if (change.id === this.selectedId || !this.selectedId) this.rebuildHandles();
  }

  refreshAll() {
    for (const mesh of this.meshes.values()) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.plans.clear();
    for (const record of this.store.list()) {
      this.upsertRecord(record);
    }
    if (this.selectedId && !this.store.get(this.selectedId)) this.selectedId = null;
    this.rebuildHandles();
  }

  scheduleCompile(record) {
    if (!this.compilerClient) return;
    this.compilerClient.compile(record).then((plan) => {
      if (this.store.get(record.id)?.revision !== plan.constructionRevision) return;
      this.plans.set(record.id, plan);
      const mesh = this.meshes.get(record.id);
      if (mesh) mesh.userData.structuralPlan = plan;
    }).catch((error) => {
      if (error?.name !== 'AbortError') {
        console.error(`Construction ${record.id} planning failed.`, error);
      }
    });
  }

  setSelection(constructionId) {
    this.selectedId = constructionId && this.store.get(constructionId)
      ? String(constructionId)
      : null;
    for (const [id, mesh] of this.meshes) {
      mesh.material = id === this.selectedId ? this.selectedMaterial : this.wallMaterial;
    }
    this.rebuildHandles();
  }

  rebuildHandles() {
    for (const mesh of this.handleMeshes) this.root.remove(mesh);
    this.handleMeshes = [];
    const record = this.selectedId ? this.store.get(this.selectedId) : null;
    if (!record || record.path.type !== 'cubicBezier') return;
    for (const anchor of record.path.anchors) {
      const render = this.floatingOrigin.toRender(anchor.position[0], anchor.position[1]);
      const height = this.terrainView.getCanonicalHeight(anchor.position[0], anchor.position[1]) ?? 0;
      const mesh = new THREE.Mesh(this.handleGeometry, this.handleMaterial);
      mesh.position.set(render.x, height + record.dimensions.height + 0.28, render.z);
      mesh.renderOrder = 100;
      mesh.userData.constructionId = record.id;
      mesh.userData.anchorId = anchor.id;
      this.root.add(mesh);
      this.handleMeshes.push(mesh);
    }
  }

  setDraft(record, { valid = true, constructionId = null } = {}) {
    this.clearDraft();
    this.previewedConstructionId = constructionId;
    if (constructionId) {
      const source = this.meshes.get(constructionId);
      if (source) source.visible = false;
    }
    this.previewMesh = new THREE.Mesh(
      buildWallGeometry(record, this.terrainView, this.floatingOrigin),
      valid ? this.previewMaterial : this.invalidPreviewMaterial,
    );
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
      const source = this.meshes.get(this.previewedConstructionId);
      if (source) source.visible = true;
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

  pickConstruction(clientX, clientY, camera) {
    this.setPointer(clientX, clientY);
    this.raycaster.setFromCamera(this.pointer, camera);
    const found = this.raycaster.intersectObjects([...this.meshes.values()], false)
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
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear();
    this.plans.clear();
    this.scene.remove(this.root);
    this.wallMaterial.dispose();
    this.selectedMaterial.dispose();
    this.previewMaterial.dispose();
    this.invalidPreviewMaterial.dispose();
    this.handleGeometry.dispose();
    this.handleMaterial.dispose();
  }
}
