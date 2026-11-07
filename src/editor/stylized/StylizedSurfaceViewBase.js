import { AlpineRockView } from './alpine/AlpineRockView.js';
import { IcebergView } from './ice/IcebergView.js';
import { SharedWaterMaterials } from './SharedWaterMaterials.js';
import { WaterObstacleUpdates } from './WaterObstacleUpdates.js';
import { WaterReflectionController } from '../../render/reflections/WaterReflectionController.js';
import { SceneryWorkScheduler, createSceneryConsumers } from './SceneryWorkScheduler.js';
import { sceneryPreparationStatus } from './SceneryPreparationStatus.js';
import { getTerrainMaterialBakeGpuState } from '../materials/TerrainMaterialBakeGpu.js';
import { PreparedPlacementStore } from '../world/PreparedPlacementStore.js';
import { placementPreparationRadius } from '../world/PlacementPreparationWindow.js';
import { syncViewRebuildQueue } from './ViewRebuildQueue.js';
import {
  PerfCounters,
  resetWaterChunkGauges,
} from '../performance/qa/PerfCounters.js';
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
import { createForestDebrisPrototypes } from './forest/forestDebrisPrototypes.js';
import { createShoreLifePrototypes } from './shoreLifePrototypes.js';
import { createAquaticFloraPrototypes } from './aquaticFloraPrototypes.js';
import { advancePlantSway } from './plantSway.js';
import { contactShadeRadius, paintContactShade, resolveContactShade } from './contactShade.js';
import {
  FOREST_FLOOR_CANOPY_SAMPLES,
  writeForestFloorCanopy,
  writeForestFloorLitter,
} from './forestFloorTexture.js';
import { forestFloorDensity } from './forest/ForestFloor.js';
import { bilinearSample } from './forest/bilinearGrid.js';
import { CANOPY_FLOOR_PATCH_SALT, canopyFloorCover } from '../world/GrassPatchiness.js';
import { isLandStreamingSuspended } from '../water/underwaterState.js';
import {
  GRASS_BLADE_SEGMENTS,
  GRASS_FAR_BLADE_SEGMENTS,
  StylizedGrassSlot,
} from './StylizedGrassSlot.js';
import { GrassBladeProfilePool } from './GrassBladeProfilePool.js';
import { StylizedRockView } from './StylizedRockView.js';
import { syncFoliageLight } from './forest/foliageLight.js';
import { StylizedSceneAssetCache } from './StylizedSceneAssetCache.js';
import { StylizedSkyView } from './StylizedSkyView.js';
import { StylizedTreeView } from './StylizedTreeView.js';
import { StylizedWaterSlot } from './StylizedWaterSlot.js';
import { StylizedVariantResidency } from './StylizedVariantResidency.js';
import { installVariants } from './VariantInstallation.js';
import { StylizedWildlifeView } from './StylizedWildlifeView.js';
import { RegionalCharacterField } from './RegionalCharacterField.js';
import { GrassTuning } from './GrassTuning.js';
import { MeadowGrassField } from './meadow/MeadowGrassField.js';
import { resolveMeadowGrassConfig } from './meadow/meadowGrassConfig.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';

export class StylizedSurfaceView {
  constructor({
    terrainView,
    objectMap,
    config,
    baseUrl = '/',
    biomeAssetPalette = null,
    snowBand = null,
  }) {
    this.terrainView = terrainView;
    this.objectMap = objectMap;
    this.config = config;
    // The dark patch where trunks and boulders meet the ground, resolved once.
    this.contactShadeSettings = resolveContactShade(config);
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
    this.tropicalKitVariantPaths = [];
    this.revisionTracker = this.enabled
      ? new StylizedChunkRevisionTracker({ worldStore: terrainView.worldStore })
      : null;
    this.preparedPlacement = this.enabled && terrainView.worldStore.chunkWorker
      ? new PreparedPlacementStore({ worldStore: terrainView.worldStore, revisionTracker: this.revisionTracker, config })
      : null;
    terrainView.preparedPlacement = this.preparedPlacement;
    terrainView.stylizedSurface = this;
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
    this.icebergView = this.enabled && !this.impostorBakeMode && this.skyView && config.icebergs?.enabled !== false
      ? new IcebergView({
        scene: terrainView.scene,
        worldStore: terrainView.worldStore,
        floatingOrigin: terrainView.floatingOrigin,
        seaLevel: terrainView.worldStore.generator?.seaLevel ?? 0,
        sunDirection: this.skyView.sunDirectionValue,
        snowGroundByTile: config.biomeLooks?.snow.ground ?? [],
        getDrawPreparation: () => terrainView.drawPreparation,
      })
      : null;
    this.alpineRockView = this.enabled && !this.impostorBakeMode && this.skyView
      ? new AlpineRockView({
        scene: terrainView.scene,
        terrainView,
        snowGroundByTile: config.biomeLooks?.snow.ground ?? [],
        cragsByTile: config.biomeLooks?.crags ?? [],
        seaLevel: terrainView.worldStore.generator?.seaLevel ?? 0,
      })
      : null;
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
        // The snow band lives in the world's configuration, which this config
        // cannot see, so the composition root hands it down: bark has to whiten at
        // the altitude the ground under it does.
        snowBand,
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
    // grass-test's tropical kit (its coastal-jungle understory): jungle grasses,
    // groundcover and elephant ear, streamed per biome through residency like
    // the other authored layers, on a budget of its own (§11 item 4).
    this.tropicalKitView = this.enabled
      && !this.impostorBakeMode
      && config.tropicalKit?.enabled
      ? new StylizedGroundDetailView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        layerConfig: config.tropicalKit,
        layerName: 'tropicalPlant',
        paletteLayerId: 'tropicalKit',
        priorityChannel: 49,
        biomeAssetPalette,
        regionalCharacterField: this.regionalCharacterField,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
      })
      : null;
    // Water plants are procedural too: seagrass, kelp and the algae ride the same
    // layer as the authored aquatic variants, on the same water rule, but they need
    // no scene to load so they install here.
    if (this.aquaticPlantView) {
      this.aquaticPlantView.appendProceduralPrototypes(
        createAquaticFloraPrototypes(config.aquaticPlants, config.water),
      );
    }
    // Shore life is procedural, so unlike the authored layers it installs here and
    // now: there is no scene to fetch and nothing to stream in through residency.
    this.shoreLifeView = this.enabled
      && !this.impostorBakeMode
      && config.shoreLife?.enabled
      ? new StylizedGroundDetailView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        layerConfig: config.shoreLife,
        layerName: 'shoreLife',
        priorityChannel: 47,
      })
      : null;
    if (this.shoreLifeView) {
      this.shoreLifeView.appendProceduralPrototypes(
        createShoreLifePrototypes(config.shoreLife),
      );
    }
    this.forestDebrisView = this.enabled
      && !this.impostorBakeMode
      && config.forestDebris?.enabled
      ? new StylizedGroundDetailView({
        terrainView,
        config,
        revisionTracker: this.revisionTracker,
        layerConfig: config.forestDebris,
        layerName: 'forestDebris',
        priorityChannel: 46,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
      })
      : null;
    this.forestDebrisView?.appendProceduralPrototypes(createForestDebrisPrototypes(config.forestDebris));
    // Every per-chunk detail layer, authored or procedural, is rebuilt and disposed
    // the same way; the array is what keeps a new layer from having to be added to
    // three separate places.
    this.detailViews = [
      this.groundDetailView,
      this.aquaticPlantView,
      this.shoreLifeView,
      this.forestDebrisView,
      this.tropicalKitView,
    ].filter(Boolean);
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
    // `grass.system: meadow` draws grass-test's meadow (meadow/MeadowGrassField.js)
    // in place of the per-chunk clump slots; `clumps` keeps the slots for A/B.
    const meadowSettings = config.grass?.system === 'meadow' ? resolveMeadowGrassConfig(config.grass.meadow) : null;
    this.meadowGrass = this.enabled && !this.impostorBakeMode && meadowSettings
      ? new MeadowGrassField({
        scene: terrainView.scene,
        terrainView,
        config,
        settings: meadowSettings,
        tuning: this.grassTuning,
        sunDirection,
        forestFieldProvider: () => this.treeView?.manifestStore?.forestField ?? null,
        skyView: this.skyView,
        baseUrl,
        rockPlacementsProvider: () => this.rockView?.getPlacements() ?? [],
        treePlacementsProvider: (chunkX, chunkZ) => this.treeView?.manifestStore?.peek(chunkX, chunkZ) ?? null,
      })
      : null;
    this.slots = this.enabled && !this.impostorBakeMode && !this.meadowGrass
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
    this.reflections = this.enabled && !this.impostorBakeMode && config.enhancements?.waterReflections.enabled
      ? new WaterReflectionController(terrainView, config.enhancements.waterReflections) : null;
    this.sharedWaterMaterials = new SharedWaterMaterials(this.reflections);
    this.reflectionPrepared = null;
    terrainView.beforeMainRender = camera => {
      this.skyView?.cascades?.prepare(camera);
      const now = performance.now();
      const prepared = this.reflections?.prepare(camera, this) ?? null;
      this.reflectionPrepared = prepared;
      this.reflectionReservation?.cancel();
      this.reflectionReservation = null;
      const captureTurn = this.reflections?.captureSchedule.nextFrame() ?? false;
      if (
        prepared
        && captureTurn
        && now >= this.reflections.nextCapture
        && this.reserveDeferredWork
      ) {
        this.reflectionReservation = this.reserveDeferredWork(this.reflections.captureBudgetMs);
      }
      // Standalone views have no shared scheduler; preserve their direct capture path.
      this.reflectionBudgetReserved = Boolean(
        prepared
        && !this.reserveDeferredWork
        && !this.shouldYieldWork?.()
      );
    };
    terrainView.afterMainRender = camera => {
      const prepared = this.reflectionPrepared;
      this.reflectionPrepared = null;
      const capture = () => this.reflections.update(
        camera,
        this,
        performance.now(),
        { budgetReserved: true, prepared },
      );
      this.reflectionReservation?.run(capture);
      this.reflectionReservation = null;
      if (this.reflectionBudgetReserved) this.runDeferredWork ? this.runDeferredWork(capture) : capture();
      this.reflectionBudgetReserved = false;
    };
    this.waterSlots = this.enabled && !this.impostorBakeMode && config.water?.enabled
      ? terrainView.slots.map((terrainSlot) => new StylizedWaterSlot({
        terrainSlot,
        terrainView,
        config,
        sunDirection,
        sharedMaterials: this.sharedWaterMaterials,
      }))
      : [];
    this.waterObstacleUpdates = new WaterObstacleUpdates(this);
    for (const slot of this.slots) slot.mesh.receiveShadow = true;
    // Shared per-frame ceiling for the heavy scatter rebuilds. Rocks, trees and
    // bushes each flush in the same update, so once the frame has already spent
    // this much on rebuilds the remaining queues wait for the next one instead
    // of compounding into a visible stall.
    this.frameBudgetMs = config.streaming?.stylizedFrameBudgetMs ?? 6;
    this.frameStartedAt = 0;
    this.lastBeginFrameTimestamp = null;
    this.grassRockInputs = new WeakMap();
    const shouldYield = () => (
      this.frameStartedAt > 0 && performance.now() - this.frameStartedAt > (this.workBudgetMs ?? this.frameBudgetMs)
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
    this.sceneryScheduler = new SceneryWorkScheduler();
    this.syncSceneryQueue = syncViewRebuildQueue;
    this.sceneryConsumers = createSceneryConsumers(this);
    this.preparationVariants = () => this.variantResidency?.getPreparationStatus().pending ?? 0;
    this.chunkWorldSize = terrainView.worldStore.chunkSize * terrainView.worldStore.tileSize;
    this.tileSize = terrainView.worldStore.tileSize;
    this.variantResidency = this.enabled && !this.impostorBakeMode
      ? this.createVariantResidency(config)
      : null;
    if (this.rockView) this.rockView.assetReadiness = () => this.variantResidency?.getLayerState('rocks');
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
      apply: variants => installVariants(view, variants),
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
        this.tropicalKitView && layer(
          'tropicalKit',
          'tropicalKit',
          this.tropicalKitView,
          config.assets.tropicalKitVariants,
          this.tropicalKitVariantPaths,
          config.tropicalKit?.residentRadius ?? 1,
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
    const renderer = this.terrainView.renderer;
    const info = renderer.info;
    if (!info) return;
    PerfCounters.set('rendererWebGPUBackend', renderer.backend?.isWebGPUBackend ? 1 : 0);
    PerfCounters.set('rendererWebGLBackend', renderer.backend?.isWebGLBackend ? 1 : 0);
    for (const [name, value] of [
      ['rendererDrawCalls', info.render?.drawCalls ?? info.render?.calls],
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

  /**
   * Allocate and upload the fixed slot texture set while the boot overlay is
   * still visible. Terrain streaming reuses these slots; allowing the first
   * chunk boundary to initialize them made GPU texture creation land directly
   * in a movement frame.
   */
  prewarmStreamingResources(renderer = this.terrainView.renderer) {
    // Seven fixed shapes belong to loading-screen geometry and shader warmup.
    this.alpineRockView?.ensureMeshes();
    this.icebergView?.ensureMeshes();
    const textures = new Set();
    for (const terrainSlot of this.terrainView.slots) {
      for (const texture of [
        terrainSlot.tileTexture,
        terrainSlot.surfaceMaskTexture,
        terrainSlot.heightTexture,
        terrainSlot.forestFloorTexture,
        ...Object.values(getTerrainMaterialBakeGpuState(terrainSlot.mesh)?.textures ?? {}),
      ]) {
        if (texture) textures.add(texture);
      }
    }
    for (const waterSlot of this.waterSlots) {
      textures.add(waterSlot.waterFieldTexture);
      textures.add(waterSlot.waterFlowTexture);
      textures.add(waterSlot.waterAppearanceTexture);
      textures.add(waterSlot.waterObstacleTexture);
    }
    for (const grassSlot of this.slots) {
      grassSlot.pinResources();
      textures.add(grassSlot.trampleTexture);
    }
    for (const texture of textures) renderer.initTexture(texture);
    PerfCounters.set('streamingTexturesPrewarmed', textures.size);
    PerfCounters.set('grassSlotsPinned', this.slots.length);
    return textures.size;
  }

  /**
   * Temporarily submit one refractive water mesh during boot. Compilation alone
   * does not allocate Three's viewport colour/depth targets; without this warm
   * render, the first shoreline frame creates them while the player is moving.
   */
  beginWaterRefractionPrewarm() {
    if (this.waterSlots.length === 0) return null;
    // The initial resident window is already exercised during startup. Warm
    // the unused pool slots that streaming will claim at the first boundary;
    // warming every slot multiplied viewport-node resources with no additional
    // hitch benefit.
    const slots = this.waterSlots.filter((slot) => !slot.terrainSlot.descriptor);
    if (slots.length === 0) slots.push(this.waterSlots[0]);
    const previous = slots.map((slot) => ({
      slot,
      material: slot.mesh.material,
      visible: slot.mesh.visible,
    }));
    for (const slot of slots) {
      slot.mesh.material = slot.ensureRefractiveMaterial();
      slot.mesh.visible = true;
      slot.refractionPrewarmed = true;
    }
    return () => {
      for (const state of previous) {
        state.slot.mesh.material = state.material;
        state.slot.mesh.visible = state.visible;
      }
    };
  }

  prewarmOneDistantWaterSlot() {
    let candidate = null;
    let candidateDistance = Number.POSITIVE_INFINITY;
    const focus = this.terrainView.focusChunkKey ? this.terrainView.focusChunk : null;
    if (!focus) return false;
    for (const slot of this.waterSlots) {
      const descriptor = slot.terrainSlot.descriptor;
      if (
        !descriptor
        || !slot.hasWaterCoverage
        || slot.refractionPrewarmed
        || slot.isWithinRefractionRange()
      ) {
        continue;
      }
      const distance = Math.max(
        Math.abs(descriptor.chunkX - focus.chunkX),
        Math.abs(descriptor.chunkZ - focus.chunkZ),
      );
      if (distance < candidateDistance) {
        candidate = slot;
        candidateDistance = distance;
      }
    }
    if (!candidate) return false;
    // Submit one still-distant wet chunk with the refractive variant for a
    // single frame. Its material/texture bindings are then resident before the
    // chunk reaches the near-water band, spreading N cold initializations over
    // N ordinary frames instead of one shoreline hitch.
    const material = candidate.ensureRefractiveMaterial();
    if (this.terrainView.drawPreparation) {
      this.terrainView.drawPreparation.requestMaterial(candidate.mesh, material);
    } else {
      candidate.mesh.material = material;
    }
    candidate.refractionPrewarmed = true;
    PerfCounters.inc('waterRefractionSlotsPrewarmed');
    return true;
  }

  /**
   * The floating origin moved by (dx, dz). Layers that keep render-space state move
   * it with the world here rather than treating a re-centre as movement.
   */
  shiftOrigin(dx, dz) {
    this.meadowGrass?.shiftOrigin(dx, dz);
  }

  getPreparationStatus() {
    return sceneryPreparationStatus(this);
  }

  /** Share one preparation allowance between player collision and rendering. */
  reserveReflectionCapture(camera, now) {
    this.reflectionReservation?.cancel();
    this.reflectionReservation = null;
    if (this.reflections?.prepare(camera, this) && now >= this.reflections.nextCapture) {
      this.reflectionReservation = this.reserveDeferredWork?.(this.reflections.captureBudgetMs) ?? null;
    }
  }

  beginFrame(timestamp) {
    if (this.lastBeginFrameTimestamp === timestamp) return;
    this.lastBeginFrameTimestamp = timestamp;
    this.meadowGrass?.beginFrame?.(timestamp);
    const focus = this.terrainView?.focusChunk;
    if (focus && this.preparedPlacement) {
      const radius = placementPreparationRadius(this.config, this.terrainView.loadRadius ?? 0);
      this.preparedPlacement.setWindow(focus.chunkX, focus.chunkZ, radius);
      this.rockView?.manifestStore.setWindow(focus.chunkX, focus.chunkZ, radius - 2);
      this.treeView?.manifestStore?.setWindow(focus.chunkX, focus.chunkZ, radius - 2);
    }
    if (this.earlySceneryTimestamp !== timestamp && !isLandStreamingSuspended()) {
      this.earlySceneryTimestamp = timestamp;
      this.sceneryScheduler.beginFrame(this.sceneryConsumers, this.shouldYieldWork);
    }
    this.preparedPlacement?.flush(this.shouldYieldWork);
    this.rockView?.beginFrame(timestamp);

  }

  /**
   * @param {number} timestamp
   * @param {object} camera
   * @param {{ x: number, y: number, z: number } | null} [body] the player's feet in
   *   render space, for the layers that react to the body standing in them
   */
  update(timestamp, camera, body = null) {
    this.beginFrame(timestamp);
    if (!this.enabled || this.impostorBakeMode) return;
    this.frameStartedAt = performance.now();
    // These are gauges, not lifetime counters. Reset them before the slot pass
    // so reports describe current water residency instead of accumulating one
    // increment per slot on every frame.
    resetWaterChunkGauges();
    // Ahead of the layer updates: a variant installed here is picked up by this
    // frame's rebuild scheduling rather than waiting for the next one.
    const updateVariants = () => this.variantResidency?.update(this.frameStartedAt, this.shouldYieldWork);
    if (this.runDeferredWork) this.runDeferredWork(updateVariants);
    else updateVariants();
    this.skyView?.update(timestamp, camera);
    syncFoliageLight(this.skyView);
    this.wildlifeView?.update(timestamp, camera);
    // Aquatic plants remain visible while land preparation stands down. Their
    // clock must keep matching the water surface during swimming and diving.
    advancePlantSway(timestamp);
    // Under water, the land stands down: the water sheet and the fog occlude
    // everything above the surface, and this project's cost is in the rebuilding —
    // scatter compactions, buffer uploads, ground-texture paints — rather than in
    // the drawing, so suspending the work is what saves the frame. Nothing is
    // hidden, so nothing pops on surfacing; the field catches up over the next few
    // frames. Water itself keeps updating: it is what you are looking at.
    const landStreaming = !isLandStreamingSuspended();
    if (!landStreaming) {
      for (const slot of this.waterSlots) slot.update(timestamp);
      return;
    }
    this.meadowGrass?.updateFrame(timestamp, camera, body);
    this.rockView?.update(timestamp, camera);
    if (camera) {
      const origin = this.terrainView.floatingOrigin.getState();
      const cameraWorld = { x: camera.position.x + origin.x, z: camera.position.z + origin.z };
      const updateGeology = () => {
        this.icebergView?.update(cameraWorld, this.shouldYieldWork);
        this.alpineRockView?.update(cameraWorld, this.shouldYieldWork);
      };
      if (this.runDeferredWork) this.runDeferredWork(updateGeology);
      else updateGeology();
    }
    syncViewRebuildQueue(this.rockBuildQueue, [this.rockView]);
    const rockPlacements = this.rockView?.getPlacements() ?? [];
    this.treeView?.update(timestamp, camera, this.rockView);
    syncViewRebuildQueue(this.treeBuildQueue, [this.treeView], 'pendingLodRebuild');
    this.bushView?.update(timestamp, camera, this.rockView);
    syncViewRebuildQueue(this.bushBuildQueue, [this.bushView]);
    for (const view of this.detailViews) view.update();
    for (const view of this.detailViews) {
      if (view.visibility) this.runDeferredWork?.(() => view.visibility.update(camera, this.shouldYieldWork));
    }
    syncViewRebuildQueue(this.detailBuildQueue, this.detailViews);
    this.sceneryScheduler.flush(this.sceneryConsumers, this.shouldYieldWork);
    if (this.runDeferredWork) this.runDeferredWork(() => this.updateForestGroundTextures());
    else this.updateForestGroundTextures();
    this.flowerView?.update(timestamp);
    for (const slot of this.waterSlots) slot.update(timestamp);
    this.waterObstacleUpdates.schedule();
    const updateObstacles = () => this.waterObstacleUpdates.flush(this.shouldYieldWork);
    if (this.runDeferredWork) this.runDeferredWork(updateObstacles);
    else updateObstacles();
    this.prewarmOneDistantWaterSlot();

    const focusChunk = this.terrainView.focusChunkKey ? this.terrainView.focusChunk : null;
    // Canonical camera XZ, once for the whole pass. Grass thins by how far each
    // chunk actually is in metres, and render-local metres only mean the same thing
    // near the origin — on an imported world the camera's render position is a few
    // metres from zero while the ground under it is a planet away from it.
    const canonicalFocus = camera
      ? this.terrainView.floatingOrigin.toCanonical(camera.position.x, camera.position.z)
      : null;
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
        slot.update(timestamp, focusChunk, '', [], canonicalFocus);
        continue;
      }
      let rockInput = this.grassRockInputs.get(slot);
      if (
        !rockInput
        || rockInput.descriptorKey !== descriptor.key
        || rockInput.rockPlacements !== rockPlacements
        || rockInput.objectBoulders !== objectBoulders
      ) {
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
        const localBoulders = localObjectBoulders.length === 0
          ? localRocks
          : localRocks.length === 0
            ? localObjectBoulders
            : [...localObjectBoulders, ...localRocks];
        rockInput = {
          descriptorKey: descriptor.key,
          rockPlacements,
          objectBoulders,
          signature,
          localBoulders,
        };
        this.grassRockInputs.set(slot, rockInput);
      }
      slot.update(timestamp, focusChunk, rockInput.signature, rockInput.localBoulders, canonicalFocus);
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
    this.sceneryScheduler.flush(this.sceneryConsumers, this.shouldYieldWork);
  }

  updateForestGroundTextures() {
    const field = this.treeView?.manifestStore?.forestField;
    if (!field || this.shouldYieldWork?.()) return;
    for (const terrainSlot of this.terrainView.slots) {
      const descriptor = terrainSlot.descriptor;
      if (!descriptor) continue;
      const contactKey = this.contactShadeKey(descriptor);
      const key = `${descriptor.key}:${terrainSlot.pageRevision}:${field.signature}:${contactKey}`;
      if (terrainSlot.forestFloorKey === key) continue;
      if (this.preparedPlacement && !this.preparedPlacement.ensureChunk(descriptor.chunkX, descriptor.chunkZ, 1, 0)) continue;
      const samples = FOREST_FLOOR_CANOPY_SAMPLES;
      const half = this.chunkWorldSize * 0.5;
      // The canopy's grass density, from the same habitat samples: the litter
      // pass reads it rather than sampling the forest field a second time.
      const floorConfig = this.config.trees?.forestFloor;
      const grassFloor = (this.grassFloorScratch ??= new Float32Array(samples * samples));
      let thinned = false;
      // R is the canopy, G the contact shade: writing the canopy clears the
      // previous shade with it, so the contact pass below starts from a clean
      // texture instead of compounding on the last one.
      this.canopyScratch = writeForestFloorCanopy({
        pixels: terrainSlot.forestFloorPixels,
        size: terrainSlot.forestFloorSize,
        samples,
        scratch: this.canopyScratch,
        canopyAt: (x, z) => {
          const habitat = field.sample(
            descriptor.centerWorldX - half + (x + 0.5) / samples * this.chunkWorldSize,
            descriptor.centerWorldZ + half - (z + 0.5) / samples * this.chunkWorldSize,
          );
          const floor = forestFloorDensity(habitat, 'grass', floorConfig);
          grassFloor[z * samples + x] = floor;
          if (floor < 1) thinned = true;
          return habitat.patchCoverage * habitat.suitability * 1.35;
        },
      });
      if (thinned) this.paintForestLitter(terrainSlot, descriptor, grassFloor, samples);
      this.paintContactShade(terrainSlot, descriptor);
      terrainSlot.forestFloorTexture.needsUpdate = true;
      terrainSlot.forestFloorKey = key;
      PerfCounters.inc('forestFloorTextureUploads');
      // Habitat sampling is deliberately budgeted to one low-resolution slot
      // per frame so chunk streaming cannot trigger an unbounded rebuild burst.
      return;
    }
  }

  /**
   * Bare litter between the canopy's grass islands, in the ground texture's
   * third channel: the island field the meadow sampler thins stems with, at
   * the canopy's grass density, so soil shows where the blades are not.
   */
  paintForestLitter(terrainSlot, descriptor, grassFloor, samples) {
    const size = terrainSlot.forestFloorSize;
    const texel = this.chunkWorldSize / size;
    const half = this.chunkWorldSize * 0.5;
    const tileSize = this.terrainView.worldStore.tileSize;
    const seed = (this.terrainView.worldStore.generator?.toMetadata?.().seed ?? 0) ^ CANOPY_FLOOR_PATCH_SALT;
    const ratio = samples / size;
    const at = (sample) => Math.min(samples - 1, Math.max(0, sample));
    writeForestFloorLitter({
      pixels: terrainSlot.forestFloorPixels,
      size,
      bareAt: (x, z) => {
        // Texel centre in sample space, as the canopy is upsampled.
        const sx = at((x + 0.5) * ratio - 0.5);
        const sz = at((z + 0.5) * ratio - 0.5);
        const floor = bilinearSample(grassFloor, samples, sx, sz);
        if (floor >= 1) return 0;
        return 1 - canopyFloorCover(
          (descriptor.centerWorldX - half + (x + 0.5) * texel) / tileSize,
          -(descriptor.centerWorldZ + half - (z + 0.5) * texel) / tileSize,
          floor,
          seed,
        );
      },
    });
  }

  /**
   * The soft dark patch where trunks and boulders meet the ground, in the ground
   * texture's second channel — the donor's contact shade, at trunk scale on the
   * texture's two-metre texels.
   */
  paintContactShade(terrainSlot, descriptor) {
    if (!this.contactShadeSettings) return;
    const sources = [];
    const manifest = this.treeView?.manifestStore?.get(
      descriptor.chunkX,
      descriptor.chunkZ,
      this.rockView,
    ) ?? [];
    for (const placement of manifest) {
      const scale = placement.heightScale ?? placement.scale ?? 1;
      sources.push({
        x: placement.x,
        z: placement.z,
        radius: contactShadeRadius(this.contactShadeSettings, 'tree', scale),
        strength: this.contactShadeSettings.treeStrength,
      });
    }
    for (const placement of this.rockView?.getPlacements() ?? []) {
      if (placement.ownerChunkX !== descriptor.chunkX
        || placement.ownerChunkZ !== descriptor.chunkZ) continue;
      sources.push({
        x: placement.x,
        z: placement.z,
        radius: contactShadeRadius(this.contactShadeSettings, 'rock', placement.scale ?? 1),
        strength: this.contactShadeSettings.rockStrength,
      });
    }
    if (sources.length === 0) return;
    paintContactShade({
      pixels: terrainSlot.forestFloorPixels,
      size: terrainSlot.forestFloorSize,
      centerWorldX: descriptor.centerWorldX,
      centerWorldZ: descriptor.centerWorldZ,
      chunkWorldSize: this.chunkWorldSize,
      sources,
      channel: 1,
    });
    PerfCounters.inc('contactShadeSlotsPainted', sources.length);
  }

  /**
   * The part of the ground texture's key that depends on what is standing on it.
   *
   * Without this a chunk keeps the contact shade of whatever stood there when its
   * canopy was last written, so a felled tree would leave its patch behind until
   * the canopy happened to change — the same class of bug as a stale canopy.
   */
  contactShadeKey(descriptor) {
    if (!this.contactShadeSettings) return 'no-contact-shade';
    const manifest = this.treeView?.manifestStore?.get(
      descriptor.chunkX,
      descriptor.chunkZ,
      this.rockView,
    ) ?? [];
    const rocksHere = this.rockView?.placementsByChunk?.get(`${descriptor.chunkX}:${descriptor.chunkZ}`)?.length ?? 0;
    return `${manifest.length}:${rocksHere}`;
  }

  dispose() {
    this.preparedPlacement?.dispose();
    this.terrainView.preparedPlacement = null;
    this.terrainView.stylizedSurface = null;
    this.skyView?.dispose();
    this.variantResidency?.dispose();
    this.variantResidency = null;
    this.wildlifeView?.dispose();
    this.flowerView?.dispose();
    for (const view of this.detailViews) view.dispose();
    this.detailViews = [];
    this.bushView?.dispose();
    this.treeView?.dispose();
    this.rockView?.dispose();
    this.icebergView?.dispose();
    this.alpineRockView?.dispose();
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
    for (const path of this.tropicalKitVariantPaths) this.sceneAssets?.release(path);
    this.tropicalKitVariantPaths.length = 0;
    this.sceneAssets?.dispose();
    this.sceneAssets = null;
    this.grassBuildQueue.clear();
    this.flowerBuildQueue.clear();
    this.treeBuildQueue.clear();
    this.rockBuildQueue.clear();
    this.bushBuildQueue.clear();
    this.detailBuildQueue.clear();
    for (const slot of this.waterSlots) slot.dispose();
    this.waterObstacleUpdates.dispose();
    this.sharedWaterMaterials.dispose();
    this.reflectionReservation?.cancel();
    this.reflections?.dispose();
    this.terrainView.beforeMainRender = null;
    this.terrainView.afterMainRender = null;
    this.waterSlots.length = 0;
    for (const slot of this.slots) slot.dispose();
    this.meadowGrass?.dispose();
    this.slots.length = 0;
    this.revisionTracker?.dispose();
    this.revisionTracker = null;
  }
}
