import * as THREE from 'three/webgpu';
import { CellResidency } from '../lod/CellResidency.js';
import { InstanceAnchor } from '../lod/InstanceAnchor.js';
import { ALPINE_CELL_METERS, ALPINE_ROCK_KINDS, alpineRocksInCell } from './alpineRockField.js';
import { createAlpineRockGeometry } from './alpineRockGeometry.js';
import { createAlpineRockMaterial } from './AlpineRockMaterial.js';

/** Inside the near terrain: past it the far mesh is too coarse to stand a rock on. */
const REACH_CELLS = 7;
const CELLS_PER_FRAME = 10;
const CAPACITY = 220;
/** Ground below this height needs a snowy biome to grow these. */
const ALPINE_HEIGHT = 550;
const COLD_GROUND_SNOW = 0.5;
const SLOPE_STEP_METERS = 3;
/** Share of a rock's height left in the ground, so it breaks out rather than sits on it. */
const BURIAL = 0.35;
const UP = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Object3D();
const normal = new THREE.Vector3();
const spin = new THREE.Quaternion();

/** Crags and boulder clusters round the player: one instanced draw per shape, nothing until one is near. */
export class AlpineRockView {
  constructor({ scene, terrainView, snowGroundByTile, seaLevel }) {
    this.terrainView = terrainView;
    this.floatingOrigin = terrainView.floatingOrigin;
    this.snowGroundByTile = snowGroundByTile;
    this.seaLevel = seaLevel;
    this.root = new THREE.Group();
    this.root.name = 'alpine-rocks';
    scene.add(this.root);
    this.anchor = new InstanceAnchor();
    this.meshes = [];
    this.residency = new CellResidency({ cellMeters: ALPINE_CELL_METERS, reachCells: REACH_CELLS, cellsPerFrame: CELLS_PER_FRAME });
    this.ground = (x, z) => this.groundAt(x, z);
    this.resolve = (cellX, cellZ) => this.resolveCell(cellX, cellZ);
  }

  groundAt(x, z) {
    const view = this.terrainView;
    const height = view.getCanonicalHeight(x, z);
    const size = view.worldStore.tileSize;
    const snowy = (this.snowGroundByTile[view.worldStore.getTile(Math.floor(x / size), Math.floor(-z / size))] ?? 0) >= COLD_GROUND_SNOW;
    const allowed = height > this.seaLevel + 1 && (height >= ALPINE_HEIGHT || snowy);
    if (!allowed) return { allowed, slope: 0, height };
    const dx = (view.getCanonicalHeight(x + SLOPE_STEP_METERS, z) - height) / SLOPE_STEP_METERS;
    const dz = (view.getCanonicalHeight(x, z + SLOPE_STEP_METERS) - height) / SLOPE_STEP_METERS;
    return { allowed, slope: Math.hypot(dx, dz), height, dx, dz };
  }

  resolveCell(cellX, cellZ) {
    const rocks = alpineRocksInCell(cellX, cellZ, this.ground);
    if (!rocks) return null;
    for (const rock of rocks) {
      const ground = this.groundAt(rock.x, rock.z);
      rock.y = ground.height;
      rock.dx = ground.dx ?? 0;
      rock.dz = ground.dz ?? 0;
    }
    return rocks;
  }

  ensureMeshes() {
    if (this.meshes.length) return;
    const material = createAlpineRockMaterial();
    for (let kind = 0; kind < ALPINE_ROCK_KINDS; kind += 1) {
      const mesh = new THREE.InstancedMesh(createAlpineRockGeometry(kind), material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.meshes.push(mesh);
    }
  }

  write() {
    this.anchor.follow(this.floatingOrigin.getState());
    const rocks = this.residency.values().flat();
    if (rocks.length) this.ensureMeshes();
    for (const mesh of this.meshes) mesh.count = 0;
    for (const rock of rocks) {
      const mesh = this.meshes[rock.kind];
      if (mesh.count >= CAPACITY) continue;
      scratch.position.set(rock.x - this.anchor.x, rock.y + rock.scale * rock.stretch * (0.5 - BURIAL), rock.z - this.anchor.z);
      // Half way to the slope: crags lean with the mountain without lying flat on it.
      normal.set(-rock.dx * 0.5, 1, -rock.dz * 0.5).normalize();
      scratch.quaternion.setFromUnitVectors(UP, normal).multiply(spin.setFromAxisAngle(UP, rock.yaw));
      scratch.scale.set(rock.scale, rock.scale * rock.stretch, rock.scale);
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
