import './styles.css';
import './editor/performance/frameRateDisplay.css';
import './editor/performance/qa/perfQa.css';
import './editor/player/playerMode.css';
import './editor/map/worldMap.css';
import { loadEditorConfig } from './config/loadEditorConfig.js';
import { EditorCamera } from './editor/EditorCamera.js';
import { EditorUi } from './editor/EditorUi.js';
import { InfiniteTerrainView } from './editor/InfiniteTerrainView.js';
import { MacroFarTerrainView } from './editor/world/MacroFarTerrainView.js';
import { WorldMapController } from './editor/map/WorldMapController.js';
import { WorldMapUi } from './editor/map/WorldMapUi.js';
import { ProceduralAssetManager } from './editor/workshop/ProceduralAssetManager.js';
import { ProceduralWorkshopUi } from './editor/workshop/ProceduralWorkshopUi.js';
import { ObjectMap } from './editor/ObjectMap.js';
import { ObjectView } from './editor/ObjectView.js';
import { OBJECT_CATALOG } from './editor/objectCatalog.js';
import { FrameRateDisplay } from './editor/performance/FrameRateDisplay.js';
import { FrameRateMeter } from './editor/performance/FrameRateMeter.js';
import { FRAME_RATE_DISPLAY_INTERVAL_MS } from './editor/performance/frameRateConstants.js';
import { PerfCounters } from './editor/performance/qa/PerfCounters.js';
import { PerfQaHarness } from './editor/performance/qa/PerfQaHarness.js';
import { PlayerController } from './editor/player/PlayerController.js';
import { ViewModeController } from './editor/player/ViewModeController.js';
import { ViewModeUi } from './editor/player/ViewModeUi.js';
import { isTreeImpostorBakeMode } from './editor/stylized/impostorBakeMode.js';
import { StylizedSurfaceView } from './editor/stylized/StylizedSurfaceView.js';
import { TerrainAwareEditorController } from './editor/TerrainAwareEditorController.js';
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

async function startEditor() {
  const config = loadEditorConfig();
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

  try {
    await terrainView.initialize();
  } catch (error) {
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
  const proceduralAssetManager = new ProceduralAssetManager({
    tileSize: tileMap.tileSize,
    objectMap,
    objectView,
    ui,
  });
  const stylizedSurface = new StylizedSurfaceView({
    terrainView,
    objectMap,
    config: config.stylizedSurface,
    baseUrl: import.meta.env.BASE_URL,
  });

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

  // Declared before PlayerController so WorldMapController's window keydown
  // listener registers first: PlayerController stops propagation for every
  // non-Escape key while walking, which would otherwise swallow "M".
  let playerController;
  let viewModeController;
  let controller;
  const worldMapController = new WorldMapController({
    worldStore,
    floatingOrigin,
    tileSize: config.map.tileSize,
    getViewModeController: () => viewModeController,
    getPlayerController: () => playerController,
    getCampaign: () => controller?.campaign ?? null,
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
  });
  controller.focusProvider = () => {
    const renderFocus = viewModeController.getFocusWorld();
    return floatingOrigin.toCanonical(renderFocus.x, renderFocus.z);
  };

  ui.bind(controller);
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
      config,
      ui,
      proceduralWorkshop,
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

  // Warm render pipelines before the first frame. WebGPU compiles a pipeline the
  // first time a material/geometry pair is actually drawn, and that compile blocks
  // in the GPU process — it shows up as a ~90 ms hitch on whichever frame a new
  // LOD band first becomes visible, with every phase timer on that frame cheap.
  // Doing it here moves the cost into load, where a stall is not a stutter.
  try {
    await terrainView.renderer.compileAsync(terrainView.scene, editorCamera.camera);
  } catch (error) {
    console.warn('Render pipeline pre-warm failed; pipelines will compile on demand.', error);
  }

  const perfQa = PerfQaHarness.fromLocation({
    viewModeController,
    playerController,
    terrainView,
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

  terrainView.setAnimationLoop((timestamp) => {
    if (!active) return;

    const frameTimestamp = Number.isFinite(timestamp) ? timestamp : performance.now();
    const profiling = perfQa?.beginFrame(frameTimestamp) ?? false;
    const averageFps = frameRateMeter.record(frameTimestamp);
    if (frameTimestamp >= nextFrameRateDisplayAt) {
      frameRateDisplay.update(averageFps);
      nextFrameRateDisplayAt = frameTimestamp + FRAME_RATE_DISPLAY_INTERVAL_MS;
    }

    terrainView.flushUploadQueue();
    if (profiling) perfQa.mark('terrainCommit');

    viewModeController.update(frameTimestamp);
    if (profiling) perfQa.mark('player');

    let renderFocus = viewModeController.getFocusWorld();
    const rebase = terrainView.updateFloatingOrigin(renderFocus);
    if (rebase) {
      PerfCounters.inc('floatingOriginSnaps');
      viewModeController.shiftWorld(rebase.shiftX, rebase.shiftZ);
      controller.refreshObjects();
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

    voxelPrototype.update(canonicalFocus);
    if (profiling) perfQa.mark('voxel');

    if (frameTimestamp >= nextStreamingStatusAt) {
      ui.renderStreamingStatus(terrainView.getStreamingStatus());
      nextStreamingStatusAt = frameTimestamp + 250;
    }
    terrainView.render(viewModeController.camera);
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
    worldMapUi.dispose();
    worldMapController.dispose();
    macroFarTerrain.dispose();
    proceduralWorkshop.dispose();
    viewModeUi.dispose();
    viewModeController.dispose();
    controller.dispose();
    editorCamera.dispose();
    objectView.dispose();
    frameRateDisplay.dispose();
    terrainView.dispose();
    worldStore.dispose();
  }, { once: true });
}

function showStartupError(error) {
  console.error('Failed to start the SimCity DnD editor.', error);
  document.querySelector('#app').innerHTML = `
    <main style="padding:24px;font-family:system-ui;color:#f4e6e6;background:#211414;min-height:100vh">
      <h1>Editor failed to start</h1>
      <p>${error instanceof Error ? error.message : String(error)}</p>
    </main>
  `;
}

startEditor().catch(showStartupError);
