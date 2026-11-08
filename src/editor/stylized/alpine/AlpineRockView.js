import * as THREE from 'three/webgpu';
import { CELL_PENDING, CellResidency } from '../lod/CellResidency.js';
import { InstanceAnchor } from '../lod/InstanceAnchor.js';
import { ALPINE_CELL_METERS, ALPINE_ROCK_KINDS, alpineRocksInCell } from './alpineRockField.js';
import { createAlpineRockGeometry } from './alpineRockGeometry.js';
import { createAlpineRockMaterial } from './AlpineRockMaterial.js';

/** Inside the near terrain: past it the far mesh is too coarse to stand a rock on. */
const REACH_CELLS = 7;
const CELLS_PER_FRAME = 10;
const CAPACITY = 220;
/** Ground below this height needs a snowy or craggy biome (biome-looks `crags`) to grow these. */
const ALPINE_HEIGHT = 550;
const COLD_GROUND_SNOW = 0.5;
const SLOPE_STEP_METERS = 3;
/** Share of a rock's height left in the ground, so it breaks out rather than sits on it. */
const BURIAL = 0.35;
const UP = new THREE.Vector3(0, 1, 0);
/** Snow on a crag where neither its biome nor its height carries any: none. */
const NO_SNOW_BAND = Object.freeze({ snowLine: Infinity, snowFade: 1 });
const scratch = new THREE.Object3D();
const normal = new THREE.Vector3();
const spin = new THREE.Quaternion();

/** Crags and boulder clusters round the player: one instanced draw per shape, nothing until one is near. */
export class AlpineRockView {
  constructor({ scene, terrainView, snowGroundByTile, cragsByTile = [], seaLevel, snowBand = NO_SNOW_BAND }) {
    this.terrainView = terrainView;
    this.floatingOrigin = terrainView.floatingOrigin;
    this.snowGroundByTile = snowGroundByTile;
    this.cragsByTile = cragsByTile;
    this.seaLevel = seaLevel;
    this.snowBand = snowBand;
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
    const tile = view.worldStore.getTile(Math.floor(x / size), Math.floor(-z / size));
    const biomeSnow = this.snowGroundByTile[tile] ?? 0;
    const rocky = biomeSnow >= COLD_GROUND_SNOW || this.cragsByTile[tile] === 1;
    const allowed = height > this.seaLevel + 1 && (height >= ALPINE_HEIGHT || rocky);
    if (!allowed) return { allowed, slope: 0, height };
    // The terrain's own two sources (SnowAccumulation): the biome's ground snow and the altitude band.
    const { snowLine, snowFade } = this.snowBand;
    const snow = Math.max(biomeSnow, THREE.MathUtils.smoothstep(height, snowLine, snowLine + snowFade));
    const dx = (view.getCanonicalHeight(x + SLOPE_STEP_METERS, z) - height) / SLOPE_STEP_METERS;
    const dz = (view.getCanonicalHeight(x, z + SLOPE_STEP_METERS) - height) / SLOPE_STEP_METERS;
    return { allowed, slope: Math.hypot(dx, dz), height, dx, dz, snow };
  }

  resolveCell(cellX, cellZ) {
    // The jitter, cluster spread and slope taps fit inside this cell plus one page.
    // Never let decorative rocks trigger the generator's synchronous water fields.
    const view = this.terrainView;
    const chunkMeters = view.worldStore.chunkSize * view.worldStore.tileSize;
    if (view.preparedPlacement && !view.preparedPlacement.ensureChunk(
      Math.floor((cellX + 0.5) * ALPINE_CELL_METERS / chunkMeters),
      Math.floor(-(cellZ + 0.5) * ALPINE_CELL_METERS / chunkMeters), 1, 0,
    )) return CELL_PENDING;
    const rocks = alpineRocksInCell(cellX, cellZ, this.ground);
    if (!rocks) return null;
    for (const rock of rocks) {
      const ground = this.groundAt(rock.x, rock.z);
      rock.y = ground.height;
      rock.dx = ground.dx ?? 0;
      rock.dz = ground.dz ?? 0;
      rock.snow = ground.snow ?? 0;
    }
    return rocks;
  }

  ensureMeshes() {
    if (this.meshes.length) return;
    const material = createAlpineRockMaterial();
    for (let kind = 0; kind < ALPINE_ROCK_KINDS; kind += 1) {
      const geometry = createAlpineRockGeometry(kind);
      geometry.setAttribute('instanceSnow', new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1));
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.meshes.push(mesh);
      this.terrainView.drawPreparation?.register(mesh);
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
      mesh.geometry.attributes.instanceSnow.setX(mesh.count, rock.snow);
      mesh.count += 1;
    }
    for (const mesh of this.meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.instanceSnow.needsUpdate = true;
    }
  }

  /** @param {{ x: number, z: number }} cameraWorld canonical metres */
  update(cameraWorld, shouldYield = () => false) {
    this.residency.refocus(cameraWorld.x, cameraWorld.z);
    if (this.residency.step(this.resolve, shouldYield)) this.write();
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
