import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList, normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import {
  attachRootCollar,
  extractPrototypeParts,
  findPrototypeRoots,
} from './StylizedTreePrototypes.js';
import { createStylizedLeafMaterial, createStylizedTrunkMaterial } from './StylizedTreeMaterials.js';
import {
  FOREST_GENERATED_SPECIES,
  FOREST_SPECIES_PALETTES,
  createForestSpeciesPrototypeGeometry,
  createSpeciesPrototypeIndex,
} from './forest/ForestSpeciesGeometry.js';
import { instanceCapacity } from './scatterMath.js';
import { TreeManifestStore } from './TreeManifestStore.js';
import { rebuildTreeLod } from './TreeLodAssembler.js';
import {
  buildChunkLodPlan,
  createInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
} from './lod/StylizedLodRuntime.js';
import {
  createCanopyClusterPart,
  createForestUnderstoryPrototypes,
  createTreeProxyPrototype,
} from './lod/StylizedProxyGeometry.js';
import {
  TreeImpostorAssetLoader,
  disposeTreeImpostorAtlases,
  downloadTreeImpostorBundle,
} from './impostor/TreeImpostorAssets.js';
import { TreeImpostorBaker } from './impostor/TreeImpostorBaker.js';
import { TreeImpostorBatch } from './impostor/TreeImpostorBatch.js';
import { createTreeImpostorSourceSignature } from './impostor/TreeImpostorManifest.js';

function firstMaterial(mesh, name) {
  return materialList(mesh).find((material) => material?.name === name) ?? materialList(mesh)[0];
}

function configureBarkTexture(texture, colorSpace) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function lodSettings(config) {
  const tree = config.lod?.tree ?? {};
  const meshRadius = tree.meshRadius ?? config.trees.residentRadius;
  const proxyRadius = Math.max(meshRadius, tree.proxyRadius ?? 3);
  const impostorRadius = Math.max(proxyRadius, tree.impostorRadius ?? 5);
  const clusterRadius = Math.max(impostorRadius, tree.clusterRadius ?? 8);
  return Object.freeze({
    enabled: config.lod?.enabled !== false,
    meshRadius,
    proxyRadius,
    impostorRadius,
    clusterRadius,
    transitionMs: tree.transitionMs ?? 320,
    thresholds: {
      nearPixels: tree.nearPixels ?? 32,
      proxyPixels: tree.proxyPixels ?? 8,
      impostorPixels: tree.impostorPixels ?? 2,
      clusterPixels: tree.clusterPixels ?? 0.45,
      hysteresisRatio: tree.hysteresisRatio ?? 0.15,
    },
  });
}

function disposePrototypeParts(prototypes) {
  for (const parts of prototypes) {
    for (const part of parts) {
      part.geometry?.dispose();
      part.material?.dispose();
    }
  }
  prototypes.length = 0;
}

export class StylizedTreeView {
  constructor({ terrainView, objectMap = null, config, revisionTracker, baseUrl = '/' }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.objectMap = objectMap;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.textureLoader = new THREE.TextureLoader();
    this.time = uniform(0);
    this.prototypes = [];
    this.prototypeSignature = null;
    this.speciesPrototypeIndex = null;
    this.proxyPrototypes = [];
    this.fallbackImpostorPrototypes = [];
    this.renderers = [];
    this.proxyRenderers = [];
    this.fallbackImpostorRenderers = [];
    this.clusterRenderers = [];
    this.understoryRenderers = [];
    this.clusterPrototypes = [];
    this.understoryPrototypes = [];
    this.impostorAtlases = [];
    this.impostorBatches = [];
    this.impostorVersion = 0;
    this.impostorReady = Promise.resolve(null);
    this.textures = [];
    this.manifestStore = null;
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.pendingLodRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    this.root.name = 'stylized-trees';
    terrainView.scene.add(this.root);
  }

  resolveUrl(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async loadBarkTextures() {
    const [color, ao, height] = await Promise.all([
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkColor)),
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkAo)),
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkHeight)),
    ]);
    configureBarkTexture(color, THREE.SRGBColorSpace);
    configureBarkTexture(ao, THREE.NoColorSpace);
    configureBarkTexture(height, THREE.NoColorSpace);
    this.textures.push(color, ao, height);
    return { color, ao, height };
  }

  async buildFromScene(scene) {
    if (!this.config.trees.enabled || !scene || this.disposed) return;
    const barkTextures = await this.loadBarkTextures();
    if (this.disposed) return;
    scene.updateMatrixWorld(true);
    const roots = scene.children.flatMap((child) => findPrototypeRoots(child, this.config));
    if (roots.length === 0) {
      throw new Error('No pine prototype contains both configured trunk and leaf materials.');
    }

    for (const root of roots) {
      const baked = extractPrototypeParts(root, this.config);
      if (!baked) continue;
      const parts = baked.map((part) => {
        const source = firstMaterial(
          part.source,
          part.kind === 'leaf' ? this.config.assets.leafMaterial : this.config.assets.trunkMaterial,
        );
        let leafMap = null;
        if (part.kind === 'leaf' && source?.map) {
          leafMap = source.map.clone();
          leafMap.needsUpdate = true;
          this.textures.push(leafMap);
        }
        const material = part.kind === 'leaf'
          ? createStylizedLeafMaterial({
            source,
            leafMap,
            bounds: {
              minY: part.geometry.boundingBox.min.y,
              maxY: part.geometry.boundingBox.max.y,
            },
            time: this.time,
            config: this.config,
          })
          : createStylizedTrunkMaterial({ textures: barkTextures, config: this.config });
        return {
          geometry: part.geometry,
          material,
          kind: part.kind,
          sourceMap: leafMap,
        };
      });
      attachRootCollar(parts);
      if (parts.length > 0) this.prototypes.push(parts);
    }
    if (this.prototypes.length === 0) {
      throw new Error('Pine prototype extraction produced no upright renderable parts.');
    }

    this.appendGeneratedSpeciesPrototypes(barkTextures);
    this.prototypeSignature = createTreeImpostorSourceSignature(this.prototypes, this.config);
    this.createRenderResources();
  }

  /**
   * The source GLB only contains conifers, so broadleaf species are generated.
   * They append after the GLB prototypes, which keeps existing baked impostor
   * indices aligned with the GLB range.
   */
  appendGeneratedSpeciesPrototypes(barkTextures) {
    const glbPrototypeCount = this.prototypes.length;
    const generated = createForestSpeciesPrototypeGeometry(FOREST_GENERATED_SPECIES);
    for (const prototype of generated) {
      const palette = FOREST_SPECIES_PALETTES[prototype.speciesId] ?? null;
      const parts = prototype.parts.map((part) => ({
        geometry: part.geometry,
        kind: part.kind,
        sourceMap: null,
        material: part.kind === 'leaf'
          ? createStylizedLeafMaterial({
            source: null,
            leafMap: null,
            bounds: {
              minY: part.geometry.boundingBox.min.y,
              maxY: part.geometry.boundingBox.max.y,
            },
            time: this.time,
            config: this.config,
            palette,
          })
          : createStylizedTrunkMaterial({
            textures: barkTextures,
            config: this.config,
            palette,
          }),
      }));
      attachRootCollar(parts);
      this.prototypes.push(parts);
    }
    this.speciesPrototypeIndex = createSpeciesPrototypeIndex({
      glbPrototypeCount,
      generatedSpeciesIds: generated.map((prototype) => prototype.speciesId),
    });
  }

  createRenderResources() {
    const settings = lodSettings(this.config);
    const acceptedPerChunk = Math.max(
      this.config.trees.perChunk,
      Math.trunc(this.config.trees.habitat?.maxAcceptedPerChunk) || 0,
    );
    const capacity = instanceCapacity({
      residentRadius: settings.impostorRadius + 1,
      perChunk: acceptedPerChunk,
    });
    const proxies = this.prototypes.map((parts) => createTreeProxyPrototype(parts, this.config));
    this.proxyPrototypes = proxies.map((prototype) => prototype.proxyParts);
    this.fallbackImpostorPrototypes = proxies.map((prototype) => prototype.fallbackImpostorParts);
    this.prototypeHeight = Math.max(...proxies.map((prototype) => prototype.height));
    this.prototypeWidth = Math.max(...proxies.map((prototype) => prototype.width));
    this.renderers = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.prototypes,
      capacity,
      name: 'stylized-pine-near',
      castShadow: true,
    });
    this.proxyRenderers = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.proxyPrototypes,
      capacity,
      name: 'stylized-pine-proxy',
      castShadow: false,
    });
    this.fallbackImpostorRenderers = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.fallbackImpostorPrototypes,
      capacity,
      name: 'stylized-pine-impostor-fallback',
      castShadow: false,
    });
    this.clusterPrototypes = [[createCanopyClusterPart(this.config)]];
    this.clusterRenderers = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.clusterPrototypes,
      capacity: instanceCapacity({
        residentRadius: settings.clusterRadius + 1,
        perChunk: acceptedPerChunk,
      }),
      name: 'stylized-canopy-cluster',
      castShadow: false,
    });
    this.understoryPrototypes = createForestUnderstoryPrototypes(this.config);
    this.understoryRenderers = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.understoryPrototypes,
      capacity,
      name: 'stylized-forest-understory',
      castShadow: false,
    });
    this.manifestStore = new TreeManifestStore({
      terrainView: this.terrainView,
      config: this.config,
      revisionTracker: this.revisionTracker,
      prototypeCount: this.prototypes.length,
      prototypeIndexBySpecies: this.speciesPrototypeIndex ?? null,
      objectMap: this.objectMap,
      onBuilt: () => {
        // Newly built manifests need a follow-up LOD write; the update loop
        // detects `manifestFlush.built > 0` and enqueues one budgeted rebuild.
      },
    });
    this.impostorReady = this.initializeImpostors(capacity).catch((error) => {
      console.warn('Tree impostor initialization failed; cross-card fallback remains active.', error);
      return null;
    });
  }

  async initializeImpostors(capacity) {
    const settings = this.config.lod?.impostor;
    if (!settings?.enabled || this.disposed) return null;
    const forceBake = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('bakeImpostors') === '1';
    const loader = new TreeImpostorAssetLoader({
      baseUrl: this.baseUrl,
      expectedPrototypeCount: this.prototypes.length,
      expectedSourceSignature: this.prototypeSignature,
    });
    let atlases = forceBake ? null : await loader.load(settings.manifest).catch((error) => {
      console.warn('Tree impostor assets could not be loaded; runtime bake will be attempted.', error);
      return null;
    });
    if (!atlases && settings.runtimeBake !== false) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      atlases = await new TreeImpostorBaker({
        renderer: this.terrainView.renderer,
        config: this.config,
      }).bake(this.prototypes);
    }
    if (!atlases) return null;
    if (this.disposed) {
      disposeTreeImpostorAtlases(atlases);
      return null;
    }

    this.impostorAtlases = [...atlases];
    this.impostorBatches = this.impostorAtlases.map((atlas) => new TreeImpostorBatch({
      renderer: this.terrainView.renderer,
      scene: this.terrainView.scene,
      atlas,
      capacity,
      name: `stylized-pine-impostor-${atlas.prototypeIndex}`,
      gpuCulling: this.config.lod?.gpuCulling?.enabled !== false,
    }));
    this.impostorVersion += 1;
    this.lastUpdateKey = null;
    PerfCounters.set('treeImpostorAtlasBytes', this.impostorAtlases.reduce((total, atlas) => (
      total + atlas.columns * atlas.rows * atlas.tileSize * atlas.tileSize * 8 * 4 / 3
    ), 0));
    return this.impostorAtlases;
  }

  update(timestamp, camera, rockSource = null) {
    this.time.value = timestamp / 1000;
    if (this.disposed || !this.manifestStore || !this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.root.position.set(-origin.x, 0, -origin.z);
    const settings = lodSettings(this.config);
    const radius = settings.enabled ? settings.clusterRadius : this.config.trees.residentRadius;
    const viewportHeight = this.terrainView.renderer.domElement.clientHeight
      || this.terrainView.renderer.domElement.height
      || 1;
    const plan = settings.enabled
      ? buildChunkLodPlan({
        focus,
        radius: radius + 1,
        chunkWorldSize: this.terrainView.chunkWorldSize,
        floatingOrigin: this.terrainView.floatingOrigin,
        camera,
        viewportHeight,
        objectHeight: this.prototypeHeight,
        thresholds: settings.thresholds,
        radii: settings,
        transitionStates: this.chunkLodStates,
        timestamp,
        transitionMs: settings.transitionMs,
        positionForChunk: (chunkX, chunkZ) => this.manifestStore.lodAnchor(chunkX, chunkZ),
      })
      : {
        entries: this.createNearOnlyPlan(focus, radius),
        signature: `near:${focus.chunkX}:${focus.chunkZ}:${radius}`,
      };
    pruneStateMap(this.chunkLodStates, plan.entries);
    const revision = this.revisionTracker.windowSignature(focus, radius + 1, 1);
    // Per-chunk rock blockers live in TreeManifestStore — do not use a global
    // rock signature that would rebuild every tree band when far rocks stream.
    const key = `${focus.chunkX}:${focus.chunkZ}:${revision}:${plan.signature}:${this.impostorVersion}`;

    for (const entry of plan.entries) {
      const visible = entry.representations.some((value) => (
        value.band !== 'culled' && value.fade > 0
      ));
      if (!visible) continue;
      if (!this.manifestStore.get(entry.chunkX, entry.chunkZ, rockSource)) {
        this.manifestStore.schedule(entry.chunkX, entry.chunkZ, rockSource);
      }
    }
    this.manifestStore.setActive(new Set(
      plan.entries.map((entry) => `${entry.chunkX}:${entry.chunkZ}`),
    ));
    const manifestFlush = this.manifestStore.flush();

    if (key !== this.lastUpdateKey || manifestFlush.built > 0) {
      // Defer heavy instance writes to the budgeted tree build queue.
      this.pendingLodRebuild = {
        key: `tree-lod:${key}`,
        updateKey: key,
        plan,
        rockSource,
      };
    }

    const submitted = { cpu: 0, gpu: 0 };
    const known = { cpu: true, gpu: true };
    for (const batch of this.impostorBatches) {
      const result = batch.update(camera, origin, timestamp);
      if (Number.isFinite(result.submitted)) {
        submitted[result.mode] += result.submitted;
      } else {
        known[result.mode] = false;
      }
    }
    for (const mode of ['cpu', 'gpu']) {
      PerfCounters.set(`treeImpostorSubmittedKnown.${mode}`, known[mode] ? 1 : 0);
      if (known[mode]) PerfCounters.set(`treeImpostorSubmitted.${mode}`, submitted[mode]);
    }
  }

  applyPendingRebuild() {
    const job = this.pendingLodRebuild;
    if (!job) return false;
    this.pendingLodRebuild = null;
    this.lastUpdateKey = job.updateKey;
    rebuildTreeLod({
      plan: job.plan,
      rockSource: job.rockSource,
      manifestStore: this.manifestStore,
      prototypeCount: this.prototypes.length,
      prototypeWidth: this.prototypeWidth,
      prototypeHeight: this.prototypeHeight,
      impostorAtlases: this.impostorAtlases,
      impostorBatches: this.impostorBatches,
      renderers: this.renderers,
      proxyRenderers: this.proxyRenderers,
      fallbackImpostorRenderers: this.fallbackImpostorRenderers,
      clusterRenderers: this.clusterRenderers,
      understoryRenderers: this.understoryRenderers,
    });
    this.manifestStore.flush();
    return true;
  }

  createNearOnlyPlan(focus, radius) {
    const entries = [];
    for (let z = focus.chunkZ - radius; z <= focus.chunkZ + radius; z += 1) {
      for (let x = focus.chunkX - radius; x <= focus.chunkX + radius; x += 1) {
        entries.push({
          chunkX: x,
          chunkZ: z,
          chunkDistance: Math.max(Math.abs(x - focus.chunkX), Math.abs(z - focus.chunkZ)),
          representations: [{ band: 'near', fade: 1 }],
        });
      }
    }
    return entries;
  }

  async exportImpostors() {
    await this.impostorReady;
    if (this.impostorAtlases.length === 0) {
      throw new Error('No runtime-baked tree impostors are available to export.');
    }
    return downloadTreeImpostorBundle(this.impostorAtlases, this.prototypeSignature);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.renderers);
    disposeInstancedRenderers(this.root, this.proxyRenderers);
    disposeInstancedRenderers(this.root, this.fallbackImpostorRenderers);
    disposeInstancedRenderers(this.root, this.clusterRenderers);
    disposeInstancedRenderers(this.root, this.understoryRenderers);
    for (const batch of this.impostorBatches) batch.dispose();
    disposeTreeImpostorAtlases(this.impostorAtlases);
    disposePrototypeParts(this.prototypes);
    disposePrototypeParts(this.proxyPrototypes);
    disposePrototypeParts(this.fallbackImpostorPrototypes);
    disposePrototypeParts(this.clusterPrototypes);
    disposePrototypeParts(this.understoryPrototypes);
    this.textures.forEach((texture) => texture.dispose());
    this.manifestStore?.dispose();
    this.chunkLodStates.clear();
  }
}
