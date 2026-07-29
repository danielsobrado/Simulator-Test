import './styles.css';
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
import { FrameRateDisplay } from './editor/performance/FrameRateDisplay.js';
import { FrameRateMeter } from './editor/performance/FrameRateMeter.js';
import { FRAME_RATE_DISPLAY_INTERVAL_MS } from './editor/performance/frameRateConstants.js';
import { assetStartupTelemetry } from './editor/performance/AssetStartupTelemetry.js';
import { PerfCounters } from './editor/performance/qa/PerfCounters.js';
import { PerfQaHarness } from './editor/performance/qa/PerfQaHarness.js';
import { createObjectTownQaScene } from './editor/performance/qa/ObjectTownQaScene.js';
import { applyPerfQaDensityProfile } from './editor/performance/qa/PerfQaDensityProfiles.js';
import { parseQaParams } from './editor/performance/qa/parseQaParams.js';
import { PlayerController } from './editor/player/PlayerController.js';
import { ViewModeController } from './editor/player/ViewModeController.js';
import { ViewModeUi } from './editor/player/ViewModeUi.js';
import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK } from './editor/player/playerConstants.js';
import { isTreeImpostorBakeMode } from './editor/stylized/impostorBakeMode.js';
import { StylizedSurfaceView } from './editor/stylized/StylizedSurfaceView.js';
import { BiomeAssetPalette } from './editor/stylized/BiomeAssetPalette.js';
import { createWeatherController } from './editor/weather/weather_controller.js';
import { createWeatherUi } from './editor/weather/weather_ui.js';
import {
  createWeatherTerrainSamplers,
  raycastTerrainHeightfield,
} from './editor/weather/weather_terrain_adapters.js';
import { createSpellRuntime } from './editor/spells/spell_runtime.js';
import './editor/weather/weather.css';
import './editor/spells/spell_menu.css';
import { applySceneAssetSettings } from './editor/settings/SceneSettings.js';
import {
  loadBootSceneSettings,
  resolveLocalGlb,
  SceneSettingsRuntime,
} from './editor/settings/SceneSettingsRuntime.js';
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

// Boot is a fixed sequence, so its steps are declared up front and the bar has a
// real denominator. Ids are stable strings because `LoadingSession.start` throws on
// an unknown one — a renamed phase fails loudly rather than silently never lighting.
const BOOT_STEPS = Object.freeze([
  { id: 'settings', label: 'Scene settings' },
  { id: 'terrain', label: 'Terrain view and GPU device' },
  { id: 'assets', label: 'World assets' },
  { id: 'blades', label: 'Grass blade profiles' },
  { id: 'map', label: 'Initial map' },
  { id: 'prewarm', label: 'Compiling render pipelines' },
]);

async function startEditor() {
  // Set when a scene look stages a page reload. Everything after the map step is
  // expensive setup for a document that is about to be thrown away — the shader
  // pre-warm alone is the longest phase in boot — so this lets the rest be skipped.
  let sceneReloadPending = false;
  const loading = new LoadingTracker();
  const loadingOverlay = new LoadingOverlay(document.body);
  loadingOverlay.attach(loading);
  const boot = loading.begin({ title: 'Starting Drusniel World', steps: BOOT_STEPS });
  boot.start('settings');
  // A `?settings=` reference is user-supplied and can go stale — the session
  // handoff is gone in a duplicated tab, a preset URL can 404, a hand-edited
  // document can be invalid. None of that should stop the editor from booting,
  // so it degrades to the built-in look and reports why once the UI exists.
  let bootSceneSettings = null;
  let bootSceneSettingsError = null;
  try {
    bootSceneSettings = await loadBootSceneSettings();
  } catch (error) {
    bootSceneSettingsError = error;
  }
  const config = loadEditorConfig();
  const perfQaConfig = parseQaParams(window.location.search);
  if (perfQaConfig) {
    applyPerfQaDensityProfile(config, perfQaConfig.densityProfile);
  }
  const localAssetObjectUrls = [];
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

  // View distance is near by default so procedural worlds keep their cozy fog.
  // The imported macro backdrop switches to a far view at runtime — the sky
  // sphere, fog, and camera far plane grow to its radius so far continents read
  // through the haze (see applyViewDistance below).
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
      // FogExp2 ~10% visibility at the backdrop radius, so its far edge fades.
      // farDensityScale tunes how hard that far edge goes; the far-terrain
      // material layers its own aerial perspective on top of this.
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
  const surfaceMaskConfig = createSurfaceMaskConfig(config.stylizedSurface);
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
    // Biome selections name assets by key, so a preset written against a
    // different asset set can reference keys this build has no variant for.
    // Fall back to the automatic mix rather than refusing to start.
    bootSceneSettingsError = error;
    biomeAssetPalette = new BiomeAssetPalette({ stylizedConfig: config.stylizedSurface });
  }
  const floatingOrigin = new FloatingOrigin({
    threshold: config.world.floatingOriginThreshold,
    snapSize: config.world.chunkSize * config.map.tileSize,
  });

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
  ui.attachBiomeAssetPalette(biomeAssetPalette);
  const frameRateDisplay = new FrameRateDisplay({ root });
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

  boot.start('terrain');
  try {
    await terrainView.initialize();
  } catch (error) {
    boot.fail(error);
    terrainView.dispose();
    worldStore.dispose();
    throw error;
  }

  const objectView = new ObjectView({
    terrainView,
    tileMap,
    heightField,
    objectMap,
    objectCatalog: OBJECT_CATALOG,
  });
  const constructionStore = new ConstructionStore();
  const constructionSpatialIndex = new ConstructionSpatialIndex({
    chunkWorldSize: config.world.chunkSize * config.map.tileSize,
  });
  constructionStore.subscribe((change) => {
    if (change.kind === 'clear' || change.kind === 'replace') {
      constructionSpatialIndex.clear();
      for (const record of constructionStore.list()) constructionSpatialIndex.update(record);
      return;
    }
    if (change.after) constructionSpatialIndex.update(change.after);
    else if (change.id) constructionSpatialIndex.remove(change.id);
  });
  const constructionCompiler = new ConstructionCompilerClient();
  const constructionMaterialStore = new ConstructionMaterialStore();
  const constructionView = new ConstructionView({
    terrainView,
    store: constructionStore,
    compilerClient: constructionCompiler,
    materialStore: constructionMaterialStore,
  });
  const proceduralAssetManager = new ProceduralAssetManager({
    tileSize: tileMap.tileSize,
    objectMap,
    objectView,
    ui,
    lodConfig: config.objects?.lod,
  });
  const stylizedSurface = new StylizedSurfaceView({
    terrainView,
    objectMap,
    config: config.stylizedSurface,
    baseUrl: import.meta.env.BASE_URL,
    biomeAssetPalette,
  });
  boot.start('assets');
  // Every stylized GLB already reports through the startup telemetry, so the
  // overlay can name the file it is on without instrumenting each loader.
  const releaseAssetProgress = bindAssetProgress(boot);
  ui.attachGodRays(terrainView.godRays);
  ui.attachGrassTuning(stylizedSurface.grassTuning);
  ui.attachLoading(loading);
  ui.attachGrassBladeProfiles(stylizedSurface.bladeProfiles);
  // The list has to be redrawn once the manifest lands: before that every set
  // resolves to the generated taper and would be labelled as unbaked.
  stylizedSurface.bladeProfiles.ready.then(() => ui.renderGrassBladeProfiles());
  boot.start('blades');
  await stylizedSurface.bladeProfiles.ready;

  if (impostorBakeMode) {
    await stylizedSurface.bakeRequest;
    return;
  }

  const macroFarTerrain = new MacroFarTerrainView({
    scene: terrainView.scene,
    worldStore,
    floatingOrigin,
    config,
    forestFieldProvider: () => stylizedSurface.treeView?.manifestStore?.forestField ?? null,
  });

  const editorCamera = new EditorCamera({
    canvas: terrainView.renderer.domElement,
    viewSize: config.camera.viewSize,
    minZoom: config.camera.minZoom,
    maxZoom: config.camera.maxZoom,
    damping: config.camera.damping,
    farPlane: nearView.farPlane,
  });

  // Overlay shortcuts are owned by GameplayOverlayController so inventory and
  // the world map no longer depend on listener registration order versus the
  // player controller's capture-phase key handling.
  let playerController;
  let viewModeController;
  let controller;
  const gameplayOverlayController = new GameplayOverlayController({
    getPlayerController: () => playerController,
  });
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
  const inventoryUi = new InventoryUi({ root, controller: inventoryController });
  const worldMapController = new WorldMapController({
    worldStore,
    floatingOrigin,
    tileSize: config.map.tileSize,
    getViewModeController: () => viewModeController,
    getPlayerController: () => playerController,
    getCampaign: () => controller?.campaign ?? null,
    overlayController: gameplayOverlayController,
  });
  const worldMapUi = new WorldMapUi({ root, controller: worldMapController });

  playerController = new PlayerController({
    canvas: terrainView.renderer.domElement,
    terrainView,
    config: config.player,
    farPlane: nearView.farPlane,
  });
  viewModeController = new ViewModeController({
    editorCamera,
    playerController,
    terrainView,
    objectView,
  });

  // Walk mode is not an awaitable call — dropping in re-centres residency and the
  // world fills in over the following frames. So readiness is observed from the
  // streaming status rather than awaited, and the overlay closes when it settles.
  const streamingFrameListeners = new Set();
  const streamingProbe = {
    getStatus: () => terrainView.getStreamingStatus(),
    onFrame: (listener) => {
      streamingFrameListeners.add(listener);
      return () => streamingFrameListeners.delete(listener);
    },
  };
  // Map loads finish with the document applied and residency re-centred, but the
  // chunks themselves arrive over the next few seconds. Without this the overlay
  // closed on the import and the world kept assembling behind it.
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
    worldInputBlockedProvider: () => gameplayOverlayController.isWorldInputBlocked(),
  });
  controller.focusProvider = () => {
    const renderFocus = viewModeController.getFocusWorld();
    return floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
  };
  // Pickers follow whichever camera is actually rendering, so construction
  // editing works from the player's first-person view as well as the orbit one.
  controller.cameraProvider = () => viewModeController.camera;
  controller.playerEditingProvider = () => viewModeController.paused;
  viewModeController.onPausedEditing = () => controller.selectTool('construction');
  // Flat wall tops become walkable: the provider composes into the same ground
  // height function the player physics already samples.
  playerController.constructionGround = new ConstructionGroundProvider({
    store: constructionStore,
    spatialIndex: constructionSpatialIndex,
    terrainView,
  });
  // Right-tapping a wall opens the same circular palette the workshop uses.
  controller.constructionPalette = new ConstructionPaletteController({
    host: ui.viewport,
    controller,
    materialStore: constructionMaterialStore,
    onStatus: (message) => controller.emitNotice(message),
  });
  // The palette covers how a wall looks; the gizmo covers what you do to it.
  // It borrows the palette's inspector rather than opening a second one.
  controller.constructionGizmo = new ConstructionGizmoController({
    host: ui.viewport,
    controller,
    palette: controller.constructionPalette,
    onStatus: (message) => controller.emitNotice(message),
  });

  // One owner for Escape. Each handler backs out exactly one level and the
  // first to claim the press consumes it, so the layers compose instead of
  // four independent listeners racing on the capture phase.
  const escapeStack = new EscapeStack();
  // The grid opens from the cluster, so it must back out first. Registering it
  // ahead of the cluster at the same level is what makes one press close one
  // layer rather than both.
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
  escapeStack.register(ESCAPE_PRIORITY.gesture, () => {
    if (!controller.constructionDrawing && !controller.constructionAnchorDrag) return false;
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
    config,
    boot: bootSceneSettings,
    resolveAzgaarOptions: (summary) => ui.resolveAzgaarImportOptions(summary),
    afterMapLoad: async (worldDocument) => {
      ui.syncImportedBiomeTiles(worldDocument);
      ui.minimapCenter = controller.getFocusCell?.() ?? ui.minimapCenter;
      ui.updateMinimap();
    },
  });
  // A map carrying its own saved look reloads the page from inside `loadMap`, which
  // otherwise reads as boot spontaneously restarting: the sequence runs to the end,
  // the browser swaps the page, and every step replays with nothing said about why.
  sceneSettingsRuntime.onSceneReload = (document, url) => {
    sceneReloadPending = true;
    ui.showSceneReload(
      'Reloading for the world look',
      document?.name ?? (url ? assetFileName(url) : ''),
    );
  };
  controller.sceneSettingsProvider = () => sceneSettingsRuntime.capture();
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
  boot.start('map');
  try {
    await sceneSettingsRuntime.applyInitialRuntime();
  } catch (error) {
    // The preset's map may be unreachable. The generated world is already live,
    // so keep it and say the map did not load. The step is marked failed rather
    // than the session, because boot continues and the rest still has to report.
    boot.fail(error);
    ui.showToast(`Preset map not loaded: ${error.message}`, true);
  }
  // A map that carries its own look has, by this point, staged the handoff and
  // asked the browser to navigate. `location.assign` does not stop execution, so
  // without this the rest of boot runs to completion — voxel init, the wait on
  // stylized assets, and the shader pre-warm — building a scene that is discarded
  // milliseconds later, and the whole sequence then replays on the new page.
  //
  // The staging is already complete (`activate` awaits its own save before
  // navigating), so there is nothing left to finish. Nothing needs disposing
  // either: the document is going away. The only loose end is promises already in
  // flight, whose rejections would otherwise surface as unhandled.
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
  ui.attachWorkshop(proceduralWorkshop);
  const viewModeUi = new ViewModeUi({ root, controller: viewModeController });

  // Switch between near and far view distance depending on whether the imported
  // macro backdrop is active, so procedural worlds keep their original near fog.
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

  // Dev-only test hook: lets the perf/screenshot harness import a world and
  // drive the player without the file picker + prompt. Never exposed in builds.
  if (import.meta.env.DEV) {
    window.__editor = {
      controller,
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
    };
  }
  const voxelPrototype = new GpuVoxelWorld({
    terrainView,
    layout: voxelWorldLayout,
    stampStore: voxelStampStore,
  });
  const voxelPrototypeUi = new VoxelPrototypeUi({
    root,
    prototype: voxelPrototype,
    controller,
    stampStore: voxelStampStore,
  });
  const voxelStatus = await voxelPrototype.initialize({ x: 0, z: 0 });
  voxelPrototypeUi.render();
  if (voxelStatus.code === 'failed') {
    console.error('GPU voxel world failed to initialize.', voxelStatus.error);
  }

  await stylizedSurface.ready;
  assetStartupTelemetry.markAssetsReady();

  const weatherSettings = {
    weatherMode: config.weather?.mode ?? 'off',
    weatherIntensity: config.weather?.intensity ?? 0.7,
    weatherWindX: config.weather?.windX ?? -0.42,
    weatherWindZ: config.weather?.windZ ?? 0.18,
  };
  const weatherEnabled = config.weather?.enabled !== false;
  const weatherController = weatherEnabled
    ? createWeatherController({
      scene: terrainView.scene,
      camera: viewModeController.camera,
      isWebGpu: true,
      worldCells: 1e9,
      samplers: createWeatherTerrainSamplers(terrainView),
      getSettings: () => weatherSettings,
      getCamera: () => viewModeController.camera,
      getSunDirection: () => stylizedSurface.skyView?.sunDirectionValue ?? undefined,
    })
    : null;
  const weatherUi = weatherEnabled
    ? createWeatherUi({
      root,
      settings: weatherSettings,
      onChange: (next) => {
        Object.assign(weatherSettings, next);
        weatherController?.applySettings();
      },
    })
    : null;

  const spellsEnabled = config.spells?.enabled !== false;
  const spellRuntime = spellsEnabled
    ? createSpellRuntime({
      scene: terrainView.scene,
      getCamera: () => viewModeController.camera,
      isWalkMode: () => viewModeController.mode === PLAYER_MODE_WALK,
      subscribeViewMode: (listener) => viewModeController.subscribe(listener),
      raycastTerrain: (ray, maxRange) => raycastTerrainHeightfield(terrainView, ray, maxRange),
    })
    : null;
  spellRuntime?.precompile?.(terrainView.renderer);

  if (perfQaConfig?.scenarioId === 'object-town') {
    createObjectTownQaScene({
      target: perfQaConfig.buildingCount,
      proceduralAssetManager,
      objectMap,
      objectView,
    });
  }

  // Warm render pipelines before the first frame. WebGPU compiles a pipeline the
  // first time a material/geometry pair is actually drawn, and that compile blocks
  // in the GPU process — it shows up as a ~90 ms hitch on whichever frame a new
  // LOD band first becomes visible, with every phase timer on that frame cheap.
  // Doing it here moves the cost into load, where a stall is not a stutter.
  releaseAssetProgress();
  boot.start('prewarm', 'Compiling shaders — this is the long one');
  let finishWaterPrewarm = null;
  try {
    stylizedSurface.prewarmStreamingResources(terrainView.renderer);
    finishWaterPrewarm = stylizedSurface.beginWaterRefractionPrewarm();
    await terrainView.renderer.compileAsync(terrainView.scene, editorCamera.camera);
    if (finishWaterPrewarm) {
      await terrainView.renderer.renderAsync(terrainView.scene, editorCamera.camera);
    }
    terrainView.prewarmPostProcessing(playerController.camera);
  } catch (error) {
    console.warn('Render pipeline pre-warm failed; pipelines will compile on demand.', error);
  } finally {
    finishWaterPrewarm?.();
  }
  boot.finish();

  const perfQa = PerfQaHarness.fromLocation({
    viewModeController,
    playerController,
    terrainView,
    objectView,
    stylizedSurface,
    voxelPrototype,
    editorConfig: config,
  });
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

  let lastWeatherTimestamp = null;
  terrainView.setAnimationLoop((timestamp) => {
    if (!active) return;

    const frameTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    const profiling = perfQa?.beginFrame(frameTimestamp) ?? false;
    const averageFps = frameRateMeter.record(frameTimestamp);
    if (frameTimestamp >= nextFrameRateDisplayAt) {
      frameRateDisplay.update(averageFps);
      // Same cadence as the FPS display: the grass readout is there to be compared
      // against a profile switch, and both numbers have to come from the same
      // window or the comparison is between a settled figure and an instant one.
      ui.updateGrassBladeReadout({
        clumps: PerfCounters.get('grassLastChunkClumps'),
        blades: PerfCounters.get('grassLastChunkEffectiveBlades'),
        triangles: PerfCounters.get('grassLastChunkTriangles'),
        fps: averageFps,
      });
      nextFrameRateDisplayAt = frameTimestamp + FRAME_RATE_DISPLAY_INTERVAL_MS;
    }

    terrainView.flushUploadQueue();
    // Drains the construction module build queue under its own frame budget,
    // so committing a long wall cannot stall a frame.
    constructionView.update(frameTimestamp);
    constructionView.updateLod(viewModeController.camera, terrainView.renderer.domElement.clientHeight);
    PerfCounters.set('constructionModulesResident', constructionView.stats.modulesResident);
    PerfCounters.set('constructionModulesRebuilt', constructionView.stats.modulesRebuilt);
    PerfCounters.set('constructionModulesSkippedByHash', constructionView.stats.modulesSkippedByHash);
    PerfCounters.set('constructionQueueDepth', constructionView.stats.queueDepth);
    PerfCounters.set('constructionStones', constructionView.stats.stones);
    PerfCounters.set('constructionBuildMs', Math.round(constructionView.stats.buildMs));
    PerfCounters.set('constructionModulesNear', constructionView.stats.modulesNear);
    PerfCounters.set('constructionModulesCoarse', constructionView.stats.modulesCoarse);
    PerfCounters.set('constructionModulesShell', constructionView.stats.modulesShell);
    PerfCounters.set('constructionLodTransitions', constructionView.stats.lodTransitions);
    if (profiling) perfQa.mark('terrainCommit');

    viewModeController.update(frameTimestamp);
    ui.setMinimapHeading(viewModeController.getHeading());
    if (profiling) perfQa.mark('player');

    let renderFocus = viewModeController.getFocusWorld();
    const rebase = terrainView.updateFloatingOrigin(renderFocus);
    if (rebase) {
      PerfCounters.inc('floatingOriginSnaps');
      viewModeController.shiftWorld(rebase.shiftX, rebase.shiftZ);
      controller.refreshObjects();
      // Construction geometry is origin-local, so a rebase only moves each
      // record's group — no dispose, no rebuild, no hitch.
      constructionView.rebase();
      renderFocus = viewModeController.getFocusWorld();
    }
    if (profiling) perfQa.mark('floatingOrigin');

    macroFarTerrain.update();
    const backdropActive = macroFarTerrain.isActive();
    if (backdropActive !== farViewActive) {
      farViewActive = backdropActive;
      applyViewDistance(backdropActive);
    }

    const canonicalFocus = floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
    const forcePredictiveRefresh = frameTimestamp >= nextPredictiveRefreshAt;
    if (forcePredictiveRefresh) {
      nextPredictiveRefreshAt = frameTimestamp + TERRAIN_PREFETCH_REFRESH_MS;
    }
    terrainView.updateStreaming(
      canonicalFocus,
      frameTimestamp,
      forcePredictiveRefresh,
    ).catch((error) => {
      console.error('Terrain streaming update failed.', error);
    });
    if (profiling) perfQa.mark('streaming');

    stylizedSurface.update(frameTimestamp, viewModeController.camera);
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

    objectView.update(frameTimestamp, viewModeController.camera);
    if (profiling) perfQa.mark('objects');

    voxelPrototype.update(canonicalFocus);
    if (profiling) perfQa.mark('voxel');

    if (frameTimestamp >= nextStreamingStatusAt) {
      ui.renderStreamingStatus(terrainView.getStreamingStatus());
      nextStreamingStatusAt = frameTimestamp + 250;
    }
    // Per frame, not on the 250 ms status cadence: the settle test counts
    // consecutive quiet frames, and sampling four times a second would make it
    // wait seconds after the world was already still.
    for (const listener of streamingFrameListeners) listener();
    terrainView.render(viewModeController.camera);
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

  window.addEventListener('pagehide', () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    resizeObserver.disconnect();
    perfQa?.dispose();
    voxelPrototypeUi.dispose();
    voxelPrototype.dispose();
    stylizedSurface.dispose();
    weatherController?.dispose();
    weatherUi?.dispose();
    spellRuntime?.dispose();
    worldMapUi.dispose();
    worldMapController.dispose();
    inventoryUi.dispose();
    inventoryController.dispose();
    gameplayOverlayController.dispose();
    macroFarTerrain.dispose();
    proceduralWorkshop.dispose();
    viewModeUi.dispose();
    viewModeController.dispose();
    controller.dispose();
    editorCamera.dispose();
    objectView.dispose();
    constructionView.dispose();
    constructionCompiler.dispose();
    frameRateDisplay.dispose();
    terrainView.dispose();
    worldStore.dispose();
    localAssetObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }, { once: true });
}

function showStartupError(error) {
  console.error('Failed to start the Drusniel World editor.', error);
  document.querySelector('#app').innerHTML = `
    <main style="padding:24px;font-family:system-ui;color:#f4e6e6;background:#211414;min-height:100vh">
      <h1>Editor failed to start</h1>
      <p>${error instanceof Error ? error.message : String(error)}</p>
    </main>
  `;
}

startEditor().catch(showStartupError);
