import * as THREE from 'three/webgpu';
import { InstanceAnchor } from '../lod/InstanceAnchor.js';
import { ICEBERG_CELL_METERS, ICEBERG_KINDS, icebergCandidate, icebergHasRoom } from './icebergField.js';
import { createIcebergGeometry } from './icebergGeometry.js';
import { createIceMaterial } from './IceMaterial.js';

const REACH_CELLS = 6;
const CAPACITY = 48;
/** World queries a frame: each cell asks up to thirty tiles, once. */
const CELLS_PER_FRAME = 6;
const COLD_RINGS_METERS = [300, 900, 1800];
const COLD_DIRECTIONS = 6;
/** Ground snow that makes a shore cold enough to calve: tundra and glacier do. */
const COLD_GROUND_SNOW = 0.5;
const WATER_TILE = 0;
const scratch = new THREE.Object3D();

/** Icebergs off cold coasts: one instanced draw per shape, and nothing built until one is near. */
export class IcebergView {
  constructor({ scene, worldStore, floatingOrigin, seaLevel, sunDirection, snowGroundByTile, seed = 0 }) {
    this.worldStore = worldStore;
    this.floatingOrigin = floatingOrigin;
    this.seaLevel = seaLevel;
    this.sunDirection = sunDirection;
    this.snowGroundByTile = snowGroundByTile;
    this.seed = seed;
    this.root = new THREE.Group();
    this.root.name = 'icebergs';
    scene.add(this.root);
    this.anchor = new InstanceAnchor();
    this.meshes = [];
    this.cells = new Map();
    this.focusKey = null;
    this.pending = [];
    this.dirty = false;
    this.isSea = (x, z) => this.tileAt(x, z) === WATER_TILE;
  }

  tileAt(x, z) {
    const size = this.worldStore.tileSize;
    // Tile rows run opposite to render z.
    return this.worldStore.getTile(Math.floor(x / size), Math.floor(-z / size));
  }

  isColdCoast(x, z) {
    for (const ring of COLD_RINGS_METERS) {
      for (let i = 0; i < COLD_DIRECTIONS; i += 1) {
        const angle = (i / COLD_DIRECTIONS) * Math.PI * 2;
        const tile = this.tileAt(x + Math.cos(angle) * ring, z + Math.sin(angle) * ring);
        if ((this.snowGroundByTile[tile] ?? 0) >= COLD_GROUND_SNOW) return true;
      }
    }
    return false;
  }

  resolveCell(cellX, cellZ) {
    const candidate = icebergCandidate(cellX, cellZ, this.seed);
    if (!candidate || !icebergHasRoom(candidate, this.isSea) || !this.isColdCoast(candidate.x, candidate.z)) return null;
    return candidate;
  }

  ensureMeshes() {
    if (this.meshes.length) return;
    const material = createIceMaterial({ sunDirection: this.sunDirection, seaLevel: this.seaLevel });
    for (let kind = 0; kind < ICEBERG_KINDS; kind += 1) {
      const mesh = new THREE.InstancedMesh(createIcebergGeometry(kind), material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
  }

  refocus(cameraX, cameraZ) {
    const focusX = Math.floor(cameraX / ICEBERG_CELL_METERS);
    const focusZ = Math.floor(cameraZ / ICEBERG_CELL_METERS);
    const key = `${focusX}:${focusZ}`;
    if (key === this.focusKey) return;
    this.focusKey = key;
    const wanted = new Set();
    this.pending.length = 0;
    for (let x = focusX - REACH_CELLS; x <= focusX + REACH_CELLS; x += 1) {
      for (let z = focusZ - REACH_CELLS; z <= focusZ + REACH_CELLS; z += 1) {
        const cell = `${x}:${z}`;
        wanted.add(cell);
        if (!this.cells.has(cell)) this.pending.push([x, z, cell]);
      }
    }
    for (const cell of this.cells.keys()) {
      if (wanted.has(cell)) continue;
      if (this.cells.get(cell)) this.dirty = true;
      this.cells.delete(cell);
    }
  }

  write() {
    this.dirty = false;
    this.anchor.follow(this.floatingOrigin.getState());
    const bergs = [...this.cells.values()].filter(Boolean);
    if (bergs.length) this.ensureMeshes();
    for (const mesh of this.meshes) mesh.count = 0;
    for (const berg of bergs) {
      const mesh = this.meshes[berg.kind];
      if (mesh.count >= CAPACITY) continue;
      scratch.position.set(berg.x - this.anchor.x, this.seaLevel, berg.z - this.anchor.z);
      scratch.rotation.set(0, berg.yaw, 0);
      scratch.scale.setScalar(berg.scale);
      scratch.updateMatrix();
      mesh.setMatrixAt(mesh.count, scratch.matrix);
      mesh.count += 1;
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true;
  }

  /** @param {{ x: number, z: number }} cameraWorld canonical metres */
  update(cameraWorld) {
    this.refocus(cameraWorld.x, cameraWorld.z);
    for (let i = 0; i < CELLS_PER_FRAME && this.pending.length; i += 1) {
      const [x, z, cell] = this.pending.pop();
      const berg = this.resolveCell(x, z);
      this.cells.set(cell, berg);
      if (berg) this.dirty = true;
    }
    if (this.dirty && !this.pending.length) this.write();
    this.anchor.place(this.root, this.floatingOrigin.getState());
  }

  dispose() {
    this.root.removeFromParent();
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.meshes[0]?.material.dispose();
  }
}
