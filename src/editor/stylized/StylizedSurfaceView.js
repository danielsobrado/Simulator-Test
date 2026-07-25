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
import { StylizedGrassSlot } from './StylizedGrassSlot.js';
import { StylizedRockView } from './StylizedRockView.js';
import { StylizedSceneAssetCache } from './StylizedSceneAssetCache.js';
import { StylizedSkyView } from './StylizedSkyView.js';
import { StylizedTreeView } from './StylizedTreeView.js';
import { StylizedWaterSlot } from './StylizedWaterSlot.js';

export class StylizedSurfaceView {
  constructor({ terrainView, objectMap, config, baseUrl = '/' }) {
    this.terrainView = terrainView;
    this.objectMap = objectMap;
    this.config = config;
    this.enabled = Boolean(config?.enabled);
    this.impostorBakeMode = isTreeImpostorBakeMode();
    this.sceneAssets = this.enabled
      ? new StylizedSceneAssetCache({ baseUrl })
      : null;
    this.sharedScenePath = null;
    this.revisionTracker = this.enabled
      ? new StylizedChunkRevisionTracker({ worldStore: terrainView.worldStore })
      : null;
    if (this.enabled && !this.impostorBakeMode) {
      for (const terrainSlot of terrainView.slots) terrainSlot.mesh.receiveShadow = true;
    }
    this.skyView = this.enabled && !this.impostorBakeMode && config.sky.enabled
      ? new StylizedSkyView({ terrainView, config })
      : null;
    const sunDirection = this.skyView?.sunDirection ?? vec3(0.35, 0.85, 0.25);
    this.rockView = this.enabled && !this.impostorBakeMode
      ? new StylizedRockView({ terrainView, config, revisionTracker: this.revisionTracker })
      : null;
    this.treeView = this.enabled
      ? new StylizedTreeView({
        terrainView,
        objectMap,
        config,
        revisionTracker: this.revisionTracker,
        baseUrl,
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
      })
      : null;
    this.ready = this.bootstrapLayers();
    this.bakeRequest = this.ready.then(() => this.maybeHandleImpostorBake());
    this.bakeRequest.catch((error) => {
      console.error('Tree impostor export request failed.', error);
    });
    this.slots = this.enabled && !this.impostorBakeMode
      ? terrainView.slots.map((terrainSlot) => new StylizedGrassSlot({
        terrainSlot,
        terrainView,
        objectMap,
        config,
        sunDirection,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
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
    this.grassBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.grassBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.flowerBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.flowerBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.treeBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.treeBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.rockBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.rockBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.bushBuildQueue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.bushBuildsPerFrame ?? 1,
      budgetMs: config.streaming?.heavyBuildBudgetMs ?? 3,
    });
    this.chunkWorldSize = terrainView.worldStore.chunkSize * terrainView.worldStore.tileSize;
    this.tileSize = terrainView.worldStore.tileSize;
  }

  async bootstrapLayers() {
    if (!this.enabled) return null;
    const needsScene = this.config.trees.enabled
      || (!this.impostorBakeMode && this.config.rocks.enabled);
    try {
      let sharedScene = null;
      if (needsScene) {
        this.sharedScenePath = this.config.assets.scene;
        sharedScene = await this.sceneAssets.acquire(this.sharedScenePath);
      }
      await Promise.all([
        this.rockView?.buildFromScene(sharedScene),
        this.treeView?.buildFromScene(sharedScene),
        this.flowerView?.ready,
      ].filter(Boolean));
      // Bush prototypes are procedural, so they need no scene — but they read the
      // forest field, which only exists once the tree manifest store is built.
      this.bushView?.build();
      return null;
    } catch (error) {
      console.warn('Some stylized assets failed to load; remaining layers stay active.', error);
      return null;
    }
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
    this.updateRendererCounters();
    this.skyView?.update(timestamp, camera);
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
    this.flowerView?.dispose();
    this.treeView?.dispose();
    this.rockView?.dispose();
    if (this.sharedScenePath) {
      this.sceneAssets?.release(this.sharedScenePath);
      this.sharedScenePath = null;
    }
    this.sceneAssets?.dispose();
    this.sceneAssets = null;
    this.grassBuildQueue.clear();
    this.flowerBuildQueue.clear();
    this.treeBuildQueue.clear();
    this.rockBuildQueue.clear();
    for (const slot of this.waterSlots) slot.dispose();
    this.waterSlots.length = 0;
    for (const slot of this.slots) slot.dispose();
    this.slots.length = 0;
    this.revisionTracker?.dispose();
    this.revisionTracker = null;
  }
}
