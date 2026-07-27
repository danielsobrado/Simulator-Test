import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { vec3 } from 'three/tsl';
import {
  collectObjectBoulderPlacements,
  objectBoulderSignatureForChunk,
  rockSignatureForChunk,
  rocksInfluencingChunk,
} from './chunkRockSignature.js';
import { isTreeImpostorBakeMode } from './impostorBakeMode.js';
import { StylizedBushView } from './StylizedBushView.js';
import { StylizedBuildQueue } from './StylizedBuildQueue.js';
import { StylizedChunkRevisionTracker } from './StylizedChunkRevisionTracker.js';
import { StylizedFlowerView } from './StylizedFlowerView.js';
import { StylizedGroundDetailView } from './StylizedGroundDetailView.js';
import {
  GRASS_BLADE_SEGMENTS,
  GRASS_FAR_BLADE_SEGMENTS,
  StylizedGrassSlot,
} from './StylizedGrassSlot.js';
import { GrassBladeProfilePool } from './GrassBladeProfilePool.js';
import { StylizedRockView } from './StylizedRockView.js';
import { StylizedSceneAssetCache } from './StylizedSceneAssetCache.js';
import { StylizedSkyView } from './StylizedSkyView.js';
import { StylizedTreeView } from './StylizedTreeView.js';
import { StylizedWaterSlot } from './StylizedWaterSlot.js';
import { StylizedVariantResidency } from './StylizedVariantResidency.js';
import { StylizedWildlifeView } from './StylizedWildlifeView.js';
import { RegionalCharacterField } from './RegionalCharacterField.js';
import { GrassTuning } from './GrassTuning.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';

export class StylizedSurfaceView {
  constructor({
    terrainView,
    objectMap,
    config,
    baseUrl = '/',
    biomeAssetPalette = null,
  }) {
    this.terrainView = terrainView;
    this.objectMap = objectMap;
    this.config = config;
    this.enabled = Boolean(config?.enabled);
    this.impostorBakeMode = isTreeImpostorBakeMode();
    this.sceneAssets = this.enabled
      ? new StylizedSceneAssetCache({ renderer: terrainView.renderer, baseUrl })
      : null;
    this.sharedScenePath = null;
    this.treeVariantPaths = [];
    this.rockVariantPaths = [];
    this.bushVariantPaths = [];
    this.groundDetailVariantPaths = [];
    this.aquaticVariantPaths = [];
    this.revisionTracker = this.enabled
      ? new StylizedChunkRevisionTracker({ worldStore: terrainView.worldStore })
      : null;
    this.regionalCharacterField = this.enabled
      ? new RegionalCharacterField({
        seed: resolveForestSeed(terrainView.worldStore),
        config: config.regionalPlacement,
      })
      : null;
    if (this.enabled && !this.impostorBakeMode) {
      for (const terrainSlot of terrainView.slots) terrainSlot.mesh.receiveShadow = true;
    }
    this.skyView = this.enabled && !this.impostorBakeMode && config.sky.enabled
      ? new StylizedSkyView({ terrainView, config })
      : null;
    const sunDirection = this.skyView?.sunDirection ?? vec3(0.35, 0.85, 0.25);
    this.rockView = this.enabled && !this.impostorBakeMode
      ? new StylizedRockView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        biomeAssetPalette,
        regionalCharacterField: this.regionalCharacterField,
      })
      : null;
    this.treeView = this.enabled
      ? new StylizedTreeView({
        terrainView,
        objectMap,
        config,
        revisionTracker: this.revisionTracker,
        baseUrl,
        biomeAssetPalette,
        regionalCharacterField: this.regionalCharacterField,
      })
      : null;
    this.flowerView = this.enabled && !this.impostorBakeMode
      ? new StylizedFlowerView({
        terrainView,
        config,
        baseUrl,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
      })
      : null;
    this.bushView = this.enabled && !this.impostorBakeMode && config.bushes?.enabled
      ? new StylizedBushView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
        biomeAssetPalette,
        regionalCharacterField: this.regionalCharacterField,
      })
      : null;
    this.groundDetailView = this.enabled
      && !this.impostorBakeMode
      && config.groundDetails?.enabled
      ? new StylizedGroundDetailView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        layerConfig: config.groundDetails,
        layerName: 'groundDetail',
        priorityChannel: 41,
        biomeAssetPalette,
        regionalCharacterField: this.regionalCharacterField,
        // Lets a wood's shaded interior grow different cover from its fringe.
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
      })
      : null;
    this.aquaticPlantView = this.enabled
      && !this.impostorBakeMode
      && config.aquaticPlants?.enabled
      ? new StylizedGroundDetailView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        layerConfig: config.aquaticPlants,
        layerName: 'aquaticPlant',
        priorityChannel: 43,
        biomeAssetPalette,
      })
      : null;
    this.wildlifeView = this.enabled
      && !this.impostorBakeMode
      && config.wildlife?.enabled
      ? new StylizedWildlifeView({
        terrainView,
        config: {
          ...config.wildlife,
          variants: config.assets.wildlifeVariants ?? [],
        },
        baseUrl,
        loader: this.sceneAssets.loader,
      })
      : null;
    this.biomeAssetPalette = biomeAssetPalette;
    this.ready = this.bootstrapLayers();
    // Impostor baking only ever looks at trees, which `ready` already covers.
    this.bakeRequest = this.ready.then(() => this.maybeHandleImpostorBake());
    this.bakeRequest.catch((error) => {
      console.error('Tree impostor export request failed.', error);
    });
    this.bladeProfiles = new GrassBladeProfilePool({
      config: config.grass,
      nearSegments: GRASS_BLADE_SEGMENTS,
      farSegments: GRASS_FAR_BLADE_SEGMENTS,
    });
    // `load` swallows its own failures into a fallback set, so this promise settles
    // either way — it exists to tell the Settings control when the list is final.
    this.bladeProfiles.ready = this.bladeProfiles.load(baseUrl);
    // One tuning object for the whole field: its uniforms are shared node objects,
    // so a slider write reaches every slot's material without touching geometry.
    this.grassTuning = new GrassTuning(config);
    this.slots = this.enabled && !this.impostorBakeMode
      ? terrainView.slots.map((terrainSlot) => new StylizedGrassSlot({
        terrainSlot,
        terrainView,
        objectMap,
        config,
        sunDirection,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
        bladeProfileProvider: () => this.bladeProfiles,
        tuning: this.grassTuning,
      }))
      : [];
    this.waterSlots = this.enabled && !this.impostorBakeMode && config.water?.enabled
      ? terrainView.slots.map((terrainSlot) => new StylizedWaterSlot({
        terrainSlot,
        terrainView,
        config,
      }))
      : [];
    for (const slot of this.slots) slot.mesh.receiveShadow = true;
    // Shared per-frame ceiling for the heavy scatter rebuilds. Rocks, trees and
    // bushes each flush in the same update, so once the frame has already spent
    // this much on rebuilds the remaining queues wait for the next one instead
    // of compounding into a visible stall.
    this.frameBudgetMs = config.streaming?.stylizedFrameBudgetMs ?? 6;
    this.frameStartedAt = 0;
    const shouldYield = () => (
      this.frameStartedAt > 0 && performance.now() - this.frameStartedAt > this.frameBudgetMs
    );
    this.grassBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.grassBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.flowerBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.flowerBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.treeBuildQueue = new StylizedBuildQueue({
      shouldYield,
      buildsPerFrame: config.streaming?.treeBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.rockBuildQueue = new StylizedBuildQueue({
      shouldYield,
      buildsPerFrame: config.streaming?.rockBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.bushBuildQueue = new StylizedBuildQueue({
      shouldYield,
      buildsPerFrame: config.streaming?.bushBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.detailBuildQueue = new StylizedBuildQueue({
      // These sparse authored rings are intentionally independent of the tree
      // manifest backlog. Sharing its cumulative yield gate could leave water
      // plants and ground accents at zero instances for many seconds while a
      // newly streamed forest window settles. Their measured cost is tracked
      // separately and remains capped to one layer rebuild per frame.
      buildsPerFrame: config.streaming?.detailBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.chunkWorldSize = terrainView.worldStore.chunkSize * terrainView.worldStore.tileSize;
    this.tileSize = terrainView.worldStore.tileSize;
    this.variantResidency = this.enabled && !this.impostorBakeMode
      ? this.createVariantResidency(config)
      : null;
  }

  /**
   * Everything the first frame genuinely needs.
   *
   * Trees are here rather than in the lazy set because the forest field they
   * build is what grass, bushes and ground details read to decide where a wood's
   * interior is — a deferred forest would make every other layer re-scatter the
   * moment it landed. The prop layers below are not load-bearing that way, so
   * they stream in from `variantResidency` as their biomes come into range.
   */
  async bootstrapLayers() {
    if (!this.enabled) return null;
    const needsScene = this.config.trees.enabled;
    try {
      let sharedScene = null;
      if (needsScene) {
        this.sharedScenePath = this.config.assets.scene;
        sharedScene = await this.sceneAssets.acquire(this.sharedScenePath);
      }
      const treeVariants = this.config.trees.enabled
        ? await Promise.all(
          (this.config.assets.treeVariants ?? []).map(async (definition) => {
            this.treeVariantPaths.push(definition.scene);
            return { definition, scene: await this.sceneAssets.acquire(definition.scene) };
          }),
        )
        : [];
      await Promise.all([
        this.treeView?.buildFromScene(sharedScene, treeVariants),
        this.flowerView?.ready,
      ].filter(Boolean));
      return null;
    } catch (error) {
      console.warn('Some stylized assets failed to load; remaining layers stay active.', error);
      return null;
    }
  }

  /**
   * The prop layers, streamed per biome instead of loaded up front.
   *
   * Each entry hands the residency a way to fetch a variant's scene and a way to
   * install it. Acquiring through the shared cache keeps the ref-count that
   * `dispose` releases, so the recorded paths are the ones actually taken.
   */
  createVariantResidency(config) {
    const layer = (id, paletteLayerId, view, definitions, paths, residentRadius) => ({
      id,
      paletteLayerId,
      definitions: definitions ?? [],
      residentRadius,
      acquire: async (scene) => {
        const loaded = await this.sceneAssets.acquire(scene);
        paths.push(scene);
        return loaded;
      },
      apply: (variants) => view.appendVariants(variants),
    });
    const streaming = config.streaming ?? {};
    return new StylizedVariantResidency({
      terrainView: this.terrainView,
      revisionTracker: this.revisionTracker,
      biomeAssetPalette: this.biomeAssetPalette,
      prefetchChunks: streaming.variantPrefetchChunks ?? 4,
      appliesPerFrame: streaming.variantAppliesPerFrame ?? 1,
      rescanIntervalMs: streaming.variantRescanIntervalMs ?? 500,
      layers: [
        this.rockView && layer(
          'rocks',
          'rocks',
          this.rockView,
          config.assets.rockVariants,
          this.rockVariantPaths,
          config.rocks?.residentRadius ?? 2,
        ),
        this.bushView && layer(
          'bushes',
          'bushes',
          this.bushView,
          config.assets.bushVariants,
          this.bushVariantPaths,
          config.bushes?.residentRadius ?? 2,
        ),
        this.groundDetailView && layer(
          'groundDetails',
          'groundDetails',
          this.groundDetailView,
          config.assets.groundDetailVariants,
          this.groundDetailVariantPaths,
          config.groundDetails?.residentRadius ?? 1,
        ),
        this.aquaticPlantView && layer(
          'aquaticPlants',
          'aquaticPlants',
          this.aquaticPlantView,
          config.assets.aquaticVariants,
          this.aquaticVariantPaths,
          config.aquaticPlants?.residentRadius ?? 1,
        ),
      ].filter(Boolean),
    });
  }

  async maybeHandleImpostorBake() {
    if (!this.impostorBakeMode || typeof window === 'undefined') return null;
    window.__treeImpostorBakeStatus = 'baking';
    try {
      const bundle = await this.exportImpostors();
      window.__treeImpostorBakeBundle = bundle;
      window.__treeImpostorBakeStatus = 'done';
      document.documentElement.dataset.impostorBake = 'done';
      return bundle;
    } catch (error) {
      window.__treeImpostorBakeStatus = 'failed';
      window.__treeImpostorBakeError = error instanceof Error ? error.message : String(error);
      document.documentElement.dataset.impostorBake = 'failed';
      throw error;
    }
  }

  get impostorReady() {
    return this.treeView?.impostorReady ?? Promise.resolve(null);
  }

  async exportImpostors() {
    if (!this.treeView) throw new Error('Tree rendering is disabled.');
    return this.treeView.exportImpostors();
  }

  updateRendererCounters() {
    const info = this.terrainView.renderer.info;
    if (!info) return;
    for (const [name, value] of [
      ['rendererDrawCalls', info.render?.calls],
      ['rendererTriangles', info.render?.triangles],
      ['rendererLines', info.render?.lines],
      ['rendererPoints', info.render?.points],
      ['rendererGeometries', info.memory?.geometries],
      ['rendererTextures', info.memory?.textures],
    ]) {
      if (Number.isFinite(value)) PerfCounters.set(name, value);
    }
  }

  setViewDistance({ skyRadius, fogDensity } = {}) {
    this.skyView?.setRadius(skyRadius);
    this.skyView?.setFogDensity(fogDensity);
  }

  update(timestamp, camera) {
    if (!this.enabled || this.impostorBakeMode) return;
    this.frameStartedAt = performance.now();
    this.updateRendererCounters();
    // Ahead of the layer updates: a variant installed here is picked up by this
    // frame's rebuild scheduling rather than waiting for the next one.
    this.variantResidency?.update(this.frameStartedAt);
    this.skyView?.update(timestamp, camera);
    this.wildlifeView?.update(timestamp, camera);
    this.rockView?.update(timestamp, camera);
    if (this.rockView?.pendingRebuild) {
      this.rockBuildQueue.enqueue(this.rockView.pendingRebuild);
    }
    this.rockBuildQueue.flush((job) => {
      void job;
      return this.rockView?.applyPendingRebuild() ?? false;
    });

    const rockPlacements = this.rockView?.getPlacements() ?? [];
    this.treeView?.update(timestamp, camera, this.rockView);
    if (this.treeView?.pendingLodRebuild) {
      this.treeBuildQueue.enqueue(this.treeView.pendingLodRebuild);
    }
    this.treeBuildQueue.flush((job) => {
      void job;
      return this.treeView?.applyPendingRebuild() ?? false;
    });
    // Bushes run after rocks and trees so boulder blockers and the forest field
    // are already current for this frame.
    this.bushView?.update(timestamp, camera, this.rockView);
    if (this.bushView?.pendingRebuild) {
      this.bushBuildQueue.enqueue(this.bushView.pendingRebuild);
    }
    this.bushBuildQueue.flush((job) => {
      void job;
      return this.bushView?.applyPendingRebuild() ?? false;
    });
    this.groundDetailView?.update();
    this.aquaticPlantView?.update();
    for (const view of [this.groundDetailView, this.aquaticPlantView]) {
      if (view?.pendingRebuild) this.detailBuildQueue.enqueue(view.pendingRebuild);
    }
    this.detailBuildQueue.flush((job) => {
      if (job.key.startsWith('groundDetail:')) {
        return this.groundDetailView?.applyPendingRebuild() ?? false;
      }
      return this.aquaticPlantView?.applyPendingRebuild() ?? false;
    });
    this.updateForestGroundTextures();
    this.flowerView?.update(timestamp);
    for (const slot of this.waterSlots) slot.update(timestamp);

    const focusChunk = this.terrainView.focusChunkKey ? this.terrainView.focusChunk : null;
    const rockRadius = this.config.rocks.radius;
    const rockFalloff = this.config.rocks.falloff;
    const objectBoulders = collectObjectBoulderPlacements({
      objectMap: this.objectMap,
      tileSize: this.tileSize,
      radius: rockRadius,
    });

    for (const slot of this.slots) {
      const descriptor = slot.terrainSlot.descriptor;
      if (!descriptor) {
        slot.update(timestamp, focusChunk, '', []);
        continue;
      }
      const localRocks = rocksInfluencingChunk({
        descriptor,
        rockPlacements,
        chunkWorldSize: this.chunkWorldSize,
        radius: rockRadius,
        falloff: rockFalloff,
      });
      const localObjectBoulders = rocksInfluencingChunk({
        descriptor,
        rockPlacements: objectBoulders,
        chunkWorldSize: this.chunkWorldSize,
        radius: rockRadius,
        falloff: rockFalloff,
      });
      const signature = [
        objectBoulderSignatureForChunk({
          objectMap: this.objectMap,
          objectPlacements: objectBoulders,
          descriptor,
          tileSize: this.tileSize,
          chunkWorldSize: this.chunkWorldSize,
          radius: rockRadius,
          falloff: rockFalloff,
        }),
        rockSignatureForChunk({
          descriptor,
          rockPlacements,
          chunkWorldSize: this.chunkWorldSize,
          radius: rockRadius,
          falloff: rockFalloff,
        }),
      ].join('|');
      slot.update(timestamp, focusChunk, signature, [
        ...localObjectBoulders,
        ...localRocks,
      ]);
      if (slot.pendingRebuild) {
        this.grassBuildQueue.enqueue({
          key: slot.pendingRebuild.key,
          slot,
        });
      }
    }

    for (const flowerSlot of this.flowerView?.slots ?? []) {
      if (flowerSlot.pendingRebuild) {
        this.flowerBuildQueue.enqueue({
          key: flowerSlot.pendingRebuild.key,
          slot: flowerSlot,
        });
      }
    }

    this.grassBuildQueue.flush((job) => job.slot.applyPendingRebuild());
    this.flowerBuildQueue.flush((job) => job.slot.applyPendingRebuild());
  }

  updateForestGroundTextures() {
    const field = this.treeView?.manifestStore?.forestField;
    if (!field) return;
    for (const terrainSlot of this.terrainView.slots) {
      const descriptor = terrainSlot.descriptor;
      if (!descriptor) continue;
      const key = `${descriptor.key}:${terrainSlot.pageRevision}:${field.signature}`;
      if (terrainSlot.forestFloorKey === key) continue;
      const size = terrainSlot.forestFloorSize;
      const half = this.chunkWorldSize * 0.5;
      for (let z = 0; z < size; z += 1) {
        const worldZ = descriptor.centerWorldZ + half
          - (z + 0.5) / size * this.chunkWorldSize;
        for (let x = 0; x < size; x += 1) {
          const worldX = descriptor.centerWorldX - half
            + (x + 0.5) / size * this.chunkWorldSize;
          const habitat = field.sample(worldX, worldZ);
          terrainSlot.forestFloorPixels[z * size + x] = Math.round(
            Math.min(1, habitat.patchCoverage * habitat.suitability * 1.35) * 255,
          );
        }
      }
      terrainSlot.forestFloorTexture.needsUpdate = true;
      terrainSlot.forestFloorKey = key;
      PerfCounters.inc('forestFloorTextureUploads');
      // Habitat sampling is deliberately budgeted to one low-resolution slot
      // per frame so chunk streaming cannot trigger an unbounded rebuild burst.
      return;
    }
  }

  dispose() {
    this.skyView?.dispose();
    this.variantResidency?.dispose();
    this.variantResidency = null;
    this.wildlifeView?.dispose();
    this.flowerView?.dispose();
    this.groundDetailView?.dispose();
    this.aquaticPlantView?.dispose();
    this.bushView?.dispose();
    this.treeView?.dispose();
    this.rockView?.dispose();
    if (this.sharedScenePath) {
      this.sceneAssets?.release(this.sharedScenePath);
      this.sharedScenePath = null;
    }
    for (const path of this.treeVariantPaths) this.sceneAssets?.release(path);
    this.treeVariantPaths.length = 0;
    for (const path of this.rockVariantPaths) this.sceneAssets?.release(path);
    this.rockVariantPaths.length = 0;
    for (const path of this.bushVariantPaths) this.sceneAssets?.release(path);
    this.bushVariantPaths.length = 0;
    for (const path of this.groundDetailVariantPaths) this.sceneAssets?.release(path);
    this.groundDetailVariantPaths.length = 0;
    for (const path of this.aquaticVariantPaths) this.sceneAssets?.release(path);
    this.aquaticVariantPaths.length = 0;
    this.sceneAssets?.dispose();
    this.sceneAssets = null;
    this.grassBuildQueue.clear();
    this.flowerBuildQueue.clear();
    this.treeBuildQueue.clear();
    this.rockBuildQueue.clear();
    this.bushBuildQueue.clear();
    this.detailBuildQueue.clear();
    for (const slot of this.waterSlots) slot.dispose();
    this.waterSlots.length = 0;
    for (const slot of this.slots) slot.dispose();
    this.slots.length = 0;
    this.revisionTracker?.dispose();
    this.revisionTracker = null;
  }
}
