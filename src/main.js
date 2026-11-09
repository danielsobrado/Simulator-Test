import './styles.css';
import './editor/roadside/roadside.css';
import { RoadsideDetailsView } from './editor/roadside/RoadsideDetailsView.js';
import { RoadsideDetailsUi } from './editor/roadside/RoadsideDetailsUi.js';
import { SettlementView } from './editor/world/settlements/view/SettlementView.js';
import { duskFromSky } from './editor/world/settlements/view/SettlementDusk.js';
import { createTownRuntime } from './editor/towns/TownRuntime.js';
import { kitTownsEnabled } from './editor/towns/townMode.js';
import { SettlementAmbience } from './editor/audio/settlement_ambience.js';
import { SettlementGroundBounce } from './editor/world/settlements/view/SettlementGroundBounce.js';
import { RendererCreationDiagnostics } from './render/RendererCreationDiagnostics.js';
import { canCreateWebGPUDevice } from './render/deviceLimits.js';
import './render/installViewportFramebufferSourcePatch.js';
import './editor/performance/frameRateDisplay.css';
import './editor/performance/qa/perfQa.css';
import './editor/player/playerMode.css';
import './editor/map/worldMap.css';
import './editor/ui/radialPalette.css';
import './editor/ui/compactMenus.css';
import './editor/inventory/inventory.css';
import { loadEditorConfig } from './config/loadEditorConfig.js';
import './editor/audio/index.js';
import { LoadingOverlay } from './editor/ui/LoadingOverlay.js';
import { LoadingTracker } from './editor/ui/LoadingTracker.js';
import { ESCAPE_PRIORITY, EscapeStack } from './editor/ui/EscapeStack.js';
import { assetFileName, bindAssetProgress, watchWalkModeEntry } from './editor/ui/loadingSources.js';
import { EditorCamera } from './editor/EditorCamera.js';
import { EditorUi } from './editor/EditorUi.js';
import { InfiniteTerrainView } from './editor/InfiniteTerrainView.js';
import { MacroFarTerrainView } from './editor/world/MacroFarTerrainView.js';
import { CameraCutCoordinator } from './editor/world/CameraCutCoordinator.js';
import { WorldMapController } from './editor/map/WorldMapController.js';
import { WorldMapUi } from './editor/map/WorldMapUi.js';
import { GameplayOverlayController } from './editor/ui/GameplayOverlayController.js';
import { InventoryController } from './editor/inventory/InventoryController.js';
import { InventoryStore } from './editor/inventory/InventoryStore.js';
import { InventoryUi } from './editor/inventory/InventoryUi.js';
import { ITEM_CATALOG, PLAYER_STARTING_LOADOUT } from './editor/inventory/itemCatalogRuntime.js';
import { ProceduralAssetManager } from './editor/workshop/ProceduralAssetManager.js';
import { ProceduralWorkshopUi } from './editor/workshop/ProceduralWorkshopUi.js';
import { ObjectMap } from './editor/ObjectMap.js';
import { ObjectView } from './editor/ObjectView.js';
import { OBJECT_CATALOG } from './editor/objectCatalog.js';
import { GodsEndAssetLibrary } from './editor/assets/godsEnd/GodsEndAssetLibrary.js';
import { FrameRateDisplay } from './editor/performance/FrameRateDisplay.js';
import { FrameRateMeter } from './editor/performance/FrameRateMeter.js';
import { FRAME_RATE_DISPLAY_INTERVAL_MS } from './editor/performance/frameRateConstants.js';
import { assetStartupTelemetry } from './editor/performance/AssetStartupTelemetry.js';
import { PerfCounters } from './editor/performance/qa/PerfCounters.js';
import { HudPresentationBindings, hasCaptureBlockingOverlay } from './editor/player/hud/HudPresentationBindings.js';
import { HudVisibilityController } from './editor/player/hud/HudVisibilityController.js';
import { WorldVisualQa } from './editor/performance/qa/WorldVisualQa.js';
import { PerfQaHarness } from './editor/performance/qa/PerfQaHarness.js';
import { createObjectTownQaScene } from './editor/performance/qa/ObjectTownQaScene.js';
import { applyPerfQaDensityProfile } from './editor/performance/qa/PerfQaDensityProfiles.js';
import { parseQaParams } from './editor/performance/qa/parseQaParams.js';
import { PlayerController } from './editor/player/PlayerController.js';
import { ViewModeController } from './editor/player/ViewModeController.js';
import { ViewModeUi } from './editor/player/ViewModeUi.js';
import { createHudMinimapSource } from './editor/player/hud/createHudMinimapSource.js';
import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK, PLAYER_MODE_FLY } from './editor/player/playerConstants.js';
import { isTreeImpostorBakeMode } from './editor/stylized/impostorBakeMode.js';
import { StylizedSurfaceView } from './editor/stylized/StylizedSurfaceView.js';
import { BiomeAssetPalette } from './editor/stylized/BiomeAssetPalette.js';
import { createWeatherController } from './editor/weather/weather_controller.js';
import { StormState, readStormOverride } from './editor/weather/storm/StormState.js';
import { createWeatherUi } from './editor/weather/weather_ui.js';
import {
  createWeatherTerrainSamplers,
  raycastTerrainHeightfield,
} from './editor/weather/weather_terrain_adapters.js';
import { attachSpellHotkeys, createSpellRuntime } from './editor/spells/spell_runtime.js';
import { PlayerVitals } from './editor/player/PlayerVitals.js';
import { createBogVents } from './editor/stylized/bog/BogVents.js';
import { GRASS_MARK } from './editor/stylized/meadow/MeadowInteractionMap.js';
import { attachCaptureHotkey } from './editor/input/attachCaptureHotkey.js';
import { ThirdPersonCamera } from './editor/player/ThirdPersonCamera.js';
import { createCharacterView } from './editor/character/createCharacterView.js';
import { audioBus, emitAudio } from './editor/audio/index.js';
import { WorldSoundscape } from './editor/audio/world_soundscape.js';
import { SurfaceWetness } from './editor/weather/surfaceWetness.js';
import { SnowCover } from './editor/weather/storm/SnowCover.js';
import { stormRainUniform, stormSnowCoverUniform } from './editor/weather/storm/stormGroundUniforms.js';
import { SkyLookController } from './editor/stylized/sky/SkyLookController.js';
import { DEFAULT_SKY_PRESET, SKY_PRESETS } from './editor/stylized/sky/SkyPresets.js';
import { DayNightCycle, TIME_PRESET_ANCHORS } from './editor/stylized/sky/dayNightCycle.js';
import { SnowCountryWeight } from './editor/stylized/sky/SnowCountryWeight.js';
import { SkyRegionSampler } from './editor/stylized/sky/SkyRegionSampler.js';
import { FallingLeaves } from './editor/stylized/leaves/FallingLeaves.js';
import { SnowPowderKicks } from './editor/stylized/powder/SnowPowderKicks.js';
import { WorldAmbience } from './editor/stylized/ambient/WorldAmbience.js';
import { HeroSelectUi } from './editor/character/HeroSelectUi.js';
import { updateCharacterOcclusion } from './editor/character/CharacterOcclusion.js';
import { WorldWindPass } from './editor/weather/wind/WorldWindPass.js';
import { WaterfallMist } from './editor/stylized/mist/WaterfallMist.js';
import { WaterInteractionSurface } from './editor/stylized/WaterInteractionSurface.js';
import { RippleField } from './editor/water/RippleField.js';
import { BiomeSurfaceResponse } from './editor/biomes/BiomeSurfaceResponse.js';
import { createSpellSurfacePress } from './editor/spells/spellSurfacePress.js';
import { createRiverFallSiteSource } from './editor/water/RiverFallSites.js';
import { resolveWaterQualityFeatures } from './editor/water/WaterQuality.js';
import { configureSea, updateSeaState } from './editor/water/seaState.js';
import { classifyFootstepSurface } from './editor/audio/footstep_surface.js';
import { snowAtPoint, snowBiomeCoverAt } from './editor/materials/SnowAccumulation.js';
import { terrainBakeMacroSeed } from './editor/materials/TerrainBakeNoise.js';
import {
  groundDeformationUniforms,
  readDeformationTexel,
  setGroundDeformationRegion,
  stampDisc,
  stampFootprint,
  updateGroundDeformation,
} from './editor/stylized/deformation/groundDeformationState.js';
import { snowWakeRecorder } from './editor/stylized/deformation/SnowWakeRecorder.js';
import { PLAYER_WATER_DRY } from './editor/player/PlayerWaterState.js';
import { SwitchableCharacterView } from './editor/character/SwitchableCharacterView.js';
import {
  resolveHeroPreference,
  storeHeroPreference,
} from './editor/character/heroPreference.js';
import { PROCEDURAL_HERO_ID } from './config/validateCharacterConfig.js';

import { RendererStartupGuard } from './editor/lifecycle/RendererStartupGuard.js';
import { RendererRecovery } from './editor/lifecycle/RendererRecovery.js';
import { captureEditorRecoveryState, restoreEditorRecoveryState } from './editor/lifecycle/EditorRecoveryState.js';
import { ResourceScope } from './editor/lifecycle/ResourceScope.js';
import { DeferredWorkBudget } from './editor/performance/DeferredWorkBudget.js';
import { StreamedDrawPreparation } from './render/preparation/StreamedDrawPreparation.js';
import { withSceneWarmup } from './render/preparation/SceneWarmup.js';
import { withPreparationFrame } from './render/preparation/DrawPreparation.js';
import { ExplorationRuntime } from './editor/exploration/ExplorationRuntime.js';
/** How long the drow holds the casting stance after a spell fires. */
const SPELL_CAST_POSE_MS = 520;
import './editor/weather/weather.css';
import './editor/spells/spell_menu.css';
import { applySceneAssetSettings } from './editor/settings/SceneSettings.js';
import {
  loadBootSceneSettings,
  resolveLocalGlb,
  SceneSettingsRuntime,
} from './editor/settings/SceneSettingsRuntime.js';
import { createPostProcessingSettings } from './render/postprocessing/PostProcessingSettings.js';
import { PostProcessingController } from './render/postprocessing/PostProcessingController.js';
import { PostProcessingFocusResolver } from './render/postprocessing/PostProcessingFocusResolver.js';
import {
  POST_PROCESSING_REACTIVE_EVENTS,
  POST_PROCESSING_RESET_REASONS,
} from './render/postprocessing/PostProcessingInvalidation.js';
import { TerrainAwareEditorController } from './editor/TerrainAwareEditorController.js';
import { ConstructionStore } from './editor/construction/ConstructionStore.js';
import { ConstructionMaterialStore } from './editor/construction/ConstructionMaterialStore.js';
import { ConstructionGizmoController } from './editor/construction/ui/ConstructionGizmoController.js';
import { ConstructionPaletteController } from './editor/construction/ui/ConstructionPaletteController.js';
import { ConstructionSpatialIndex } from './editor/construction/ConstructionSpatialIndex.js';
import { ConstructionCompilerClient } from './editor/construction/compile/ConstructionCompilerClient.js';
import { ConstructionView } from './editor/construction/render/ConstructionView.js';
import { ConstructionGroundProvider } from './editor/construction/simulation/ConstructionGroundProvider.js';
import { TILE_BY_KEY, TILE_CATALOG } from './editor/tileCatalog.js';
import { GpuVoxelWorld } from './editor/voxel/GpuVoxelWorld.js';
import { VoxelPrototypeUi } from './editor/voxel/VoxelPrototypeUi.js';
import { VoxelStampStore } from './editor/voxel/VoxelStampStore.js';
import { createVoxelWorldLayout } from './editor/voxel/VoxelWorldLayout.js';
import { ChunkedHeightField } from './editor/world/ChunkedHeightField.js';
import { ChunkedTileMap } from './editor/world/ChunkedTileMap.js';
import { FloatingOrigin } from './editor/world/FloatingOrigin.js';
import { ProceduralWorldGenerator } from './editor/world/ProceduralWorldGenerator.js';
import { createSurfaceMaskConfig } from './editor/world/ChunkRenderPixels.js';
import { createVegetationScatterConfig } from './editor/stylized/vegetationScatter.js';
import { WorkerBackedWorldStore } from './editor/world/WorkerBackedWorldStore.js';
import { WorldChunkWorkerClient } from './editor/world/WorldChunkWorkerClient.js';
import {
  IndexedDbWorldContentProvider,
  LocalFirstWorldContentProvider,
  UrlWorldContentProvider,
} from './editor/world/WorldContentProvider.js';

const TERRAIN_PREFETCH_REFRESH_MS = 200;

const BOOT_STEPS = Object.freeze([
  { id: 'settings', label: 'Scene settings' },
  { id: 'terrain', label: 'Terrain view and GPU device' },
  { id: 'assets', label: 'World assets' },
  { id: 'blades', label: 'Grass blade profiles' },
  { id: 'map', label: 'Initial map' },
  { id: 'prewarm', label: 'Compiling render pipelines' },
]);

async function startEditor(restoreState = null) {
  if (window.location.search.includes('qaRecovery=1')) console.log('Recovery boot: start');
  const resources = new ResourceScope();
  const startup = resources.own(new RendererStartupGuard());
  try {
    const runtime = await initializeEditor(restoreState, resources, startup);
    startup.dispose();
    return runtime;
  }
  catch (error) { resources.dispose(); throw error; }
}

async function initializeEditor(restoreState, resources, startup) {
  let sceneReloadPending = false;
  const loading = new LoadingTracker();
  const loadingOverlay = new LoadingOverlay(document.body);
  resources.own(loadingOverlay);
  loadingOverlay.attach(loading);
  const boot = loading.begin({ title: 'Starting Drusniel World', steps: BOOT_STEPS });
  const closeBootTrace = assetStartupTelemetry.trace.bindLoadingSession(boot);
  resources.defer(closeBootTrace);
  resources.defer(() => assetStartupTelemetry.trace.dispose());
  boot.start('settings');
  let bootSceneSettings = null;
  let bootSceneSettingsError = null;
  try {
    bootSceneSettings = restoreState?.document.visualConfig?.sceneSettings
      ? { document: restoreState.document.visualConfig.sceneSettings, sourceUrl: window.location.href }
      : await loadBootSceneSettings();
  } catch (error) {
    bootSceneSettingsError = error;
  }
  const config = loadEditorConfig();
  if (restoreState?.backend) config.renderer.forceWebGL = restoreState.backend === 'webgl';
  if (!config.renderer.forceWebGL
      && !await canCreateWebGPUDevice({ powerPreference: config.renderer.powerPreference ?? 'high-performance' })) {
    console.warn('No WebGPU device; starting on the WebGL renderer profile.');
    config.renderer.forceWebGL = true;
  }
  const postProcessingStore = createPostProcessingSettings(
    config.stylizedSurface.postProcessing,
  );
  const perfQaConfig = parseQaParams(window.location.search);
  if (perfQaConfig) {
    applyPerfQaDensityProfile(config, perfQaConfig.densityProfile);
    if (perfQaConfig.contactOcclusion !== null) {
      config.stylizedSurface.sky.godRays.volumetric.contactOcclusion.enabled = perfQaConfig.contactOcclusion;
    }
    if (!perfQaConfig.seaPolish) {
      config.stylizedSurface.water.sea.surf.enabled = false;
      config.stylizedSurface.water.sea.detail.enabled = false;
    }
  }
  const localAssetObjectUrls = [];
  resources.defer(() => { localAssetObjectUrls.forEach((url) => URL.revokeObjectURL(url)); });
  if (bootSceneSettings) {
    try {
      await applySceneAssetSettings(config, bootSceneSettings.document, {
        baseUrl: bootSceneSettings.sourceUrl,
        resolveLocalAsset: async (assetId) => {
          const url = await resolveLocalGlb(assetId);
          localAssetObjectUrls.push(url);
          return url;
        },
      });
    } catch (error) {
      bootSceneSettings = null;
      bootSceneSettingsError = error;
    }
  }
  const impostorBakeMode = isTreeImpostorBakeMode();
  const defaultTile = TILE_BY_KEY.get(config.map.defaultTile);
  if (!defaultTile) {
    throw new Error(`Unknown default tile: ${config.map.defaultTile}.`);
  }

  const NEAR_FAR_PLANE = 5000;
  const farTerrainRadius = config.world.farTerrain?.enabled !== false
    ? (config.world.farTerrain?.radiusMeters ?? 0)
    : 0;
  const nearView = {
    farPlane: NEAR_FAR_PLANE,
    skyRadius: config.stylizedSurface?.sky?.radius ?? NEAR_FAR_PLANE,
    fogDensity: config.stylizedSurface?.sky?.fogDensity ?? 0,
  };
  const farView = farTerrainRadius > 0
    ? (() => {
      const skyRadius = farTerrainRadius + config.world.floatingOriginThreshold + 8000;
      const densityScale = config.stylizedSurface?.sky?.aerial?.farDensityScale ?? 1.5;
      return { farPlane: skyRadius + 4000, skyRadius, fogDensity: densityScale / farTerrainRadius };
    })()
    : null;

  const root = document.querySelector('#app');
  const generator = new ProceduralWorldGenerator({
    seed: config.world.seed,
    version: config.world.generatorVersion,
    heightScale: config.world.heightScale,
    seaLevel: config.world.seaLevel,
  });
  const surfaceMaskConfig = createSurfaceMaskConfig(config.stylizedSurface, {
    tileSize: config.map.tileSize,
  });
  const vegetationScatterConfig = createVegetationScatterConfig(
    config.stylizedSurface,
    config.map.tileSize,
  );
  const chunkWorker = new WorldChunkWorkerClient({
    chunkSize: config.world.chunkSize,
    generator,
    surfaceMaskConfig,
    vegetationScatterConfig,
    workerCount: config.world.workerCount ?? null,
  });
  const localContent = new IndexedDbWorldContentProvider();
  const remoteContent = config.world.contentBaseUrl
    ? new UrlWorldContentProvider({ baseUrl: config.world.contentBaseUrl })
    : null;
  const contentProvider = new LocalFirstWorldContentProvider({
    local: localContent,
    remote: remoteContent,
  });
  const worldStore = new WorkerBackedWorldStore({
    chunkWorker,
    chunkSize: config.world.chunkSize,
    tileSize: config.map.tileSize,
    cacheLimit: config.world.maxCpuChunks,
    generator,
    surfaceMaskConfig,
    contentProvider,
  });
  resources.own(worldStore);
  const tileMap = new ChunkedTileMap({ worldStore, defaultTileId: defaultTile.id });
  const heightField = new ChunkedHeightField({ worldStore });
  const objectMap = new ObjectMap({ tileMap, objectCatalog: OBJECT_CATALOG });
  let biomeAssetPalette;
  try {
    biomeAssetPalette = new BiomeAssetPalette({
      stylizedConfig: config.stylizedSurface,
      document: bootSceneSettings?.document.biomeAssets ?? null,
    });
  } catch (error) {
    bootSceneSettingsError = error;
    biomeAssetPalette = new BiomeAssetPalette({ stylizedConfig: config.stylizedSurface });
  }
  const floatingOrigin = new FloatingOrigin({
    threshold: config.world.floatingOriginThreshold,
    snapSize: config.world.chunkSize * config.map.tileSize,
  });
  if (restoreState) { floatingOrigin.originX = restoreState.origin.x; floatingOrigin.originZ = restoreState.origin.z; }

  const voxelWorldLayout = createVoxelWorldLayout(config.voxelPrototype, config.map);
  const voxelStampStore = new VoxelStampStore({
    cells: [0, voxelWorldLayout.totalCellsY, 0],
    maxStamps: config.voxelPrototype.maxStamps,
    unboundedXZ: true,
  });

  const ui = new EditorUi({
    root,
    config,
    tileCatalog: TILE_CATALOG,
    tileMap,
    heightField,
    objectCatalog: OBJECT_CATALOG,
    objectMap,
  });
  resources.own(ui);
  ui.attachBiomeAssetPalette(biomeAssetPalette);
  const frameRateDisplay = new FrameRateDisplay({ root });
  resources.own(frameRateDisplay);
  const frameRateMeter = new FrameRateMeter();

  const terrainView = new InfiniteTerrainView({
    container: ui.viewport,
    tileMap,
    heightField,
    worldStore,
    floatingOrigin,
    streamingConfig: config.world,
    rendererConfig: config.renderer,
    stylizedConfig: config.stylizedSurface,
  });
  resources.own(terrainView);
  startup.attach(terrainView.renderer);
  const creationDiagnostics = new RendererCreationDiagnostics(terrainView.renderer, assetStartupTelemetry.trace);
  resources.own(creationDiagnostics);

  if (window.location.search.includes('qaRecovery=1')) console.log('Recovery boot: GPU init');
  boot.start('terrain');
  try {
    await startup.wait(terrainView.initialize());
  } catch (error) {
    boot.fail(error);
    terrainView.dispose();
    worldStore.dispose();
    throw error;
  }
  const postProcessingController = new PostProcessingController({
    renderer: terrainView.renderer,
    scene: terrainView.scene,
    postProcessingStore,
    sunDirection: terrainView.godRays.sunDirection,
    sunColor: config.stylizedSurface.sky.sunColor,
    bypassProvider: () => (
      terrainView.godRays.enabled
      && terrainView.godRays.technique === 'volumetric'
    ),
  });
  resources.own(postProcessingController);
  terrainView.setPostProcessingController(postProcessingController);
  const temporalUnsubscribers = [];
  resources.defer(() => { for (const unsubscribe of temporalUnsubscribers) unsubscribe(); });
  temporalUnsubscribers.push(
    floatingOrigin.subscribe(() => {
      postProcessingController.invalidate(
        POST_PROCESSING_RESET_REASONS.FLOATING_ORIGIN_REBASE,
      );
    }),
    worldStore.subscribe((change) => {
      if (change.kind === 'reset') {
        postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.WORLD_LOADED);
      } else if (change.kind === 'tile' || change.kind === 'height') {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.TERRAIN_EDIT,
        );
      }
    }),
    voxelStampStore.subscribe(() => {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.VOXEL_EDIT,
      );
    }),
    terrainView.subscribeStreaming((event) => {
      if (event.kind === 'mass-chunk-reassignment') {
        postProcessingController.invalidate(
          POST_PROCESSING_RESET_REASONS.MASS_CHUNK_REASSIGNMENT,
        );
      } else if (event.kind === 'chunk-streamed-in') {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.CHUNK_STREAMED_IN,
        );
      }
    }),
  );

  const objectView = new ObjectView({
    terrainView,
    tileMap,
    heightField,
    objectMap,
    objectCatalog: OBJECT_CATALOG,
  });
  resources.own(objectView);
  const constructionStore = new ConstructionStore();
  const constructionSpatialIndex = new ConstructionSpatialIndex({
    chunkWorldSize: config.world.chunkSize * config.map.tileSize,
  });
  constructionStore.subscribe((change) => {
    if (change.kind === 'add' || change.kind === 'restore') {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_PLACEMENT,
      );
    } else if (change.kind === 'remove' || change.kind === 'clear') {
      postProcessingController.notifyReactive(
        POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_REMOVAL,
      );
    } else if (change.kind === 'update' || change.kind === 'history') {
      postProcessingController.notifyReactive(
        change.after
          ? POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_PLACEMENT
          : POST_PROCESSING_REACTIVE_EVENTS.CONSTRUCTION_REMOVAL,
      );
    }
    if (change.kind === 'clear' || change.kind === 'replace') {
      constructionSpatialIndex.clear();
      for (const record of constructionStore.list()) constructionSpatialIndex.update(record);
      return;
    }
    if (change.hint?.decorationOnly) return;
    if (change.after) constructionSpatialIndex.update(change.after);
    else if (change.id) constructionSpatialIndex.remove(change.id);
  });
  const constructionCompiler = new ConstructionCompilerClient();
  resources.own(constructionCompiler);
  const constructionMaterialStore = new ConstructionMaterialStore();
  const constructionView = new ConstructionView({
    terrainView,
    store: constructionStore,
    compilerClient: constructionCompiler,
    materialStore: constructionMaterialStore,
  });
  resources.own(constructionView);
  const proceduralAssetManager = new ProceduralAssetManager({
    tileSize: tileMap.tileSize,
    objectMap,
    objectView,
    ui,
    lodConfig: config.objects?.lod,
  });
  resources.defer(() => proceduralAssetManager.clearInstalled());
  const stylizedSurface = new StylizedSurfaceView({
    terrainView,
    objectMap,
    config: terrainView.stylizedConfig,
    baseUrl: import.meta.env.BASE_URL,
    biomeAssetPalette,
    // The snow band lives in the world's own configuration, so it is handed down
    // here rather than guessed at in the surface config: bark and ground have to
    // whiten at the same altitude, and this is the only place that can see both.
    snowBand: config.world?.farTerrain,
  });
  resources.own(stylizedSurface);
  boot.start('assets');
  const releaseAssetProgress = bindAssetProgress(boot);
  ui.attachPostProcessing(postProcessingStore);
  ui.attachGodRays(terrainView.godRays);
  ui.attachGrassTuning(stylizedSurface.grassTuning);
  ui.attachLoading(loading);
  ui.attachGrassBladeProfiles(stylizedSurface.bladeProfiles);
  stylizedSurface.bladeProfiles.ready.then(() => ui.renderGrassBladeProfiles());
  boot.start('blades');
  await startup.wait(stylizedSurface.bladeProfiles.ready);

  if (impostorBakeMode) {
    await startup.wait(stylizedSurface.bakeRequest);
    return;
  }

  const SKY_PRESET_STORAGE_KEY = 'drusniel_sky_preset';
  const storedSkyPreset = (() => {
    try {
      return window.localStorage.getItem(SKY_PRESET_STORAGE_KEY);
    } catch {
      return null;
    }
  })();
  const macroFarTerrain = new MacroFarTerrainView({
    scene: terrainView.scene,
    worldStore,
    floatingOrigin,
    config,
    forestFieldProvider: () => stylizedSurface.treeView?.manifestStore?.forestField ?? null,
  });
  resources.own(macroFarTerrain);
  terrainView.macroFarTerrain = macroFarTerrain;

  const editorCamera = new EditorCamera({
    canvas: terrainView.renderer.domElement,
    viewSize: config.camera.viewSize,
    minZoom: config.camera.minZoom,
    maxZoom: config.camera.maxZoom,
    damping: config.camera.damping,
    farPlane: nearView.farPlane,
  });
  resources.own(editorCamera);

  let playerController;
  let viewModeController;
  let controller;
  const gameplayOverlayController = new GameplayOverlayController({
    getPlayerController: () => playerController,
  });
  resources.own(gameplayOverlayController);
  let spellKeyHandler = null;
  const detachSpellHotkeys = attachSpellHotkeys(() => spellKeyHandler);
  resources.defer(() => { detachSpellHotkeys(); });
  resources.defer(() => { spellKeyHandler = null; });
  const inventoryStore = new InventoryStore(ITEM_CATALOG, null, {
    capacity: PLAYER_STARTING_LOADOUT.capacity,
  });
  inventoryStore.applyStartingLoadout(PLAYER_STARTING_LOADOUT);
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('inventoryDemo') === '1') {
    // Starting loadout already applied; demo flag keeps the same seeded bag for screenshots.
  }
  const inventoryController = new InventoryController({
    store: inventoryStore,
    overlayController: gameplayOverlayController,
    catalog: ITEM_CATALOG,
  });
  resources.own(inventoryController);
  const inventoryUi = new InventoryUi({ root, controller: inventoryController });
  resources.own(inventoryUi);
  const worldMapController = new WorldMapController({
    worldStore,
    floatingOrigin,
    tileSize: config.map.tileSize,
    getViewModeController: () => viewModeController,
    getPlayerController: () => playerController,
    getCameraCutCoordinator: () => cameraCutCoordinator,
    getCampaign: () => controller?.campaign ?? null,
    overlayController: gameplayOverlayController,
  });
  resources.own(worldMapController);
  const worldMapUi = new WorldMapUi({ root, controller: worldMapController });
  resources.own(worldMapUi);

  let cameraViewKeyHandler = null;
  const detachCameraViewHotkey = attachCaptureHotkey(() => cameraViewKeyHandler);
  resources.defer(() => { detachCameraViewHotkey(); });
// Doors in kit towns (E); registered before the player controller swallows keys.
let townKeyHandler = null;
const detachTownHotkey = attachCaptureHotkey(() => townKeyHandler);
resources.defer(() => { townKeyHandler = null; detachTownHotkey(); });
// `?towns=kit` draws burgs with the medieval kit instead of SettlementView (towns/townMode.js).
const kitTowns = kitTownsEnabled();

  playerController = new PlayerController({
    canvas: terrainView.renderer.domElement,
    terrainView,
    config: config.player,
    speedBoost: config.exploration.speedBoost,
    farPlane: nearView.farPlane,
  });
  resources.own(playerController);
  const characterGround = {
    heightAt: (x, z) => playerController.getGroundHeight(x, z),
  };
  const characterEnabled = config.character?.enabled !== false;
  const thirdPersonCamera = characterEnabled
    ? new ThirdPersonCamera({
      terrain: characterGround,
      fovDegrees: config.player.fovDegrees,
      farPlane: nearView.farPlane,
      config: config.character?.thirdPerson,
    })
    : null;
  viewModeController = new ViewModeController({
    editorCamera,
    playerController,
    terrainView,
    thirdPersonCamera,
    objectView,
    freeFlySettings: config.exploration.freeFly,
  });
  resources.own(viewModeController);
  const shiftWorldForOrigin = (rebase) => {
    viewModeController.shiftWorld(rebase.shiftX, rebase.shiftZ);
    controller.refreshObjects();
    constructionView.rebase();
    characterView?.shiftWorld(rebase.shiftX, rebase.shiftZ);
    snowPowder.shiftWorld(rebase.shiftX, rebase.shiftZ);
    worldAmbience.shiftWorld(rebase.shiftX, rebase.shiftZ);
    stylizedSurface.shiftOrigin(rebase.shiftX, rebase.shiftZ);
    exploration.shiftWorld(rebase.shiftX, rebase.shiftZ);
    townRuntime?.rebase();
  };
  const cameraCutCoordinator = new CameraCutCoordinator({ terrainView, playerController,
    viewModeController, shiftWorld: shiftWorldForOrigin,
    refreshObjects: () => objectView.syncResidency(true),
    notifyCut: () => {
      stylizedSurface.meadowGrass?.clearTransientInteraction();
      postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.CAMERA_TELEPORT);
    },
  });
  resources.own(cameraCutCoordinator);
  cameraViewKeyHandler = (event) => viewModeController.handleCameraViewKey(event);
  let previousViewMode = viewModeController.mode;
  let previousActiveCamera = viewModeController.camera;
  temporalUnsubscribers.push(
    viewModeController.subscribe((state) => {
      const activeCamera = viewModeController.camera;
      if (state.mode !== previousViewMode) {
        postProcessingController.invalidate(
          state.mode === PLAYER_MODE_WALK
            ? POST_PROCESSING_RESET_REASONS.PLAYER_SPAWNED
            : POST_PROCESSING_RESET_REASONS.CAMERA_MODE_CHANGED,
        );
        previousViewMode = state.mode;
      } else if (activeCamera !== previousActiveCamera) {
        postProcessingController.invalidate(
          POST_PROCESSING_RESET_REASONS.ACTIVE_CAMERA_REPLACED,
        );
      }
      previousActiveCamera = activeCamera;
    }),
    playerController.subscribeTeleports((pose, previous) => {
      if (!cameraCutCoordinator.active && (pose.x !== previous.x || pose.z !== previous.z)) {
        const canonical = terrainView.floatingOrigin.toCanonical(pose.x, pose.z);
        terrainView.cutToCanonical(canonical, performance.now());
      }
      postProcessingController.invalidate(
        POST_PROCESSING_RESET_REASONS.CAMERA_TELEPORT,
      );
    }),
  );

  const streamingFrameListeners = new Set();
  const streamingProbe = {
    getStatus: () => terrainView.getStreamingStatus(),
    onFrame: (listener) => {
      streamingFrameListeners.add(listener);
      return () => streamingFrameListeners.delete(listener);
    },
  };
  ui.attachStreamingProbe(streamingProbe);
  watchWalkModeEntry({
    viewModeController,
    loading,
    walkMode: PLAYER_MODE_WALK,
    ...streamingProbe,
  });

  controller = new TerrainAwareEditorController({
    tileMap,
    heightField,
    worldStore,
    objectMap,
    terrainView,
    objectView,
    editorCamera,
    objectCatalog: OBJECT_CATALOG,
    brushSizes: config.brush.sizes,
    defaultBrushSize: config.brush.defaultSize,
    terrainConfig: config.terrain,
    voxelStampStore,
    proceduralAssetManager,
    constructionStore,
    constructionMaterialStore,
    constructionView,
    biomeAssetPalette,
    inventoryStore,
    worldInputBlockedProvider: () => gameplayOverlayController.isWorldInputBlocked() || viewModeController.mode === PLAYER_MODE_FLY,
  });
  resources.own(controller);
  const godsEndAssets = new GodsEndAssetLibrary({
    renderer: terrainView.renderer, objectMap, objectView, controller,
    baseUrl: import.meta.env.BASE_URL,
  });
  resources.own(godsEndAssets);
  const roadsideDetails = new RoadsideDetailsView({ terrainView, controller, assets: godsEndAssets, surface: stylizedSurface,
    constructionSpatialIndex,
    enabled: config.stylizedSurface.enhancements?.roadsideLanterns === true });
  resources.own(roadsideDetails);
  const settlementView = new SettlementView({ terrainView, baseUrl: import.meta.env.BASE_URL,
    enabled: config.stylizedSurface.enhancements?.settlementBuildings !== false && !kitTowns,
    // Towns in snow country wear snow on every face turned up (SettlementSnow).
    snowGroundByTile: config.stylizedSurface.biomeLooks?.snow?.ground ?? [],
    // A night look keeps its "sun" high as moonlight, so the sky alone never reads as dusk:
    // the look's own night flag lights the windows, as it does for the kit towns.
    // (`skyLooks` is declared further down; the view first asks once the frame loop runs.)
    duskProvider: () => (skyLooks?.night ? 1 : duskFromSky(stylizedSurface?.skyView)),
    // The key light, sun or moon, that falls through the rooms' windows (SettlementWindowLight).
    sunlightProvider: () => {
      const sky = stylizedSurface?.skyView;
      return sky ? { direction: sky.sunDirectionValue, color: sky.directional.color, intensity: sky.directional.intensity } : null;
    } });
  resources.own(settlementView);
  terrainView.settlementView = settlementView;
  const settlementAmbience = new SettlementAmbience(audioBus);
// Inside a town, the sky light's ground bounce is its setts and earth, not meadow green.
const settlementGroundBounce = new SettlementGroundBounce(() => stylizedSurface?.skyView?.hemisphere ?? null);
  resources.own(settlementAmbience);
  if (stylizedSurface.reflections) stylizedSurface.reflections.revisionProvider = () => constructionSpatialIndex.revision;
  const roadsideDetailsUi = new RoadsideDetailsUi(roadsideDetails);
  resources.own(roadsideDetailsUi);
  const postProcessingFocus = new PostProcessingFocusResolver({
    terrainView,
    playerController,
    editorController: controller,
    objectView,
    constructionView,
  });
  postProcessingController.focusDistanceProvider = (mode, camera, previousFocus) => (
    postProcessingFocus.resolve(mode, camera, previousFocus)
  );
  controller.onDocumentLoaded = (reason) => {
    const resetReason = POST_PROCESSING_RESET_REASONS[reason]
      ?? POST_PROCESSING_RESET_REASONS.WORLD_LOADED;
    postProcessingController.invalidate(resetReason);
  };
  controller.focusProvider = () => {
    const renderFocus = viewModeController.getFocusWorld();
    return floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
  };
  controller.cameraProvider = () => viewModeController.camera;
  controller.playerEditingProvider = () => viewModeController.paused;
  controller.editPreviewsAllowedProvider = () => (
    viewModeController.mode === PLAYER_MODE_EDIT && !viewModeController.awaitingSpawn
  );
  viewModeController.onPausedEditing = () => controller.selectTool('construction');
  viewModeController.onLeaveOrbitEditing = () => controller.clearHoverPreviews();
  viewModeController.onBeforeFreeFly = () => {
    controller.finishStroke();
    controller.cancelBlockedWorldInteraction();
  };
  playerController.constructionGround = new ConstructionGroundProvider({
    store: constructionStore,
    spatialIndex: constructionSpatialIndex,
    terrainView,
  });
  controller.constructionPalette = new ConstructionPaletteController({
    host: ui.viewport,
    controller,
    materialStore: constructionMaterialStore,
    onStatus: (message) => controller.emitNotice(message),
  });
  controller.constructionGizmo = new ConstructionGizmoController({
    host: ui.viewport,
    controller,
    palette: controller.constructionPalette,
    onStatus: (message) => controller.emitNotice(message),
  });

  const escapeStack = new EscapeStack();
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionGizmo?.isGridOpen) return false;
    controller.constructionGizmo.closeGrid();
    return true;
  }, { label: 'openings grid' });
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionPalette?.isOpen) return false;
    controller.constructionPalette.close();
    return true;
  }, { label: 'construction palette' });
  escapeStack.register(ESCAPE_PRIORITY.palette, () => {
    if (!controller.constructionGizmo?.isOpen) return false;
    controller.constructionGizmo.close();
    return true;
  }, { label: 'construction gizmo' });
  escapeStack.register(ESCAPE_PRIORITY.inspector, () => {
    if (!controller.constructionPalette?.isInspectorOpen) return false;
    controller.constructionPalette.closeInspector();
    return true;
  }, { label: 'construction inspector' });
  escapeStack.register(ESCAPE_PRIORITY.activeDrag, () => {
    if (!controller.constructionDrawing && !controller.constructionAnchorDrag
      && !controller.constructionGizmo?.directDrag) return false;
    controller.cancelConstructionGesture();
    controller.emitState();
    return true;
  }, { label: 'construction gesture' });
  escapeStack.register(ESCAPE_PRIORITY.selection, () => {
    if (!controller.selectedConstructionId && !controller.selectedObjectId) return false;
    controller.setSelectedConstruction(null);
    controller.setSelectedObject(null);
    controller.selectedAnchorId = null;
    controller.emitState();
    return true;
  }, { label: 'selection' });
  escapeStack.register(ESCAPE_PRIORITY.freeFlight, () => !viewModeController.cameraOverride && viewModeController.stopFreeFly(), { label: 'free flight' });
  escapeStack.register(ESCAPE_PRIORITY.playerPaused, () => {
    if (!viewModeController.paused) return false;
    viewModeController.setMode(PLAYER_MODE_EDIT);
    return true;
  }, { label: 'leave paused editing' });
  escapeStack.register(ESCAPE_PRIORITY.playerWalking, () => viewModeController.pause(), {
    label: 'pause into editing',
  });
  gameplayOverlayController.subscribe((state) => {
    if (state.activeOverlay != null) {
      controller.cancelBlockedWorldInteraction();
    }
  });

  const sceneSettingsRuntime = new SceneSettingsRuntime({
    controller,
    biomeAssetPalette,
    godRays: terrainView.godRays,
    postProcessingStore,
    config,
    boot: bootSceneSettings,
    resolveAzgaarOptions: (summary) => ui.resolveAzgaarImportOptions(summary),
    afterMapLoad: async (worldDocument) => {
      ui.syncImportedBiomeTiles(worldDocument);
      ui.minimapCenter = controller.getFocusCell?.() ?? ui.minimapCenter;
      ui.updateMinimap();
    },
  });
  sceneSettingsRuntime.onSceneReload = (document, url) => {
    sceneReloadPending = true;
    ui.showSceneReload(
      'Reloading for the world look',
      document?.name ?? (url ? assetFileName(url) : ''),
    );
  };
  controller.sceneSettingsProvider = () => sceneSettingsRuntime.capture();
  roadsideDetailsUi.attachRenderingSettings(sceneSettingsRuntime);
  controller.sceneSettingsConsumer = (document) => {
    sceneSettingsRuntime.applyVisualSettings(document);
    ui.syncGodRaysSettings(terrainView.godRays.getSettings());
  };
  ui.bind(controller);
  ui.attachSceneSettings(sceneSettingsRuntime).catch((error) => {
    ui.showToast(`Settings library unavailable: ${error.message}`, true);
  });
  if (bootSceneSettingsError) {
    ui.showToast(
      `Requested world look ignored: ${bootSceneSettingsError.message}`,
      true,
    );
  }
  if (window.location.search.includes('qaRecovery=1')) console.log('Recovery boot: document');
  boot.start('map');
  try {
    if (restoreState) await startup.wait(controller.loadDocument(restoreState.document, { loadReason: 'renderer-recovery' }));
    else await startup.wait(sceneSettingsRuntime.applyInitialRuntime());
  } catch (error) {
    startup.throwIfLost();
    sceneReloadPending = false;
    ui.failSceneReload(error);
    boot.fail(error);
    ui.showToast(`Preset map not loaded: ${error.message}`, true);
  }
  if (sceneReloadPending) {
    stylizedSurface.ready?.catch?.(() => {});
    stylizedSurface.bakeRequest?.catch?.(() => {});
    return;
  }
  ui.syncGodRaysSettings(terrainView.godRays.getSettings());
  const proceduralWorkshop = new ProceduralWorkshopUi({
    root,
    manager: proceduralAssetManager,
    onBaked: (record) => {
      controller.selectObjectDefinition(record.key);
      ui.showToast(`${record.label} is ready to place from Objects.`);
    },
  });
  resources.own(proceduralWorkshop);
  ui.attachWorkshop(proceduralWorkshop);
  const sceneLabel = (preset) => {
    const label = SKY_PRESETS[preset]?.label ?? '';
    return preset === 'configured' || preset === DEFAULT_SKY_PRESET
      ? 'Drusniel World'
      : label.replace(/\s*\(.*\)\s*$/, '');
  };
  const playerVitals = new PlayerVitals();
  const viewModeUi = new ViewModeUi({
    root,
    controller: viewModeController,
    hud: {
      vitals: playerVitals,
      minimap: createHudMinimapSource({
        ui, controller, tileMap, getBaseTerrain: () => worldMapController.getBaseTerrain(),
      }),
      getRenderer: () => terrainView.renderer,
      // The time of day titles the legend, as the donor's scene preset did:
      // "Emberfall (golden hour)" reads as "Emberfall". Read lazily — the sky
      // looks are built after the HUD.
      getSceneLabel: () => sceneLabel(skyLooks?.preset),
    },
  });
  resources.own(viewModeUi);

  let farViewActive = false;
  const applyViewDistance = (active) => {
    const view = active && farView ? farView : nearView;
    for (const camera of [editorCamera.camera, playerController.camera]) {
      camera.far = view.farPlane;
      camera.updateProjectionMatrix();
    }
    stylizedSurface.setViewDistance({ skyRadius: view.skyRadius, fogDensity: view.fogDensity });
  };
  applyViewDistance(false);

  const voxelPrototype = new GpuVoxelWorld({
    terrainView,
    layout: voxelWorldLayout,
    stampStore: voxelStampStore,
  });
  resources.own(voxelPrototype);
  const voxelPrototypeUi = new VoxelPrototypeUi({
    root,
    prototype: voxelPrototype,
    controller,
    stampStore: voxelStampStore,
  });
  resources.own(voxelPrototypeUi);
  const voxelStatus = await startup.wait(voxelPrototype.initialize({ x: 0, z: 0 }));
  voxelPrototypeUi.render();
  if (voxelStatus.code === 'failed') {
    console.error('GPU voxel world failed to initialize.', voxelStatus.error);
  }

  await startup.wait(stylizedSurface.ready);
  assetStartupTelemetry.markAssetsReady();
  await startup.wait(roadsideDetails.initialize());

  const weatherSettings = {
    weatherMode: config.weather?.mode ?? 'off',
    weatherIntensity: config.weather?.intensity ?? 0.7,
    weatherWindX: config.weather?.windX ?? -0.42,
    weatherWindZ: config.weather?.windZ ?? 0.18,
  };
  const weatherEnabled = config.weather?.enabled !== false;
  // One advected gust field for everything that sways, rendered once per frame
  // into a small camera-centred texture (docs/plans/grass-test-merge-plan-2026-09-24.md §4.1).
  const worldWind = new WorldWindPass({
    config: config.weather?.windField ?? {},
    defaultDirection: config.stylizedSurface?.wind?.direction ?? [1, 0],
  });
  resources.own(worldWind);
  let lastWindTimestamp = null;
  const waterVisual = config.stylizedSurface.water;
  configureSea(waterVisual.enabled !== false && resolveWaterQualityFeatures(waterVisual).flow
    ? waterVisual.sea
    : null);
  // Every weather reader below takes this frame's eased storm channels.
  const calmStorm = StormState.emptyFrame();
  const stormFrame = () => weatherController?.storm ?? calmStorm;
  // How stormy the sea is: wind roughens it, the top of the storm fully.
  const seaStormForWeather = () => {
    const storm = stormFrame();
    return Math.min(1, storm.wind * (0.5 + 0.5 * Math.min(1, Math.max(0, (storm.storm - 0.5) * 2))));
  };
  const fallSites = createRiverFallSiteSource(() => worldStore.generator);
  const waterfallMist = new WaterfallMist({
    scene: terrainView.scene,
    floatingOrigin: terrainView.floatingOrigin,
    getSites: fallSites,
    getSkyView: () => stylizedSurface.skyView ?? null,
    config: waterVisual.waterfall,
    enabled: waterVisual.enabled !== false && waterVisual.foam.enabled
      && resolveWaterQualityFeatures(waterVisual).foam,
  });
  resources.own(waterfallMist);
  // Rain on the ground and wind in the open, for the ambient beds; the sea
  // reads the same rain. Snow and lightning feed the storm beds and thunder.
  const weatherAudioLevelsScratch = { rain: 0, wind: 0.25, snow: 0, lightning: 0 };
  const weatherAudioLevels = () => {
    const storm = stormFrame();
    weatherAudioLevelsScratch.rain = Math.min(1, storm.rain);
    weatherAudioLevelsScratch.wind = Math.max(0.25, storm.wind);
    weatherAudioLevelsScratch.snow = Math.min(1, storm.snow);
    weatherAudioLevelsScratch.lightning = storm.lightning;
    return weatherAudioLevelsScratch;
  };
  const surfaceWetness = new SurfaceWetness(config.stylizedSurface.wetness);
  const snowCover = new SnowCover(config.stylizedSurface.snowCover);
  // A snapped storm (?stormSnap=1) shows the ground it leaves at steady state.
  const groundSnap = readStormOverride(typeof window === 'undefined' ? '' : window.location.search)?.snap === true;
  let lastWetnessSeconds = null;
  let lastBiomeSurfaceSeconds = null;
  // Time of day, greyed by the weather; the far haze follows the fog colour.
  const skyLooks = stylizedSurface.skyView
    ? new SkyLookController({
      skyView: stylizedSurface.skyView,
      preset: storedSkyPreset ?? undefined,
      onLook: (look) => macroFarTerrain.setFogColor(look.fogColor),
    })
    : null;
  // The animated clock, when a world turns it on: it only chooses a time preset,
  // which the sky eases in, so the sky stays the one lighting authority. Disabled
  // or paused it is a no-op, and the manual Time selector and capture tools that
  // set the lights directly keep their look.
  const skyCycleConfig = config.stylizedSurface?.sky?.cycle;
  const dayNightCycle = skyLooks && skyCycleConfig?.enabled
    ? new DayNightCycle({
      hour: skyCycleConfig.hour,
      dayLengthSeconds: skyCycleConfig.dayLengthSeconds,
      latitudeDegrees: skyCycleConfig.latitudeDegrees,
      paused: skyCycleConfig.paused,
    })
    : null;
  const fallingLeavesOrigin = { x: 0, z: 0 };
  const snowCountryOrigin = { x: 0, z: 0 };
  const soundscapeOrigin = { x: 0, z: 0 };
  const weatherOrigin = { x: 0, z: 0 };
  const fallingLeaves = new FallingLeaves({
    scene: terrainView.scene,
    config: config.stylizedSurface.fallingLeaves,
    foliageConfig: config.stylizedSurface,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getOrigin: () => terrainView.floatingOrigin.readState(fallingLeavesOrigin),
    getForestField: () => stylizedSurface.treeView?.manifestStore?.forestField ?? null,
    getSettlementField: () => worldStore.generator?.ensureSettlementField?.() ?? null,
  });
  resources.own(fallingLeaves);
  const snowCountry = new SnowCountryWeight({
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getOrigin: () => terrainView.floatingOrigin.readState(snowCountryOrigin),
    getGroundHeight: (x, z) => terrainView.getCanonicalHeight(x, z),
    snowLine: config.stylizedSurface.materialBake.classification.snowLine,
    snowFade: config.stylizedSurface.materialBake.classification.snowFade,
    looks: config.stylizedSurface.biomeLooks,
  });
  // Each part of the map gets its own air: biomes kilometres out set the region's
  // sky, the ground close by only nudges it (stylized/sky/skyRegionClimate.js).
  const skyRegion = new SkyRegionSampler({
    getBiome: (cellX, cellZ) => {
      const generator = worldStore.generator;
      return generator?.sampleBiome?.(cellX, cellZ) ?? generator?.sampleTile?.(cellX, cellZ) ?? null;
    },
    getTileSize: () => config.map.tileSize,
    getOrigin: () => terrainView.floatingOrigin.getState(),
    getGroundHeight: (x, z) => terrainView.getCanonicalHeight(x, z),
    getSeaLevel: () => worldStore.generator?.seaLevel ?? 0,
    getSeed: () => worldStore.generator?.toMetadata?.().seed ?? 0,
  });
  const worldAmbience = new WorldAmbience({
    settings: config.stylizedSurface.ambientEffects,
    terrainView,
    getGenerator: () => worldStore.generator,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    tileSize: config.map.tileSize,
    skyView: stylizedSurface.skyView ?? null,
    defaultWindDirection: config.stylizedSurface?.wind?.direction ?? [1, 0],
    snowLine: config.stylizedSurface.materialBake.classification.snowLine,
  });
  resources.own(worldAmbience);
  const snowPowder = new SnowPowderKicks({
    scene: terrainView.scene,
    config: config.stylizedSurface.snowPowder,
    sunDirection: terrainView.godRays.sunDirection,
  });
  resources.own(snowPowder);
  const worldSoundscape = new WorldSoundscape({
    audioBus,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
    getSeaLevel: () => worldStore.generator?.seaLevel ?? 0,
    getOrigin: () => terrainView.floatingOrigin.readState(soundscapeOrigin),
    getWeather: weatherAudioLevels,
    isNight: () => Boolean(skyLooks?.night),
    getWaterKind: (x, z) => worldStore.generator?.sampleWater?.(x / config.map.tileSize, -z / config.map.tileSize)?.kind ?? 0,
    getSnowCountry: () => snowCountry.value,
    isUnderwater: () => viewModeController.mode === PLAYER_MODE_WALK
      && playerController.isHeadSubmerged(),
    getFallSites: fallSites,
    getCollisionWorld: () => playerController.collisionRuntime?.world ?? null,
    getGust: () => {
      const { position } = viewModeController.camera;
      return worldWind.sample(position.x, position.z).gust;
    },
  });
  resources.own(worldSoundscape);
  const waterInteraction = resources.own(new WaterInteractionSurface({ terrainView,
    player: playerController, config: config.stylizedSurface.water,
    rippleField: new RippleField({ renderer: terrainView.renderer }) }));
  // How the region's water ripples and its ground takes prints (biome-looks `ripples`, `prints`).
  const biomeSurface = new BiomeSurfaceResponse({
    surface: config.stylizedSurface.biomeLooks.surface,
    getTile: (cellX, cellZ) => worldStore.getTile(cellX, cellZ),
    getTileSize: () => config.map.tileSize,
  });
  const biomeSurfaceOrigin = {};
  const pressSpellSurface = createSpellSurfacePress({
    water: waterInteraction,
    getOrigin: () => terrainView.floatingOrigin.readState(biomeSurfaceOrigin),
    stampDisc,
    now: () => performance.now() / 1000,
  });
  const weatherController = weatherEnabled
    ? createWeatherController({
      scene: terrainView.scene,
      camera: viewModeController.camera,
      isWebGpu: true,
      worldCells: 1e9,
      samplers: createWeatherTerrainSamplers(terrainView),
      effects: config.weatherEffects,
      getOrigin: () => terrainView.floatingOrigin.readState(weatherOrigin),
      getSettings: () => weatherSettings,
      getCamera: () => viewModeController.camera,
      getSunDirection: () => stylizedSurface.skyView?.sunDirectionValue ?? undefined,
      stormOverride: readStormOverride(typeof window === 'undefined' ? '' : window.location.search),
    })
    : null;
  resources.own(weatherController);
  // Thunder follows each strike from where its flash was.
  weatherController?.lightning?.subscribe?.((strike) => worldSoundscape.strike(strike));
  if (weatherController && weatherSettings.weatherMode !== 'off') {
    postProcessingController.notifyReactive(
      POST_PROCESSING_REACTIVE_EVENTS.WEATHER_STARTED,
    );
  }

  const heroStorage = (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })();
  const createHeroView = (heroId) => createCharacterView({
    scene: terrainView.scene,
    terrain: characterGround,
    sunDirection: terrainView.godRays.sunDirection,
    config: {
      ...(config.character ?? {}),
      hero: heroId,
      runSpeed: config.player.walkSpeed * config.player.runMultiplier,
    },
    getWeatherSettings: () => ({
      enabled: weatherEnabled && weatherSettings.weatherMode !== 'off',
      intensity: weatherSettings.weatherIntensity,
      windX: weatherSettings.weatherWindX,
      windZ: weatherSettings.weatherWindZ,
    }),
    loader: stylizedSurface.sceneAssets?.loader ?? null,
    renderer: terrainView.renderer,
    baseUrl: import.meta.env.BASE_URL,
  });
  const characterView = characterEnabled
    ? new SwitchableCharacterView({
      createView: createHeroView,
      heroId: resolveHeroPreference(config.character, {
        search: window.location.search,
        storage: heroStorage,
      }),
    })
    : null;
  resources.own(characterView);
  // Footfalls sound once the hero's stride lands them; the variant alternates
  // by foot and cycles so a run of steps never repeats one sound exactly.
  let footstepCount = 0;
  // What a foot lands on, for its sound: the same snow the terrain draws, the
  // tile's biome, and the beach band above the sea.
  const footstepSurface = (footstep, canonicalX, canonicalZ) => {
    const tileSize = config.map.tileSize;
    const generator = worldStore.generator;
    const bake = config.stylizedSurface.materialBake;
    const cellX = Math.floor(canonicalX / tileSize);
    const cellZ = Math.floor(-canonicalZ / tileSize);
    const tileId = worldStore.getTile(cellX, cellZ);
    const snow = snowAtPoint({
      height: footstep.y,
      slope: 0,
      dx: 0,
      dz: 0,
      curvature: 0,
      tileId,
      biomeCover: snowBiomeCoverAt((x, z) => worldStore.getTile(x, z), cellX, cellZ, bake.classification.snowBiomeCover, config.stylizedSurface.path?.tileId ?? 13),
      worldX: canonicalX,
      worldZ: canonicalZ,
    }, bake.classification, terrainBakeMacroSeed(bake.macro.seedOffset, generator?.toMetadata?.().seed));
    return classifyFootstepSurface({
      inWater: footstep.surface === 'water',
      tileId,
      heightAboveSea: footstep.y - (generator?.seaLevel ?? 0),
      snow,
    });
  };
  // The walking body in canonical metres, for the deep-snow wake; null when the
  // wake is off or nobody is walking, which only ages the trail already laid.
  const snowWakeEnabled = config.stylizedSurface?.snowWake?.enabled === true;
  // Read every frame, so both objects are reused rather than rebuilt.
  const snowWakeFooting = { x: 0, z: 0, footY: 0, grounded: false, waterState: PLAYER_WATER_DRY };
  const snowWakeOrigin = { x: 0, z: 0 };
  const snowWakeBodyScratch = { x: 0, y: 0, z: 0, grounded: false, inWater: false };
  const snowWakeBody = () => {
    if (!snowWakeEnabled || viewModeController.mode !== PLAYER_MODE_WALK) return null;
    const footing = playerController.readFooting(snowWakeFooting);
    const origin = terrainView.floatingOrigin.readState(snowWakeOrigin);
    snowWakeBodyScratch.x = footing.x + origin.x;
    snowWakeBodyScratch.y = footing.footY;
    snowWakeBodyScratch.z = footing.z + origin.z;
    snowWakeBodyScratch.grounded = footing.grounded;
    snowWakeBodyScratch.inWater = footing.waterState !== PLAYER_WATER_DRY;
    return snowWakeBodyScratch;
  };
  const detachFootsteps = characterView?.onFootstep((footstep) => {
    footstepCount += 1;
    const origin = terrainView.floatingOrigin.getState();
    const canonicalX = footstep.x + origin.x;
    const canonicalZ = footstep.z + origin.z;
    if (footstep.surface !== 'water') {
      stampFootprint(canonicalX, canonicalZ, footstep.facing ?? 0);
    }
    const surface = footstepSurface(footstep, canonicalX, canonicalZ);
    if (surface === 'snow') snowPowder.kick(footstep);
    emitAudio(`player.footstep.${surface}`, {
      variant: (footstepCount % 3) + (footstep.foot === 'left' ? 0 : 0.5),
    });
  }) ?? null;
  const heroSelectUi = characterView
    ? new HeroSelectUi({
      root,
      heroes: [
        ...Object.entries(config.character?.roster ?? {}).map(([id, entry]) => ({
          id,
          name: entry.name ?? id,
          title: entry.title,
        })),
        { id: PROCEDURAL_HERO_ID, name: 'Drow', title: 'Procedural, cloth-simulated' },
      ],
      heroId: characterView.heroId,
      onSelect: async (heroId) => {
        const swapped = await characterView.setHero(heroId);
        if (swapped) storeHeroPreference(heroId, heroStorage);
        return swapped;
      },
    })
    : null;
  resources.own(heroSelectUi);
  resources.defer(() => { detachFootsteps?.(); });
  characterView?.setVisible(false);
  const characterInFirstPerson = config.character?.visibleInFirstPerson !== false;
  const weatherUi = weatherEnabled
    ? createWeatherUi({
      root,
      settings: weatherSettings,
      timePresets: skyLooks
        ? Object.entries(SKY_PRESETS).map(([value, preset]) => ({ value, label: preset.label }))
        : null,
      timePreset: skyLooks?.preset,
      onTimeChange: (preset) => {
        // With the clock running, a time-of-day preset moves the clock to its
        // hour; any other look (meadow, glade…) stops the clock on it.
        const anchor = TIME_PRESET_ANCHORS.find((entry) => entry.preset === preset);
        if (dayNightCycle && anchor) {
          dayNightCycle.setHour(anchor.hour);
          dayNightCycle.setPaused(false);
        } else {
          dayNightCycle?.setPaused(true);
        }
        skyLooks?.setPreset(preset);
        try {
          window.localStorage.setItem(SKY_PRESET_STORAGE_KEY, preset);
        } catch {
          // Private windows keep the choice for this session only.
        }
      },
      onChange: (next) => {
        const previousMode = weatherSettings.weatherMode;
        Object.assign(weatherSettings, next);
        weatherController?.applySettings();
        if (weatherSettings.weatherMode !== 'off'
            && weatherSettings.weatherMode !== previousMode) {
          postProcessingController.notifyReactive(
            POST_PROCESSING_REACTIVE_EVENTS.WEATHER_STARTED,
          );
        }
      },
    })
    : null;
  resources.own(weatherUi);

  const spellsEnabled = config.spells?.enabled !== false;
  const spellRuntime = spellsEnabled
    ? createSpellRuntime({
      vitals: playerVitals,
      scene: terrainView.scene,
      getCamera: () => viewModeController.camera,
      isWalkMode: () => viewModeController.mode === PLAYER_MODE_WALK,
      subscribeViewMode: (listener) => viewModeController.subscribe(listener),
      isInputBlocked: () => gameplayOverlayController.isWorldInputBlocked(),
      raycastTerrain: (ray, maxRange) => raycastTerrainHeightfield(terrainView, ray, maxRange),
      // The grimoire's procedural VFX: terrain contact, origin snaps, sun and caster.
      groundHeight: (x, z) => terrainView.getWorldHeight(x, z),
      subscribeOriginShift: (listener) => terrainView.floatingOrigin.subscribe(listener),
      pressGround: (x, z, radius, strength, inner) => {
        stylizedSurface.meadowGrass?.spellGround?.pressDisc(x, z, radius, strength, inner);
        // Beyond the meadow: a ring wave on nearby water, a crater in snow and sand.
        pressSpellSurface(x, z, radius, strength, inner);
      },
      // Scorched, frosted or withered blades: the meadow carries the spell's mark.
      markGround: (x, z, radius, mark, strength, inner) => {
        const kind = GRASS_MARK[String(mark).toUpperCase()];
        if (kind !== undefined) stylizedSurface.meadowGrass?.spellGround?.markDisc(x, z, radius, kind, strength, inner);
      },
      getSceneLights: () => ({
        directional: stylizedSurface.skyView?.directional ?? null,
        hemisphere: stylizedSurface.skyView?.hemisphere ?? null,
      }),
      getCasterFeet: () => {
        const status = viewModeController.getPlayerFrameStatus();
        if (!status) return null;
        return {
          x: status.position.x,
          y: Number.isFinite(status.footY) ? status.footY : status.position.y,
          z: status.position.z,
        };
      },
      onCast: () => {
        postProcessingController.notifyReactive(
          POST_PROCESSING_REACTIVE_EVENTS.SPELL_STARTED,
        );
        characterView?.beginCastAlongCamera(
          SPELL_CAST_POSE_MS,
          viewModeController.camera,
          performance.now(),
        );
      },
      registerKeys: false,
    })
    : null;
  resources.own(spellRuntime);
  // Swamp gas catching on bog islands, through the grimoire's VFX (stylized/bog/BogVents.js).
  const bogVents = spellRuntime?.effects
    ? createBogVents({ vfx: spellRuntime.effects, terrainView, tileIds: config.waterDomain.bog?.tileIds ?? [] })
    : null;
  spellKeyHandler = spellRuntime
    ? (event) => spellRuntime.handleKeyDown(event)
    : null;
  // Azgaar burgs as walkable kit towns (src/editor/towns), when opted in.
  const townWalkerFooting = { x: 0, z: 0, footY: 0, grounded: false, waterState: PLAYER_WATER_DRY };
  const townWalker = { x: 0, y: 0, z: 0 };
  const townFocus = { x: 0, y: 0, z: 0 };
  const townRuntime = kitTowns ? createTownRuntime({
    terrainView,
    getGenerator: () => worldStore.generator,
    tileSize: config.map.tileSize,
    baseUrl: import.meta.env.BASE_URL,
    // Same snow the terrain draws, so a town in snowy country gets the frost skin.
    sampleSnow: (canonicalX, canonicalZ, height, tileId) => {
      const bake = config.stylizedSurface.materialBake;
      const tileSize = config.map.tileSize;
      return snowAtPoint({
        height,
        slope: 0,
        dx: 0,
        dz: 0,
        curvature: 0,
        tileId,
        biomeCover: snowBiomeCoverAt((x, z) => worldStore.getTile(x, z), Math.floor(canonicalX / tileSize),
          Math.floor(-canonicalZ / tileSize), bake.classification.snowBiomeCover, config.stylizedSurface.path?.tileId ?? 13),
        worldX: canonicalX,
        worldZ: canonicalZ,
      }, bake.classification, terrainBakeMacroSeed(bake.macro.seedOffset, worldStore.generator?.toMetadata?.().seed));
    },
    getFocusCanonical: () => {
      viewModeController.readFocusWorld(townFocus);
      return floatingOrigin.toCanonical(townFocus.x, townFocus.z);
    },
    // Night skies light the world with the moon; windows still need to know it is night.
    isNight: () => Boolean(skyLooks?.night),
    getWalkerCanonical: () => {
      if (viewModeController.mode !== PLAYER_MODE_WALK || viewModeController.paused) return null;
      if (gameplayOverlayController.isWorldInputBlocked()) return null;
      const footing = playerController.readFooting(townWalkerFooting);
      const canonical = floatingOrigin.toCanonical(footing.x, footing.z);
      townWalker.x = canonical.x;
      townWalker.y = footing.footY;
      townWalker.z = canonical.z;
      return townWalker;
    },
  }) : null;
  if (townRuntime) {
    terrainView.townRuntime = townRuntime;
    resources.own(townRuntime);
    townKeyHandler = (event) => townRuntime.handleKey(event);
  }
  if (import.meta.env.DEV) {
    window.__editor = {
      controller,
      playerHud: viewModeUi.hud,
      objectMap,
      objectView,
      godsEndAssets,
      roadsideDetails,
      settlementView,
      towns: townRuntime,
      settlementAmbience,
      worldMapController,
      gameplayOverlayController,
      inventoryController,
      inventoryStore,
      inventoryUi,
      config,
      ui,
      proceduralWorkshop,
      constructionStore,
      constructionView,
      constructionSpatialIndex,
      godRays: terrainView.godRays,
      stylizedSurface,
      sceneSettingsRuntime,
      terrainView,
      viewModeController,
      cameraCutCoordinator,
      playerController,
      thirdPersonCamera,
      characterView,
      worldWind,
      waterfallMist,
      worldSoundscape,
      surfaceWetness,
      skyLooks,
      fallingLeaves,
      snowPowder,
      worldAmbience,
      groundDeformation: { stampFootprint, stampDisc, readDeformationTexel, groundDeformationUniforms },
      waterInteraction,
      biomeSurface,
      weatherSettings,
      weatherController,
      spellRuntime,
      postProcessingStore,
      applyPostProcessingCaptureMode(mode = {}) {
        if (mode.weather && weatherSettings && weatherController) {
          weatherSettings.weatherMode = mode.weather;
          weatherSettings.weatherIntensity = Math.max(
            weatherSettings.weatherIntensity,
            1.1,
          );
          weatherController.applySettings({ snap: true });
        }
        if (mode.night && stylizedSurface?.skyView?.directional) {
          stylizedSurface.skyView.directional.intensity = Math.min(
            stylizedSurface.skyView.directional.intensity,
            0.08,
          );
          if (stylizedSurface.skyView.hemisphere) {
            stylizedSurface.skyView.hemisphere.intensity = Math.min(
              stylizedSurface.skyView.hemisphere.intensity,
              0.12,
            );
          }
        }
        if (mode.spell && spellRuntime?.cast) {
          spellRuntime.cast('fire');
          spellRuntime.cast('water');
        }
      },
    };
  }
  if (perfQaConfig?.scenarioId === 'object-town') {
    createObjectTownQaScene({
      target: perfQaConfig.buildingCount,
      proceduralAssetManager,
      objectMap,
      objectView,
    });
  }

  releaseAssetProgress();
  if (window.location.search.includes('qaRecovery=1')) console.log('Recovery boot: prewarm');
  boot.start('prewarm', 'Compiling shaders — this is the long one');
  let finishWaterPrewarm = null;
  try {
    await startup.wait(spellRuntime?.precompile?.(terrainView.renderer));
    stylizedSurface.prewarmStreamingResources(terrainView.renderer);
    finishWaterPrewarm = stylizedSurface.beginWaterRefractionPrewarm();
    await startup.wait(assetStartupTelemetry.trace.measure('warmup.initialScene', () => terrainView.renderer.compileAsync(terrainView.scene, editorCamera.camera)));
    if (finishWaterPrewarm) {
      terrainView.renderer.render(terrainView.scene, editorCamera.camera);
    }
    worldWind.update(0, editorCamera.camera.position, terrainView.floatingOrigin.getState(), null);
    worldWind.render(terrainView.renderer);
    await startup.wait(characterView?.prewarm(terrainView.renderer, playerController.camera));
    await startup.wait(postProcessingController.precompile(playerController.camera));
    terrainView.prewarmPostProcessing(playerController.camera);
    assetStartupTelemetry.trace.measureSync('warmup.actualPass', () => withPreparationFrame(terrainView.renderer, null,
      () => withSceneWarmup(terrainView.scene, () => terrainView.prewarmPostProcessing(playerController.camera))));
    postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.MANUAL_RESET);
    assetStartupTelemetry.trace.measureSync('warmup.waterCaptures', () => stylizedSurface.reflections?.prewarm(editorCamera.camera, stylizedSurface));
  } catch (error) {
    startup.throwIfLost();
    console.warn('Render pipeline pre-warm failed; pipelines will compile on demand.', error);
  } finally {
    finishWaterPrewarm?.();
  }
  const deferredWork = new DeferredWorkBudget(config.exploration.frameBudget);
  deferredWork.attachSurface(stylizedSurface);
  const drawPreparation = new StreamedDrawPreparation({ scene: terrainView.scene, renderer: terrainView.renderer,
    settings: config.exploration.drawPreparation, render: camera => terrainView.prewarmPostProcessing(camera),
    invalidateHistory: () => postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.MANUAL_RESET) });
  resources.own(drawPreparation);
  drawPreparation.markInitialScene(); terrainView.drawPreparation = drawPreparation;
  const exploration = new ExplorationRuntime({ config, terrainView, viewModeController, container: ui.viewport,
    sceneLoader: stylizedSurface.sceneAssets?.loader,
    onInstalled: (root) => drawPreparation.register(root),
    invalidateHistory: () => postProcessingController.invalidate(POST_PROCESSING_RESET_REASONS.ACTIVE_CAMERA_REPLACED) });
  resources.own(exploration);
  if (import.meta.env.DEV && window.__editor) Object.assign(window.__editor, { exploration, deferredWork, drawPreparation });
  if (restoreState) await startup.wait(restoreEditorRecoveryState(restoreState, { controller, editorCamera, playerController, viewModeController, proceduralWorkshop }));
  boot.finish();

  if (perfQaConfig?.scenarioId === 'settlement-approach') {
    const { prepareSettlementApproach } = await import('./editor/performance/qa/SettlementApproachFixture.js');
    const burgId = Number(new URLSearchParams(window.location.search).get('burg')) || 18;
    terrainView.settlementQaRoute = await prepareSettlementApproach({ controller, terrainView, config, burgId });
  }
  if (perfQaConfig?.scenarioId === 'bog-cross') {
    const { prepareBogCross } = await import('./editor/performance/qa/BogCrossFixture.js');
    terrainView.settlementQaRoute = await prepareBogCross({ controller, terrainView, config });
  }
  // An explicit `?yaw=` frames a fixture route from another angle (visual captures).
  if (terrainView.settlementQaRoute && new URLSearchParams(window.location.search).has('yaw')) {
    delete terrainView.settlementQaRoute.yawDegrees;
    delete terrainView.settlementQaRoute.route;
  }
  const perfQa = PerfQaHarness.fromLocation({
    viewModeController,
    playerController,
    terrainView,
    objectView,
    stylizedSurface,
    voxelPrototype,
    editorConfig: config,
  });
  resources.own(perfQa);
  if (perfQa) {
    perfQa.mount(root);
    perfQa.publishApi();
    if (perfQa.config.autostart) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => perfQa.start());
      });
    }
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    terrainView.resize(width, height);
    viewModeController.resize(width, height);
  });
  resizeObserver.observe(ui.viewport);
  resources.defer(() => { resizeObserver.disconnect(); });

  let active = true;
  let nextFrameRateDisplayAt = 0;
  let nextStreamingStatusAt = 0;
  let nextPredictiveRefreshAt = 0;
  const onVisibilityChange = () => {
    if (!document.hidden) return;
    frameRateMeter.reset();
    frameRateDisplay.update(null);
    nextFrameRateDisplayAt = 0;
    nextPredictiveRefreshAt = 0;
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  resources.defer(() => { document.removeEventListener('visibilitychange', onVisibilityChange); });

  if (import.meta.env.DEV && window.__editor) {
    window.__editor.skyRegion = skyRegion;
    window.__editor.skyLooks = skyLooks;
    window.__editor.dayNightCycle = dayNightCycle;
  }

  let lastWeatherTimestamp = null;
  let lastCharacterTimestamp = null;
  const characterCentre = { x: 0, y: 0, z: 0 };
  const renderFocusScratch = { x: 0, z: 0 };
  const canonicalFocusScratch = { x: 0, z: 0 };
  const frameOriginScratch = { x: 0, z: 0 };
  const playerBodyScratch = { x: 0, y: 0, z: 0 };
  ui.minimapBudget = deferredWork;
  terrainView.minimapPreparation = ui;
  terrainView.queryWorkBudget = deferredWork;
  terrainView.setAnimationLoop((timestamp) => {
    if (!active) return;

    const frameTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    // Every frame starts on the canvas. three r187's compileAsync puts back the
    // target and MRT it was called under each time it yields to the main thread,
    // so a compile into an offscreen target (the settlement surface baker) left
    // that target bound through ordinary frames: every post pass drew into it,
    // failed validation, and towns rendered nothing but terrain.
    terrainView.renderer.setRenderTarget(null);
    terrainView.renderer.setMRT?.(null);
    deferredWork.beginFrame();
    const profiling = perfQa?.beginFrame(frameTimestamp) ?? false;
    drawPreparation.beginFrame(deferredWork);
    // Terrain pages unblock collision and scenery dependencies. Spend their
    // existing shared allowance before optional preparation can consume its floor.
    if (terrainView.commitQueue.size > 0) {
      const commitBudgetMs = deferredWork.available(terrainView.commitQueue.commitBudgetMs);
      if (commitBudgetMs > 0) {
        deferredWork.run(() => terrainView.flushUploadQueue({
          maxCommits: terrainView.adaptiveCommitBudget(),
          budgetMs: commitBudgetMs,
        }));
      }
    }
    if (profiling) perfQa.mark('terrainCommit');
    ui.advanceMinimap(deferredWork);
    exploration.beforeMovement(frameTimestamp);
    // Optional roadside dressing gets one budget-gated turn near the start of the frame.
    // Its own revision gate makes unchanged frames effectively free.
    if (roadsideDetails.enabled) {
      deferredWork.tryRun(() => roadsideDetails.update(viewModeController.camera), 0.5);
    }
    deferredWork.run(() => stylizedSurface.beginFrame(frameTimestamp));
    if (profiling) perfQa.mark('placementPreparation');
    const averageFps = frameRateMeter.record(frameTimestamp);
    if (frameTimestamp >= nextFrameRateDisplayAt) {
      frameRateDisplay.update(averageFps);
      ui.updateGrassBladeReadout({
        clumps: PerfCounters.get('grassLastChunkClumps'),
        blades: PerfCounters.get('grassLastChunkEffectiveBlades'),
        triangles: PerfCounters.get('grassLastChunkTriangles'),
        fps: averageFps,
      });
      nextFrameRateDisplayAt = frameTimestamp + FRAME_RATE_DISPLAY_INTERVAL_MS;
    }

    constructionView.updateLod(viewModeController.camera, terrainView.viewportHeight);
    const constructionBudgetMs = constructionView.buildQueue.length > 0
      ? deferredWork.available(Number.POSITIVE_INFINITY)
      : 0;
    deferredWork.run(() => constructionView.update({
      budgetMs: constructionBudgetMs,
      shouldYield: deferredWork.shouldYield,
    }));
    PerfCounters.set('constructionModulesResident', constructionView.stats.modulesResident);
    PerfCounters.set('constructionModulesRebuilt', constructionView.stats.modulesRebuilt);
    PerfCounters.set('constructionModulesSkippedByHash', constructionView.stats.modulesSkippedByHash);
    PerfCounters.set('constructionQueueDepth', constructionView.stats.queueDepth);
    PerfCounters.set('constructionStones', constructionView.stats.stones);
    PerfCounters.set('constructionBuildMs', Math.round(constructionView.stats.buildMs));
    PerfCounters.set('constructionMaxBuildStepMs', constructionView.stats.maxBuildStepMs ?? 0);
    PerfCounters.set('constructionRecordsResident', constructionView.stats.recordsResident ?? 0);
    PerfCounters.set('constructionRecordsCandidates', constructionView.stats.recordsCandidates ?? 0);
    PerfCounters.set('constructionModulesNear', constructionView.stats.modulesNear);
    PerfCounters.set('constructionModulesCoarse', constructionView.stats.modulesCoarse);
    PerfCounters.set('constructionModulesShell', constructionView.stats.modulesShell);
    PerfCounters.set('constructionLodTransitions', constructionView.stats.lodTransitions);
    if (profiling) perfQa.mark('construction');

    if (import.meta.env.DEV) window.__worldVisualQa?.beforeMovement(frameTimestamp);
    viewModeController.update(frameTimestamp);
    ui.setMinimapHeading(viewModeController.getHeading());
    viewModeUi.update();
    if (profiling) perfQa.mark('player');

    const framePlayerStatus = viewModeController.getPlayerFrameStatus();
    const renderFocus = viewModeController.readFocusWorld(renderFocusScratch);
    const rebase = terrainView.updateFloatingOrigin(renderFocus);
    if (rebase) {
      PerfCounters.inc('floatingOriginSnaps');
      shiftWorldForOrigin(rebase);
      viewModeController.readFocusWorld(renderFocus);
    }
    if (profiling) perfQa.mark('floatingOrigin');
    townRuntime?.update(frameTimestamp, deferredWork);
    if (profiling) perfQa.mark('towns');

    if (characterView) {
      const walking = viewModeController.mode === PLAYER_MODE_WALK
        && !viewModeController.paused;
      // `captureHidden`: a visual QA capture keeps the player's body and shadow out of frame.
      const wantVisible = walking && !characterView.captureHidden
        && (viewModeController.isThirdPerson || characterInFirstPerson);
      if (characterView.visible !== wantVisible) characterView.setVisible(wantVisible);
      if (wantVisible) {
        const deltaSeconds = lastCharacterTimestamp === null
          ? 0
          : (frameTimestamp - lastCharacterTimestamp) / 1000;
        characterView.update(
          deltaSeconds,
          framePlayerStatus,
          frameTimestamp,
        );
      }
      lastCharacterTimestamp = wantVisible ? frameTimestamp : null;
      const occluding = wantVisible && viewModeController.isThirdPerson;
      if (occluding) {
        const footY = Number.isFinite(framePlayerStatus.footY)
          ? framePlayerStatus.footY
          : framePlayerStatus.position.y;
        characterCentre.x = framePlayerStatus.position.x;
        characterCentre.y = footY + characterView.height * 0.55;
        characterCentre.z = framePlayerStatus.position.z;
      }
      updateCharacterOcclusion({
        renderer: terrainView.renderer,
        camera: viewModeController.camera,
        target: occluding ? characterCentre : null,
        height: characterView.height,
        pixelScale: postProcessingController.graph?.sceneResolutionScale ?? 1,
        enabled: occluding,
      });
      if (profiling) perfQa.mark('character');
    }

    if (!deferredWork.shouldYield()) {
      deferredWork.run(() => macroFarTerrain.update(deferredWork.shouldYield));
    }
    const backdropActive = macroFarTerrain.isActive();
    if (profiling) perfQa.mark('farTerrain');
    if (backdropActive !== farViewActive) {
      farViewActive = backdropActive;
      applyViewDistance(backdropActive);
    }

    const canonicalFocus = floatingOrigin.writeCanonical(
      renderFocus.x,
      renderFocus.z,
      canonicalFocusScratch,
    );
    const forcePredictiveRefresh = frameTimestamp >= nextPredictiveRefreshAt;
    if (forcePredictiveRefresh) {
      nextPredictiveRefreshAt = frameTimestamp + TERRAIN_PREFETCH_REFRESH_MS;
    }
    try {
      terrainView.updateStreamingFrame(
        exploration.tour.preloadFocus() ?? canonicalFocus,
        frameTimestamp,
        forcePredictiveRefresh,
      );
    } catch (error) {
      console.error('Terrain streaming update failed.', error);
    }
    if (profiling) perfQa.mark('streaming');

    // The player's feet, in render space like the layers' own state, for the layers
    // that react to the body standing in them. A paused or non-walking view passes
    // null, which lets what the body pressed stand back up rather than freezing it.
    const bodyStatus = viewModeController.mode === PLAYER_MODE_WALK && !viewModeController.paused
      ? framePlayerStatus
      : null;
    const playerBody = bodyStatus ? playerBodyScratch : null;
    if (bodyStatus) {
      playerBody.x = bodyStatus.position.x;
      playerBody.y = Number.isFinite(bodyStatus.footY) ? bodyStatus.footY : bodyStatus.position.y;
      playerBody.z = bodyStatus.position.z;
    }
    stylizedSurface.workBudgetMs = deferredWork.peek(stylizedSurface.frameBudgetMs);
    stylizedSurface.update(frameTimestamp, viewModeController.camera, playerBody);
    exploration.update(frameTimestamp, canonicalFocus, playerBody, deferredWork);
    deferredWork.run(() => settlementView.update(canonicalFocus, frameTimestamp, deferredWork.shouldYield, viewModeController.camera));
    const nearestTown = settlementView.enabled ? settlementView.nearestTown(canonicalFocus) : null;
    settlementAmbience.update(frameTimestamp / 1000, nearestTown, Boolean(skyLooks?.night));
    settlementGroundBounce.update(nearestTown ?? townRuntime?.streamer.nearestTown(canonicalFocus) ?? null);
    if (profiling) perfQa.mark('stylized');

    if (weatherController) {
      const camera = viewModeController.camera;
      const effectCenter = camera.position;
      const deltaSeconds = lastWeatherTimestamp == null
        ? 0
        : Math.min(0.05, Math.max(0, (frameTimestamp - lastWeatherTimestamp) / 1000));
      lastWeatherTimestamp = frameTimestamp;
      weatherController.update(
        deltaSeconds,
        frameTimestamp * 0.001,
        camera.position,
        effectCenter,
      );
    }
    spellRuntime?.update(frameTimestamp);
    bogVents?.tick(frameTimestamp, canonicalFocus);
    if (profiling) perfQa.mark('weatherSpells');

    objectView.update(frameTimestamp, viewModeController.camera, deferredWork);
    if (profiling) perfQa.mark('objects');

    voxelPrototype.update(canonicalFocus);
    if (profiling) perfQa.mark('voxel');

    if (frameTimestamp >= nextStreamingStatusAt) {
      ui.renderStreamingStatus(terrainView.getStreamingStatus());
      nextStreamingStatusAt = frameTimestamp + 250;
    }
    for (const listener of streamingFrameListeners) listener();
    const windCamera = viewModeController.camera.position;
    const frameOrigin = terrainView.floatingOrigin.readState(frameOriginScratch);
    worldWind.update(
      lastWindTimestamp === null ? 0 : (frameTimestamp - lastWindTimestamp) / 1000,
      windCamera,
      frameOrigin,
      {
        enabled: weatherEnabled && weatherSettings.weatherMode !== 'off',
        windX: weatherSettings.weatherWindX,
        windZ: weatherSettings.weatherWindZ,
        intensity: weatherSettings.weatherIntensity,
        storm: stormFrame().wind,
      },
    );
    lastWindTimestamp = frameTimestamp;
    worldWind.render(terrainView.renderer);
    waterfallMist.update(frameTimestamp / 1000, viewModeController.camera);
    updateGroundDeformation(frameTimestamp / 1000);
    snowWakeRecorder.update(frameTimestamp / 1000, snowWakeBody());
    const frameWeatherAudio = weatherAudioLevels();
    updateSeaState({
      timeSeconds: frameTimestamp / 1000,
      storm: seaStormForWeather(),
      rain: frameWeatherAudio.rain,
      seaLevel: worldStore.generator?.seaLevel,
    });
    const surfaceSeconds = frameTimestamp / 1000;
    const surfaceDelta = lastBiomeSurfaceSeconds === null ? 0 : Math.min(1, surfaceSeconds - lastBiomeSurfaceSeconds);
    lastBiomeSurfaceSeconds = surfaceSeconds;
    const surfaceLook = biomeSurface.update(surfaceDelta, {
      x: viewModeController.camera.position.x + frameOrigin.x,
      z: viewModeController.camera.position.z + frameOrigin.z,
    });
    setGroundDeformationRegion(surfaceLook.prints);
    updateSeaState({ water: surfaceLook.water });
    // Rain stipples every pool on top of the biome's own drops.
    waterInteraction.update(surfaceSeconds, viewModeController.mode === PLAYER_MODE_WALK && !viewModeController.paused,
      { ...surfaceLook.ripples, drops: surfaceLook.ripples.drops + frameWeatherAudio.rain * 24 });
    worldSoundscape.update(frameTimestamp / 1000, viewModeController.camera);
    const frameSeconds = frameTimestamp / 1000;
    const frameDelta = lastWetnessSeconds === null ? 0 : Math.min(1, frameSeconds - lastWetnessSeconds);
    lastWetnessSeconds = frameSeconds;
    const groundStorm = stormFrame();
    surfaceWetness.update(groundSnap ? 1e6 : frameDelta, frameWeatherAudio.rain);
    stormSnowCoverUniform.value = groundSnap
      ? snowCover.snap(groundStorm.snow)
      : snowCover.update(frameDelta, groundStorm.snow, groundStorm.snowShare);
    stormRainUniform.value = frameWeatherAudio.rain;
    skyLooks?.setStorm(stormFrame());
    const snowCountryWeight = snowCountry.update(frameDelta, viewModeController.camera);
    skyLooks?.setSnowCountry(snowCountryWeight);
    skyLooks?.setRegion(skyRegion.update(frameDelta, viewModeController.camera));
    weatherController?.setRegionalSnow(snowCountry.snowfall);
    terrainView.godRays.setShaftAtmosphere(snowCountryWeight);
    if (dayNightCycle) {
      // The clock blends the two presets the hour lies between, so the sun moves
      // on continuously; `setTimeBlend` ignores a repeat. Paused, the sky keeps
      // whatever look was chosen by hand. The moon follows the clock's own
      // astronomy; the sky still writes the light.
      dayNightCycle.update(frameDelta);
      if (!dayNightCycle.paused) skyLooks?.setTimeBlend(dayNightCycle.weights);
      stylizedSurface.skyView?.setCelestial(dayNightCycle.evaluate());
    }
    skyLooks?.update(frameDelta);
    stylizedSurface.skyView?.setLightningFlash(weatherController?.lightning.flash ?? 0);
    // The gorge mist's local height patch and colours, from the sky the look just
    // wrote. Weighted by how misty the place's air is (regionalSkyLook): snow
    // country keeps a little of it in its gorges even in dry air, and damp
    // country anywhere fills its valleys.
    const valleyMist = skyLooks?.current?.mist ?? 0;
    terrainView.updateValleyFog({
      budget: deferredWork,
      focus: viewModeController.camera.position,
      origin: frameOrigin,
      timeSeconds: frameSeconds,
      weight: Math.max(snowCountryWeight * (0.35 + 0.65 * valleyMist), valleyMist * 0.85),
      sunDirection: stylizedSurface.skyView?.sunDirectionValue,
      sunColor: skyLooks?.current?.directionalColor,
      fogColor: skyLooks?.current?.fogColor,
    });
    snowPowder.update(frameSeconds);
    worldAmbience.update(frameDelta, {
      budget: deferredWork,
      camera: viewModeController.camera,
      walking: viewModeController.mode === PLAYER_MODE_WALK,
      orbitFocus: renderFocus,
      weather: {
        enabled: weatherEnabled,
        mode: weatherSettings.weatherMode,
        intensity: weatherSettings.weatherIntensity,
        windX: weatherSettings.weatherWindX,
        windZ: weatherSettings.weatherWindZ,
        storm: stormFrame().wind,
      },
      skyPreset: skyLooks?.preset ?? 'configured',
      night: Boolean(skyLooks?.night),
      snowCountry: snowCountryWeight,
      player: characterView,
    });
    fallingLeaves.update(
      frameSeconds,
      frameDelta,
      viewModeController.camera,
      weatherEnabled && weatherSettings.weatherMode !== 'off'
        ? { x: weatherSettings.weatherWindX, z: weatherSettings.weatherWindZ }
        : { x: 0.3, z: 0.1 },
      viewModeController.mode === PLAYER_MODE_WALK,
    );
    drawPreparation.flushBudgeted(viewModeController.camera, deferredWork);
    if (profiling) perfQa.mark('ambiencePreparation');
    drawPreparation.hidePending();
    roadsideDetails.editingVisible = viewModeController.mode === PLAYER_MODE_EDIT && !gameplayOverlayController.isWorldInputBlocked();
    roadsideDetailsUi.update();
    terrainView.render(viewModeController.camera);
    stylizedSurface.updateRendererCounters();
    deferredWork.endFrame();
    if (import.meta.env.DEV) window.__worldVisualQa?.afterFrame(frameTimestamp,frameDelta);
    assetStartupTelemetry.markFirstFrame();
    if (profiling) {
      perfQa.mark('render');
      const voxelStatusLive = voxelPrototype.getStatus?.() ?? null;
      perfQa.endFrame({
        streaming: terrainView.getStreamingStatus(),
        voxel: voxelStatusLive
          ? {
            ready: voxelStatusLive.ready,
            rebuilding: voxelStatusLive.rebuilding,
            residentChunkCount: voxelStatusLive.residentChunkCount,
            focusChunk: voxelStatusLive.focusChunk,
          }
          : null,
        originSnap: Boolean(rebase),
        forcePredictiveRefresh,
      });
    } else if (perfQa) {
      perfQa.endFrame();
    }
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true; active = false;
    terrainView.renderer.onDeviceLost = () => {};
    terrainView.setAnimationLoop(null);
    window.removeEventListener('pagehide', onPageHide); resources.dispose();
    if (window.__editor?.terrainView === terrainView) delete window.__editor;
  };
  const onPageHide = () => { recovery.dispose(); dispose(); };
  window.addEventListener('pagehide', onPageHide, { once: true });
  const runtime = { dispose, capture: () => captureEditorRecoveryState({ controller, editorCamera, playerController,
    viewModeController, proceduralWorkshop, floatingOrigin, exploration }) };
  if (config.exploration.recovery.enabled) terrainView.renderer.onDeviceLost = info => {
    console.warn('Renderer device lost; restoring editor state.', info);
    void recovery.recover(config.renderer.forceWebGL ? 'webgl' : 'auto', terrainView.rendererBackendStatus.mode, info).catch(showStartupError);
  };
  const hudVisibility = new HudVisibilityController({ root: document,
    isBlocked: () => gameplayOverlayController.isWorldInputBlocked()
      || hasCaptureBlockingOverlay(document),
    isReady: () => terrainView.getStreamingStatus().loading === 0 && stylizedSurface.getPreparationStatus().ready,
  });
  resources.own(hudVisibility);
  const hudPresentation = new HudPresentationBindings({visibility:hudVisibility,viewMode:viewModeController,escapeStack,viewport:terrainView.renderer.domElement});
  resources.own(hudPresentation);
  if (import.meta.env.DEV && window.__editor) Object.assign(window.__editor,{hudVisibility,hudPresentation});
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('qaVisual') === '1') {
    const visualQa = new WorldVisualQa(window.__editor);
    window.__worldVisualQa = visualQa;
    resources.own(visualQa);
    resources.defer(() => { if (window.__worldVisualQa === visualQa) delete window.__worldVisualQa; });
  }
  if (import.meta.env.DEV && window.__editor) Object.assign(window.__editor, { recovery, captureRecoveryState: runtime.capture });
  return runtime;
}

function showStartupError(error) {
  console.error('Failed to start the Drusniel World editor.', error);
  document.querySelectorAll('.loading-overlay').forEach((element) => element.remove());
  const root = document.querySelector('#app');
  if (!root) return;

  const container = document.createElement('main');
  container.dataset.worldError = '';
  Object.assign(container.style, {
    padding: '24px',
    fontFamily: 'system-ui',
    color: '#f4e6e6',
    background: '#211414',
    minHeight: '100vh',
  });
  const title = document.createElement('h1');
  title.textContent = 'Editor failed to start';
  const message = document.createElement('p');
  message.textContent = error instanceof Error ? error.message : String(error);
  container.append(title, message);
  root.replaceChildren(container);
}

let activeRuntime = null;
const recovery = new RendererRecovery({
  capture: () => activeRuntime.capture(), release: () => activeRuntime?.dispose(),
  restart: async (_backend, state) => { activeRuntime = await startEditor({ ...state, backend: _backend }); },
  onFailure: error => {
    showStartupError(error);
    const documentValue = recovery.lastState?.document;
    if (!documentValue) return;
    const button = document.createElement('button'); button.textContent = 'Download recovered world';
    button.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(documentValue)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'drusniel-recovered-world.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.querySelector('#app main')?.append(button);
  },
});
startEditor().then(runtime => { activeRuntime = runtime; }).catch(showStartupError);
