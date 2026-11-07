import * as THREE from 'three/webgpu';
import { settlementPavingJob } from '../paving/SettlementPavingGeometry.js';
import { SHADE_LAYER } from '../paving/SettlementPavingGeometry.js';
import { createPavingMaterial, createShadeMaterial } from '../paving/SettlementPavingMaterial.js';
import { dressingFor, SETTLEMENT_SURFACE_SETS, TIMBER_TONES } from '../surfaces/SettlementDressing.js';
import { createInteriorMeshes } from './interior/InteriorMeshes.js';
import { settlementInteriorJob } from './SettlementInteriorGeometry.js';
import { settlementPlacementsJob } from './SettlementPlacements.js';
import { prepareSurfaceJob } from './SettlementPreparationJobs.js';
import { createSettlementHaze, createSettlementSmoke } from './SettlementSmoke.js';
import { stagedDrawPublication, WAIT_FOR_DRAW_PREPARATION } from '../../../../render/preparation/StagedDrawPublication.js';

const UP = new THREE.Vector3(0, 1, 0);
/** Share of a loose stone's size sunk into the ground, so it sits in the soil rather than on it. */
const STONE_SINK = 0.06;

/**
 * Ground height at a plan-space point, as the terrain mesh draws it: the
 * generator's height at the four surrounding vertices, bilinearly blended.
 * Sampling the height function itself between vertices would follow a surface
 * the mesh does not have, and paving would dip under it on every slope.
 */
function terrainHeightSampler(generator, settlement, tileSize) {
  const cache = new Map();
  const vertex = (x, z) => {
    const key = x * 73856093 + z * 19349663;
    let height = cache.get(key);
    if (height === undefined) {
      height = generator.sampleHeight(x, z);
      cache.set(key, height);
    }
    return height;
  };
  return (planX, planZ) => {
    const cellX = settlement.cellX + planX / tileSize;
    const cellZ = settlement.cellZ + planZ / tileSize;
    const x0 = Math.floor(cellX);
    const z0 = Math.floor(cellZ);
    const tx = cellX - x0;
    const tz = cellZ - z0;
    const north = vertex(x0, z0) + (vertex(x0 + 1, z0) - vertex(x0, z0)) * tx;
    const south = vertex(x0, z0 + 1) + (vertex(x0 + 1, z0 + 1) - vertex(x0, z0 + 1)) * tx;
    return north + (south - north) * tz;
  };
}

function pavingMesh(arrays, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(arrays.uvs, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3));
  geometry.setAttribute('pavingEdge', new THREE.BufferAttribute(arrays.edges, 1));
  geometry.setIndex(new THREE.BufferAttribute(arrays.indices, 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(arrays.normals, 3));
  geometry.boundingSphere = arrays.boundingSphere;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `settlement-paving-${arrays.kind}`;
  // Not for the streamed draw-preparation queue: it hides what it has not reached.
  mesh.userData.skipWarmup = true;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/** Which role of a dressing each paving layer is laid in. */
const LAYER_ROLE = Object.freeze({ earth: 'earth', cobble: 'cobble', flagstone: 'flagstone' });

/**
 * One settlement as the view holds it: its dressing, its placements and its
 * paving. The dressing's textures load in parallel from the moment the site is
 * adopted; placements and paving geometry are prepared in slices by `advance`,
 * because each needs terrain height samples.
 */
export class SettlementSite {
  constructor({ entry, plan, generator, tileSize, library, getDrawPreparation = () => null }) {
    this.getDrawPreparation = getDrawPreparation;
    this.id = entry.settlement.id;
    this.settlement = entry.settlement;
    this.plan = plan;
    const preference = plan.profile.hasRegionalIdentity ? plan.profile.recipe?.architecture?.dressingPreference : null;
    this.dressing = dressingFor(entry.settlement, plan.profile.style, preference);
    /** Tells this town's pooled meshes from another's: only the timber tone and the style differ. */
    this.poolPrefix = `${this.dressing.timberTone}|${plan.profile.style.key}|`;
    this.surfaces = null;
    this.dressed = false;
    this.disposed = false;
    const { surfaces: loading, release } = library.acquire(this.dressing);
    this.releaseSurfaces = release;
    loading.then((surfaces) => {
      if (!this.disposed) this.surfaces = Object.freeze({ ...surfaces, timberTint: TIMBER_TONES[this.dressing.timberTone] });
    }, (error) => {
      this.surfaceError = error;
      console.warn(`Settlement ${this.id} could not load its surface textures.`, error);
    });
    this.centre = { x: entry.settlement.cellX * tileSize, z: -entry.settlement.cellZ * tileSize };
    this.placements = null;
    this.smithies = [];
    this.paving = new THREE.Group();
    this.paving.name = `settlement-paving-${this.id}`;
    this.pavingReady = false;
    this.job = this.prepare(generator, tileSize);
  }

  *prepare(generator, tileSize) {
    const heightAt = terrainHeightSampler(generator, this.settlement, tileSize);
    const placements = yield* settlementPlacementsJob(this.settlement, this.plan, tileSize, heightAt);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    for (const [index, placement] of placements.entries()) {
      const sunk = placement.scale === 1 ? 0 : placement.scale * STONE_SINK;
      position.set(placement.x, placement.y - sunk, placement.z);
      rotation.setFromAxisAngle(UP, placement.rotationY);
      const matrix = new THREE.Matrix4().compose(position, rotation, scale.setScalar(placement.scale));
      // No two houses weathered alike: a stable shade per placement, over the pooled mesh.
      const colorVariation = placement.small ? 1 : 0.86 + placement.seed * 0.22;
      placement.near = { matrix, fade: 0, seed: placement.seed, ditherDirection: 1, colorVariation };
      placement.far = { matrix, fade: 0, seed: placement.seed, ditherDirection: -1, colorVariation };
      placement.blend = 0;
      placement.shown = 0;
      placement.key = `${this.dressing.timberTone}|${placement.key}`;
      if (index % 16 === 15) yield;
    }
    this.placements = placements;
    this.smithies = placements.filter(placement => placement.kind === 'smithy');
    // Smoke needs only the plan; it rides with the paving, which shares its frame.
    const smoke = createSettlementSmoke(this.plan);
    if (smoke) this.paving.add(smoke);
    const haze = createSettlementHaze(this.plan, heightAt);
    if (haze) this.paving.add(haze);
    // Rooms wear the town's own timber, plaster and stone: built once those are in.
    this.interiorArrays = yield* settlementInteriorJob(this.plan);
    yield;
    const tileMetres = Object.fromEntries(Object.entries(LAYER_ROLE)
      .map(([layer, role]) => [layer, SETTLEMENT_SURFACE_SETS[this.dressing[role]].tileMetres]));
    this.pavingArrays = yield* settlementPavingJob(this.plan, heightAt, tileMetres);
    for (const arrays of this.pavingArrays) yield* prepareSurfaceJob(arrays, true);
    for (const arrays of this.interiorArrays ?? []) yield* prepareSurfaceJob(arrays);
  }

  /** Runs preparation until `shouldYield`. Returns true once paving geometry exists. */
  advance(shouldYield) {
    if (!this.job) return true;
    for (;;) {
      const step = this.job.next();
      if (step.done) {
        this.job = null;
        return true;
      }
      if (shouldYield()) return false;
    }
  }

  /** Turns finished paving geometry into meshes, once the dressing's textures are in. */
  *installation() {
    this.stagedMeshes = [];
    const interiorMaterials = new Map();
    for (const arrays of this.pavingArrays) {
      const material = arrays.kind === SHADE_LAYER
        ? createShadeMaterial()
        : createPavingMaterial(arrays.kind, this.surfaces[LAYER_ROLE[arrays.kind]], this.plan.profile.style.style);
      const mesh = pavingMesh(arrays, material);
      // Occlusion darkens what is under it; it must not take a shadow of its own.
      if (arrays.kind === SHADE_LAYER) mesh.receiveShadow = false;
      this.stagedMeshes.push(mesh);
      yield;
    }
    for (const arrays of this.interiorArrays ?? []) {
      this.stagedMeshes.push(...createInteriorMeshes([arrays], this.surfaces, interiorMaterials));
      yield;
    }
    yield* stagedDrawPublication(this.paving, this.stagedMeshes, this.getDrawPreparation());
    this.paving.add(...this.stagedMeshes);
    this.stagedMeshes = null;
    this.interiorArrays = null;
    this.pavingArrays = null;
    this.pavingReady = true;
  }

  installPaving(shouldYield = () => false) {
    if (this.pavingReady) return true;
    if (this.job || !this.pavingArrays || !this.surfaces) return false;
    this.installJob ??= this.installation();
    for (;;) {
      const step = this.installJob.next();
      if (step.done) { this.installJob = null; return true; }
      if (step.value === WAIT_FOR_DRAW_PREPARATION) return false;
      if (shouldYield()) return false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.installJob?.return();
    this.job?.return();
    this.job = null;
    this.installJob = null;
    const materials = new Set();
    for (const child of new Set([...(this.stagedMeshes ?? []), ...this.paving.children])) {
      // A sprite's quad is three's own, shared by every sprite there is.
      if (!child.isSprite) child.geometry.dispose();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    }
    for (const material of materials) material.dispose();
    this.stagedMeshes = null;
    this.interiorArrays = null;
    this.pavingArrays = null;
    this.paving.clear();
    this.paving.removeFromParent();
    this.releaseSurfaces();
  }
}
