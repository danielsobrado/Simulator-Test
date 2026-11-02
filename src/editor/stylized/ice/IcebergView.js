import * as THREE from 'three/webgpu';
import { CellResidency } from '../lod/CellResidency.js';
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
    this.residency = new CellResidency({ cellMeters: ICEBERG_CELL_METERS, reachCells: REACH_CELLS, cellsPerFrame: CELLS_PER_FRAME });
    this.resolve = (cellX, cellZ) => this.resolveCell(cellX, cellZ);
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

  write() {
    this.anchor.follow(this.floatingOrigin.getState());
    const bergs = this.residency.values();
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
    this.residency.refocus(cameraWorld.x, cameraWorld.z);
    if (this.residency.step(this.resolve)) this.write();
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
