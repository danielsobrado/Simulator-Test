import * as THREE from 'three/webgpu';
import { materialColor } from 'three/tsl';
import { createInstancedRenderers, disposeInstancedRenderers } from '../../../stylized/lod/StylizedLodRuntime.js';
import { normalizeProceduralRecipe } from '../../../workshop/ProceduralAssetStore.js';
import { snowSettlementMaterial } from './SettlementSnow.js';
import { createWorkshopMaterials, hasPlasterWalls } from '../../../workshop/ProceduralWorkshopMaterials.js';
import { withWorkshopSurfaceOverrides } from '../../../workshop/ProceduralWorkshopSurfaceOverrides.js';
import { buildingRecipe } from '../SettlementBuildingCatalog.js';
import { isCraftedKind } from '../SettlementCraftedKinds.js';
import { isStoneKind } from '../SettlementStones.js';
import { lightSettlementMaterials } from './SettlementDusk.js';
import { gradeSettlementMaterial } from './SettlementGrade.js';
import { buildSettlementMeshData } from './SettlementMeshData.js';
import { SettlementMeshWorkerClient } from './SettlementMeshWorkerClient.js';
import { createSettlementStoneParts } from './SettlementStoneMesh.js';
import { createSettlementTrimParts } from './SettlementTrimMesh.js';
import { SettlementTierPublication } from './SettlementTierPublication.js';

/** Material families that still read as a house from across the town. */
const HOUSE_FAR_SLOTS = Object.freeze(['mortar', 'roof', 'recess']);
const MIN_CAPACITY = 8;
/** Variants the worker is asked for at once: enough to keep it busy, few enough to stay re-prioritisable. */
const WORKER_REQUESTS = 2;
/** Meshes whose shaders are being built in the background at once. */
const PRECOMPILE_AT_ONCE = 3;

function geometryFrom(packed) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, { array, itemSize, normalized }] of Object.entries(packed.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize, normalized));
  }
  if (packed.index) geometry.setIndex(new THREE.BufferAttribute(packed.index, 1));
  return geometry;
}

/**
 * The meshes a settlement style needs, built on demand and shared by every
 * placement: one instanced renderer set per pooled variant and tier.
 *
 * A variant's geometry is generated in a worker (SettlementMeshData); `advance`
 * then installs one finished variant a call — materials, instanced renderers,
 * the upload — and the view draws what exists so far. Without a worker the
 * generation happens here instead, one variant a call.
 *
 * Each variant has two tiers. A house's near mesh is already split by material
 * family, so its far tier is simply the plastered shell, the roof and the dark
 * openings. Masonry (walls, towers, keeps) is nearly all individual stones, so
 * it takes the workshop's own shell tier, which the mesh data carries.
 */
export class SettlementPrototypePool {
  constructor({ root, renderer, worker = new SettlementMeshWorkerClient(), getDrawPreparation = () => null }) {
    this.root = root;
    this.renderer = renderer;
    this.retirementVersion = 0;
    this.publications = new SettlementTierPublication(root, getDrawPreparation,
      meshes => { disposeInstancedRenderers(root, [meshes]); this.retirementVersion++; });
    /** New meshes, hidden: first waiting for their shaders, then for `reveal` to show them a few at a time. */
    this.uncompiled = [];
    this.compiling = 0;
    this.unrevealed = [];
    this.worker = worker;
    this.entries = new Map();
    this.queue = [];
    this.queueSortDirty = false;
    /** Generated, not yet installed: `{ entry, data }`. */
    this.built = [];
  }

  /**
   * Ask for a pooled variant, dressed in `surfaces` (the sets of the town
   * asking). `key` must already tell two dressings apart. Idempotent; the
   * nearest requests are built first.
   */
  request(key, { style, kind, variant, surfaces }, priority) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { key, style, kind, variant, surfaces, priority, state: 'queued', near: null, far: null, failed: null };
      this.entries.set(key, entry);
      this.queue.push(entry);
      this.queueSortDirty = true;
    } else if (priority < entry.priority) {
      entry.priority = priority;
      if (entry.state === 'queued') this.queueSortDirty = true;
    }
    return entry;
  }

  get(key) {
    const entry = this.entries.get(key);
    return entry?.state === 'ready' ? entry : null;
  }

  /** Variants asked for and not yet drawable. */
  get pending() {
    return this.queue.length + this.worker.inFlight + this.built.length;
  }

  isLive(entry) {
    return this.entries.get(entry.key) === entry;
  }

  fail(entry, error) {
    if (!this.isLive(entry)) return;
    // One recipe the generator refuses must not empty the town.
    entry.state = 'failed';
    entry.failed = error;
    console.warn(`Settlement variant ${entry.key} could not be generated.`, error);
  }

  /** The nearest queued entry `accept` takes, removed from the queue. */
  take(accept) {
    if (this.queueSortDirty) {
      this.queue.sort((left, right) => right.priority - left.priority);
      this.queueSortDirty = false;
    }
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (accept(this.queue[index])) return this.queue.splice(index, 1)[0];
    }
    return null;
  }

  /** Hands the worker the nearest variants it is not already generating. */
  dispatch() {
    while (this.worker.available && this.worker.inFlight < WORKER_REQUESTS) {
      const entry = this.take((candidate) => !isCraftedKind(candidate.kind));
      if (!entry) return;
      entry.state = 'building';
      this.worker.build(entry.style, entry.kind, entry.variant).then(
        (data) => { if (this.isLive(entry)) this.built.push({ entry, data }); },
        (error) => {
          // A worker that died takes nothing with it: the variant is generated here instead.
          if (!this.isLive(entry)) return;
          if (this.worker.available) this.fail(entry, error);
          else {
            entry.state = 'queued';
            this.queue.push(entry);
            this.queueSortDirty = true;
          }
        },
      );
    }
  }

  /**
   * One unit of main-thread work: install a variant the worker finished, or
   * generate one here (loose stone always; everything, if there is no worker).
   * Returns whether a variant became drawable.
   */
  advance() {
    this.dispatch();
    const finished = this.built.shift();
    if (finished) return this.complete(finished.entry, () => this.install(finished.entry, finished.data));
    const entry = this.take((candidate) => isCraftedKind(candidate.kind) || !this.worker.available);
    if (!entry) return false;
    return this.complete(entry, () => (isCraftedKind(entry.kind)
      ? this.installCrafted(entry)
      : this.install(entry, buildSettlementMeshData(entry.style, entry.kind, entry.variant).data)));
  }

  complete(entry, build) {
    if (!this.isLive(entry)) return false;
    try {
      build();
      entry.state = 'ready';
      return true;
    } catch (error) {
      this.fail(entry, error);
      return false;
    }
  }

  /** Materials and instanced renderers for generated mesh data. */
  install(entry, data) {
    const recipe = normalizeProceduralRecipe(buildingRecipe(entry.style, entry.kind, entry.variant));
    // The same call the generator makes, here so the materials are born on the
    // thread that owns the textures — dressed in the town's own surface sets.
    const materials = withWorkshopSurfaceOverrides(entry.surfaces, () => createWorkshopMaterials(recipe));
    lightSettlementMaterials(materials);
    const plastered = hasPlasterWalls(recipe);
    for (const [slot, material] of Object.entries(materials)) {
      gradeSettlementMaterial(material, slot, { plastered });
      snowSettlementMaterial(material, slot);
    }
    const part = (packed) => ({ slot: packed.slot, geometry: geometryFrom(packed), material: materials[packed.slot] ?? materials.stone });
    const near = data.near.map(part);
    let far = data.far ? data.far.map(part) : null;
    if (!far && data.archetype === 'house') {
      const kept = near.filter(({ slot }) => HOUSE_FAR_SLOTS.includes(slot));
      if (kept.length > 0 && kept.length < near.length) far = kept;
    }
    try {
      entry.near = this.createTier(entry, 'near', near, true);
      // Far buildings keep their shadows: a town without them floats.
      entry.far = far ? this.createTier(entry, 'far', far, true) : null;
    } finally {
      // The instanced renderers hold their own geometry copies. Materials and
      // textures stay: the renderers' materials share them.
      for (const { geometry } of new Set([...near, ...(far ?? [])])) geometry.dispose();
    }
  }

  /** Stone and trim are a few hundred triangles at most: one tier serves every distance. */
  installCrafted(entry) {
    const parts = isStoneKind(entry.kind) ? createSettlementStoneParts(entry) : createSettlementTrimParts(entry);
    try {
      entry.near = this.createTier(entry, 'near', parts, true);
    } finally {
      for (const { geometry } of parts) geometry.dispose();
    }
  }

  createTier(entry, tier, parts, castShadow) {
    const name = `settlement-${entry.key}-${tier}`;
    // The dithered instance material scales an explicit colour node by each
    // instance's variation; this one is the material's own colour, unchanged.
    for (const { material } of parts) material.colorNode ??= materialColor;
    // Every instance carries its town's snow (SettlementSnow) in `instanceBiomeLook.w`.
    const [meshes] = createInstancedRenderers({
      root: this.root,
      renderer: this.renderer,
      partsByPrototype: [parts.map((part) => ({ ...part, instanceBiomeLook: true }))],
      capacity: MIN_CAPACITY,
      name,
      castShadow,
    });
    const result = { meshes, capacity: MIN_CAPACITY, castShadow, name, materials: parts.map(({ material }) => material) };
    if (!this.publications.stage(result)) this.stage(meshes);
    return result;
  }

  /**
   * The instanced meshes of one tier, grown to hold `count` instances. Growing
   * re-creates the renderers from their own geometry, so a second town of the
   * same style costs a buffer, not a regeneration.
   */
  tier(entry, name, count) {
    const tier = entry[name];
    if (!tier || count <= tier.capacity) return tier;
    let capacity = tier.capacity;
    while (capacity < count) capacity *= 2;
    const sources = tier.meshes.map((mesh, index) => ({ geometry: mesh.geometry, material: tier.materials[index], instanceBiomeLook: true }));
    const [meshes] = createInstancedRenderers({
      root: this.root,
      renderer: this.renderer,
      partsByPrototype: [sources],
      capacity,
      reuseVertexArrays: true,
      name: tier.name,
      castShadow: tier.castShadow,
    });
    const result = { ...tier, meshes, capacity, publication: null };
    if (!this.publications.stage(result, tier)) {
      this.publications.release(tier);
      this.stage(meshes);
    }
    entry[name] = result;
    return result;
  }

  /**
   * Hold new meshes back from the frame they were made in. A mesh compiles its
   * shader pipeline the first time it is drawn, and a variant is nine or so new
   * materials: drawn together they cost one long frame, shown two a frame they
   * do not. The streamed draw-preparation queue is not used for this — it only
   * runs on spare frame time and keeps what it has not reached hidden, which on
   * a frame with none would hide a town for good — so the meshes are also
   * marked to be left out of it.
   */
  stage(meshes) {
    for (const mesh of meshes) {
      mesh.visible = false;
      mesh.userData.skipWarmup = true;
      this.uncompiled.push(mesh);
    }
  }

  /**
   * Ask the renderer to build a held-back mesh's shaders off the frame. The
   * mesh is shown to the compile pass alone: `compileAsync` gathers what is
   * visible when it is called and builds pipelines for it in the background.
   */
  precompile(mesh, camera, scene) {
    const ready = () => {
      this.compiling -= 1;
      if (mesh.parent) this.unrevealed.push(mesh);
    };
    this.compiling += 1;
    mesh.visible = true;
    let compiled;
    try {
      compiled = this.renderer.compileAsync(mesh, camera, scene);
    } catch {
      compiled = null;
    } finally {
      mesh.visible = false;
    }
    // A renderer that cannot precompile just shows the mesh and compiles it then.
    Promise.resolve(compiled).then(ready, ready);
  }

  /**
   * Show up to `count` of the meshes held back, and start compiling the next
   * few. Call once a frame.
   */
  reveal(count, camera = null, scene = null) {
    this.publications.advance(count);
    while (this.uncompiled.length > 0 && this.compiling < PRECOMPILE_AT_ONCE) {
      const mesh = this.uncompiled.shift();
      if (!mesh.parent) continue;
      if (camera && scene && typeof this.renderer?.compileAsync === 'function') this.precompile(mesh, camera, scene);
      else this.unrevealed.push(mesh);
    }
    for (let shown = 0; shown < count && this.unrevealed.length > 0;) {
      const mesh = this.unrevealed.shift();
      // A mesh grown or released since it was staged is no longer in the scene.
      if (!mesh.parent) continue;
      mesh.visible = true;
      shown += 1;
    }
  }

  release(entry) {
    for (const tier of [entry.near, entry.far]) if (tier) this.publications.release(tier);
    entry.near = null;
    entry.far = null;
    // Whoever still holds the entry must see it is gone, not a ready one with no meshes.
    entry.state = 'released';
    this.entries.delete(entry.key);
  }

  /** Drop every variant whose key `keep` rejects: the meshes of towns left behind. */
  prune(keep) {
    for (const entry of [...this.entries.values()]) if (!keep(entry.key)) this.release(entry);
    this.queue = this.queue.filter((entry) => this.isLive(entry));
    this.built = this.built.filter(({ entry }) => this.isLive(entry));
    this.unrevealed = this.unrevealed.filter((mesh) => mesh.parent);
    this.uncompiled = this.uncompiled.filter((mesh) => mesh.parent);
  }

  /** Forget every variant. The worker stays: the pool is reused across worlds. */
  clear() {
    this.prune(() => false);
  }

  dispose() {
    this.clear();
    this.worker.dispose();
  }
}
