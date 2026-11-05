import * as THREE from 'three/webgpu';
import { installUnusedSamplerPruning } from '../render/UnusedSamplerBindings.js';
import { installSurfaceAnisotropy } from '../render/SurfaceAnisotropyController.js';
import { installEmptyDrawSkip } from '../render/skipEmptyDraws.js';
import { uniform } from 'three/tsl';
import {
  PERF_COUNTER_OCCLUSION_CANDIDATES,
  PERF_COUNTER_OCCLUSION_CULLED_DRAWS,
  PERF_COUNTER_OCCLUSION_OCCLUDERS,
  PERF_COUNTER_OCCLUSION_PREPARE_MS,
  PerfCounters,
} from './performance/qa/PerfCounters.js';
import { createTerrainMaterial } from './terrainMaterial.js';
import { terrainRendererProfile } from './materials/TerrainRendererProfile.js';
import { createCoastPatternOrigins } from './stylized/CoastSwashShading.js';
import { createTerrainTransitionPatterns } from './materials/TerrainTransitionNodes.js';
import { resolveBlownStreaks } from './stylized/ambient/BlownStreaks.js';
import { resolveFrost } from './stylized/ambient/FrostShading.js';
import { ValleyFogController } from './stylized/mist/ValleyFogController.js';
import { SettlementSamplingPreparation } from './world/settlements/SettlementSamplingPreparation.js';
import {
  attachTerrainMaterialBakeGpuState,
  createTerrainMaterialBakeGpuState,
} from './materials/TerrainMaterialBakeGpu.js';
import { TERRAIN_SLOT_KEY } from './materials/TerrainSlotBindings.js';
import { cellCenterToWorld, worldToCell } from './world/WorldCoordinates.js';
import {
  createTerrainSlotPlan,
  selectTerrainResidentDescriptors,
  writeTerrainChunk,
} from './world/TerrainStreamingPlan.js';
import {
  TERRAIN_COMMIT_BUDGET_MS,
  TERRAIN_MAX_COMMITS_PER_FRAME,
  TERRAIN_MAX_COMMITS_PER_FRAME_IDLE,
  TERRAIN_MOVING_SPEED_EPSILON,
  TerrainCommitQueue,
  commitPriority,
  createTerrainCommitJob,
} from './world/TerrainCommitQueue.js';
import {
  createSurfaceMaskConfig,
  enrichPageRenderPixels,
  getSurfaceMaskChunkRadius,
} from './world/ChunkRenderPixels.js';
import { TileDistanceField } from './stylized/forest/TileDistanceField.js';
import {
  StylizedGodRaysPostProcess,
  directionFromAngles,
} from './stylized/StylizedGodRaysPostProcess.js';
import { patchViewportFramebufferSources } from '../render/patchViewportFramebufferSources.js';
import { raiseDeviceLimits } from '../render/deviceLimits.js';
import { GpuOcclusion } from '../render/occlusion/GpuOcclusion.js';
import { resolveCinematicFinish } from './stylized/cinematicFinish.js';
import { FOREST_FLOOR_SIZE } from './stylized/forestFloorTexture.js';
import { createTerrainOccluderGeometry } from './world/terrainOccluderProxy.js';
import { createSlotGeometry, fitSlotBounds } from './world/TerrainSlotBounds.js';

// Water refraction / transmission sample viewport colour+depth via
// ViewportTextureNode, which clones FramebufferTexture/DepthTexture per render
// target while sharing Source. Detach those Sources before the first renderer
// is constructed so resize cannot skip GPU realloc on the second target.
patchViewportFramebufferSources();

const PICK_ITERATIONS = 6;
const _resizeSize = /* @__PURE__ */ new THREE.Vector2();
const PREVIEW_HEIGHT_OFFSET = 0.08;
const TERRAIN_REQUEST_RETRY_DELAY_MS = 1000;

export function inspectRendererBackend(renderer) {
  const backend = renderer?.backend;
  const webgpu = Boolean(backend?.isWebGPUBackend);
  const webgl = Boolean(backend?.isWebGLBackend);
  return Object.freeze({
    mode: webgpu ? 'webgpu' : webgl ? 'webgl' : 'unknown',
    webgpu,
    webgl,
  });
}

/**
 * Riparian distance source for the forest habitat field. `rangeMeters` bounds the
 * halo the chamfer pass has to cover, so it must be at least the widest water
 * range any biome profile tests; beyond it, distance reads as Infinity, which
 * every profile treats as "no water nearby".
 */
function createWaterDistanceField(terrainView, stylizedConfig) {
  const rangeMeters = Number(stylizedConfig?.trees?.habitat?.waterRangeMeters) || 0;
  if (rangeMeters <= 0) return null;
  const tileSize = terrainView.worldStore.tileSize;
  return new TileDistanceField({
    tileAt: (cellX, cellZ) => terrainView.tileMap.get(cellX, cellZ),
    tileSize,
    chunkSize: terrainView.worldStore.chunkSize,
    targetTileId: stylizedConfig?.water?.tileId ?? 0,
    maxCells: Math.ceil(rangeMeters / tileSize),
    label: 'water',
    preparedProvider: (x, z) => terrainView.preparedPlacement?.field('water', x, z),
    maxCachedChunks: 169,
    revisionProvider: () => terrainView.worldStore.revision,
  });
}

/**
 * One terrain material for every slot (see TerrainSlotBindings): built from
 * the first slot's data, which fixes the texture formats, then shared.
 */
function createSharedTerrainMaterialSource({
  worldStore,
  stylizedConfig,
  sunDirection = null,
  valleyFog = null,
}) {
  let material = null;
  // Resolved once, from the ambient layer's block, and handed to the material as
  // resolved settings: a bad shape key is already an error at config load (see
  // validateStylizedLodConfig), so this cannot fail for a caller that got here.
  // With no ambient block at all — a capture or budget harness — the material
  // keeps its plain shading rather than adding terms keyed on fields it lacks.
  const ambient = stylizedConfig?.ambientEffects;
  const surfaceEffects = {
    blownStreaks: ambient ? resolveBlownStreaks(ambient) : null,
    frost: ambient ? resolveFrost(ambient) : null,
    ambientEffects: ambient ?? null,
    valleyFog: valleyFog?.enabled
      ? { settings: valleyFog.settings, patch: valleyFog.patch, uniforms: valleyFog.uniforms, quality: valleyFog.quality }
      : null,
  };
  return (slotData, bakeGpuState) => {
    material ??= createTerrainMaterial({
      ...slotData,
      chunkWorldSize: worldStore.chunkSize * worldStore.tileSize,
      width: worldStore.chunkSize,
      height: worldStore.chunkSize,
      stylizedConfig,
      bakeGpuState,
      surfaceEffects,
      sunDirection,
    });
    return material;
  };
}

function createSlot({ slotIndex, scene, geometry, worldStore, stylizedConfig, sharedMaterial }) {
  const chunkSize = worldStore.chunkSize;
  const texturePixels = new Uint8Array(chunkSize * chunkSize * 4);
  const surfaceMaskPixels = new Uint8Array(chunkSize * chunkSize * 4);
  const heightPixels = new Float32Array((chunkSize + 1) * (chunkSize + 1));
  // Two channels: R is the forest canopy's shading of the ground, G the contact
  // shade under trunks and boulders. One texture, because the ground reads both in
  // the same fetch (forestFloorTexture.js).
  const forestFloorSize = FOREST_FLOOR_SIZE;
  const forestFloorPixels = new Uint8Array(forestFloorSize * forestFloorSize * 4);
  const tileTexture = new THREE.DataTexture(
    texturePixels,
    chunkSize,
    chunkSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  tileTexture.magFilter = THREE.NearestFilter;
  tileTexture.minFilter = THREE.NearestFilter;
  tileTexture.generateMipmaps = false;
  tileTexture.colorSpace = THREE.SRGBColorSpace;

  const surfaceMaskTexture = new THREE.DataTexture(
    surfaceMaskPixels,
    chunkSize,
    chunkSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  surfaceMaskTexture.magFilter = THREE.LinearFilter;
  surfaceMaskTexture.minFilter = THREE.LinearFilter;
  surfaceMaskTexture.generateMipmaps = false;
  surfaceMaskTexture.colorSpace = THREE.NoColorSpace;

  const heightTexture = new THREE.DataTexture(
    heightPixels,
    chunkSize + 1,
    chunkSize + 1,
    THREE.RedFormat,
    THREE.FloatType,
  );
  heightTexture.magFilter = THREE.NearestFilter;
  heightTexture.minFilter = THREE.NearestFilter;
  heightTexture.generateMipmaps = false;
  heightTexture.unpackAlignment = 1;

  const forestFloorTexture = new THREE.DataTexture(
    forestFloorPixels,
    forestFloorSize,
    forestFloorSize,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  forestFloorTexture.magFilter = THREE.LinearFilter;
  forestFloorTexture.minFilter = THREE.LinearFilter;
  forestFloorTexture.generateMipmaps = false;
  forestFloorTexture.colorSpace = THREE.NoColorSpace;
  forestFloorTexture.needsUpdate = true;

  const chunkCenter = uniform(new THREE.Vector2());
  const coastPatterns = createCoastPatternOrigins();
  const transitionPatterns = createTerrainTransitionPatterns(stylizedConfig.materialBake?.families?.features);
  const slotData = {
    tileTexture,
    heightTexture,
    surfaceMaskTexture,
    forestFloorTexture,
    chunkCenter,
    coastPatterns,
    transitionPatterns,
  };
  const bakeGpuState = createTerrainMaterialBakeGpuState(stylizedConfig.materialBake);
  const material = sharedMaterial(slotData, bakeGpuState);
  // Own bounds over the shared buffers: the height is applied in the shader.
  const mesh = new THREE.Mesh(createSlotGeometry(geometry), material);
  // What the shared material draws for this slot, and its own bake.
  mesh.userData[TERRAIN_SLOT_KEY] = slotData;
  attachTerrainMaterialBakeGpuState(mesh, bakeGpuState);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.name = `terrain-slot-${slotIndex}`;
  scene.add(mesh);

  return {
    slotIndex,
    key: null,
    descriptor: null,
    page: null,
    lastUsed: 0,
    token: 0,
    loading: false,
    retryAt: null,
    pageRevision: -1,
    texturePixels,
    surfaceMaskPixels,
    heightPixels,
    forestFloorPixels,
    forestFloorSize,
    tileTexture,
    surfaceMaskTexture,
    heightTexture,
    forestFloorTexture,
    forestFloorKey: null,
    chunkCenter,
    coastPatterns,
    transitionPatterns,
    material,
    mesh,
  };
}

export class InfiniteTerrainView {
  constructor({
    container,
    tileMap,
    heightField,
    worldStore,
    floatingOrigin,
    streamingConfig,
    rendererConfig,
    stylizedConfig,
    postProcessingController = null,
  }) {
    stylizedConfig = terrainRendererProfile(stylizedConfig, rendererConfig);
    this.container = container;
    this.tileMap = tileMap;
    this.heightField = heightField;
    this.worldStore = worldStore;
    this.floatingOrigin = floatingOrigin;
    this.streamingConfig = streamingConfig;
    this.rendererConfig = rendererConfig;
    this.stylizedConfig = stylizedConfig;
    this.postProcessing = postProcessingController;
    this.rendererBackendStatus = Object.freeze({
      mode: 'uninitialized',
      webgpu: false,
      webgl: false,
    });
    this.surfaceMaskConfig = createSurfaceMaskConfig(stylizedConfig, { tileSize: worldStore.tileSize });
    this.chunkSize = worldStore.chunkSize;
    this.surfaceMaskChunkRadius = getSurfaceMaskChunkRadius(
      this.surfaceMaskConfig.blendCells,
      this.chunkSize,
      worldStore.tileSize,
    );
    this.chunkWorldSize = this.chunkSize * worldStore.tileSize;
    this.waterDistanceField = createWaterDistanceField(this, stylizedConfig);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.pickPoint = new THREE.Vector3();
    this.lastFocus = null;
    this.lastFocusTimestamp = null;
    this.focusChunkKey = null;
    this.predictedChunk = { chunkX: 0, chunkZ: 0 };
    this.streamingChunkState = new Float64Array(4);
    this.streamingChunkState.fill(Number.POSITIVE_INFINITY);
    this.clock = 0;
    this.contentRevision = 0;
    this.nextRetryAt = Number.POSITIVE_INFINITY;
    this.disposed = false;
    this.focusChunk = { chunkX: 0, chunkZ: 0 };
    this.focusVelocity = { x: 0, z: 0 };
    this.maxCommitsPerFrameMoving = streamingConfig.maxCommitsPerFrame
      ?? TERRAIN_MAX_COMMITS_PER_FRAME;
    this.maxCommitsPerFrameIdle = Math.max(
      this.maxCommitsPerFrameMoving,
      streamingConfig.maxCommitsPerFrameIdle ?? TERRAIN_MAX_COMMITS_PER_FRAME_IDLE,
    );
    this.commitQueue = new TerrainCommitQueue({
      maxCommitsPerFrame: this.maxCommitsPerFrameMoving,
      commitBudgetMs: streamingConfig.commitBudgetMs ?? TERRAIN_COMMIT_BUDGET_MS,
    });
    this.pendingFetches = new Set();
    this.streamingListeners = new Set();

    // Ask for the discrete GPU explicitly. Without this the browser is free to
    // place the world view on integrated graphics on hybrid machines, which
    // costs an order of magnitude of frame rate for identical scene content.
    // The workshop preview renderer already requests high-performance.
    // Filled from the adapter just before `init()` requests the device (deviceLimits.js).
    this.requiredLimits = {};
    this.renderer = new THREE.WebGPURenderer({
      antialias: rendererConfig.antialias,
      forceWebGL: rendererConfig.forceWebGL,
      powerPreference: rendererConfig.powerPreference ?? 'high-performance',
      requiredLimits: this.requiredLimits,
      trackTimestamp: new URLSearchParams(window.location.search).get('gpuTimings') === '1',
    });
    this.samplerPruning = installUnusedSamplerPruning(this.renderer);
    this.emptyDrawSkip = installEmptyDrawSkip(this.renderer);
    this.surfaceAnisotropy = installSurfaceAnisotropy(this.renderer, stylizedConfig.enhancements?.surfaceAnisotropy);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, rendererConfig.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Match the workshop preview renderer. Until 2026-07-25 the world used no
    // tone mapping at all while buildings were authored under ACES at 1.12
    // exposure, so a bake never looked the way it did in the workshop and bright
    // greens and limewash clipped on placement.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = rendererConfig.toneMappingExposure ?? 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Drusniel World infinite world editor viewport');
    container.append(this.renderer.domElement);
    // Size the drawing buffer here rather than waiting for the bootstrap's
    // ResizeObserver. Until that observer is installed the canvas keeps the
    // 300x150 HTML default, and early GPU allocations pin that size. Combined
    // with ViewportTextureNode's per-target clones (mitigated by
    // patchViewportFramebufferSources), a late first resize used to leave
    // stale framebuffer copies and WebGPU CopyTextureToTexture validation errors.
    this.resize(container.clientWidth, container.clientHeight);

    this.scene = new THREE.Scene();
    // The scene itself has no transform. Avoid forcing every static descendant
    // to recompute its world matrix in each nested render pass.
    this.scene.updateMatrix();
    this.scene.matrixAutoUpdate = false;
    this.scene.background = new THREE.Color('#0a100c');
    const skyConfig = stylizedConfig?.sky;
    this.godRays = new StylizedGodRaysPostProcess({
      renderer: this.renderer,
      scene: this.scene,
      config: skyConfig?.godRays,
      sunDirection: directionFromAngles(
        skyConfig?.sunElevation ?? 10,
        skyConfig?.sunAzimuth ?? 258,
      ),
      sunColor: skyConfig?.sunColor ?? '#ffffff',
      finish: resolveCinematicFinish(stylizedConfig?.cinematicFinish),
    });
    this.geometry = new THREE.PlaneGeometry(
      this.chunkWorldSize,
      this.chunkWorldSize,
      this.chunkSize,
      this.chunkSize,
    );
    // The valley mist's height patch and uniforms, built here because one terrain
    // material is shared by every slot and has to hold them from construction. The
    // surface view (or main) drives it once a frame — see updateValleyFog.
    this.valleyFogSampling = new SettlementSamplingPreparation(worldStore);
    this.valleyFog = new ValleyFogController({
      getHeight: (x, z) => this.getCanonicalHeight(x, z),
      prepareBounds: (bounds, shouldYield) => this.valleyFogSampling.prepare({
        minX: bounds.minX / worldStore.tileSize, maxX: bounds.maxX / worldStore.tileSize,
        minZ: -bounds.maxZ / worldStore.tileSize, maxZ: -bounds.minZ / worldStore.tileSize,
      }, shouldYield),
      getRevision: () => `${worldStore.baseTerrainRevision}:${worldStore.revision}`,
      config: skyConfig?.valleyFog,
      quality: skyConfig?.valleyFog?.quality,
    });
    // The god rays' sun is the one the sky turns for each time of day.
    const sharedMaterial = createSharedTerrainMaterialSource({
      worldStore,
      stylizedConfig,
      sunDirection: this.godRays.sunDirection,
      valleyFog: this.valleyFog,
    });
    this.slots = Array.from(
      { length: streamingConfig.maxResidentChunks },
      (_, slotIndex) => createSlot({
        slotIndex,
        scene: this.scene,
        geometry: this.geometry,
        worldStore,
        stylizedConfig,
        sharedMaterial,
      }),
    );

    this.preview = new THREE.Mesh(
      new THREE.PlaneGeometry(worldStore.tileSize, worldStore.tileSize),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.preview.rotation.x = -Math.PI / 2;
    this.preview.visible = false;
    this.scene.add(this.preview);

    this.unsubscribeWorld = worldStore.subscribe((change) => this.onWorldChange(change));
  }

  async initialize() {
    if (!this.rendererConfig.forceWebGL) {
      await raiseDeviceLimits(this.requiredLimits, {
        powerPreference: this.rendererConfig.powerPreference ?? 'high-performance',
      });
    }
    await this.renderer.init();
    this.rendererBackendStatus = inspectRendererBackend(this.renderer);
    PerfCounters.set('rendererWebGPUBackend', this.rendererBackendStatus.webgpu ? 1 : 0);
    PerfCounters.set('rendererWebGLBackend', this.rendererBackendStatus.webgl ? 1 : 0);
    // Hi-Z occlusion culling, after `init()` so the backend it gates on exists. It
    // disables itself on anything but the WebGPU backend (GpuOcclusion#init), so it is
    // built whenever the config asks for it and costs nothing where it cannot run.
    const occlusionSettings = this.rendererConfig.gpuOcclusion;
    this.occlusion = occlusionSettings?.enabled
      ? new GpuOcclusion(
        { renderer: this.renderer, scene: this.scene, camera: null },
        occlusionSettings,
      )
      : null;
    if (!this.rendererBackendStatus.webgpu && !this.rendererConfig.forceWebGL) {
      console.warn(
        `WebGPU backend unavailable; using ${this.rendererBackendStatus.mode} fallback. `
        + 'GPU compute vegetation and voxel paths will use their documented fallbacks.',
      );
    }
    await this.updateStreaming({ x: 0, z: 0 }, 0, true);
    await this.drainPendingUploads();
  }

  getRendererBackendStatus() {
    return this.rendererBackendStatus;
  }

  setAnimationLoop(callback) {
    this.renderer.setAnimationLoop(callback);
  }

  resize(width, height) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    this.viewportHeight = nextHeight;
    this.renderer.setSize(nextWidth, nextHeight, false);
    // Drive post targets from the renderer sizes that setSize just committed so
    // CSS/DPR flooring cannot drift between the drawing buffer and history/RTT.
    const size = this.renderer.getSize(_resizeSize);
    this.postProcessing?.resize(size.x, size.y);
  }

  setPostProcessingController(controller) {
    this.postProcessing = controller;
  }

  subscribeStreaming(listener) {
    this.streamingListeners.add(listener);
    return () => this.streamingListeners.delete(listener);
  }

  emitStreaming(event) {
    for (const listener of this.streamingListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Terrain streaming listener failed.', error);
      }
    }
  }

  /**
   * Drive the valley mist for this frame: rebuild its camera-local height patch if
   * the camera moved past its middle, and hand it the sky's live sun and fog
   * colours and the region weight that fades the mist out where there are no
   * gorges. A no-op without the config, so worlds that do not want it pay nothing.
   */
  updateValleyFog({ focus, origin, timeSeconds, weight, sunDirection, sunColor, fogColor, budget } = {}) {
    if (!focus || !origin) return;
    this.valleyFog?.update(focus, origin, { timeSeconds, weight, sunDirection, sunColor, fogColor, budget });
  }

  /**
   * The page's hills as the slot's occluder for the Hi-Z pass: the drawn surface is
   * a flat grid displaced in its shader, so the host supplies the depth proxy and
   * opts the slot in. The slot is also a cull candidate — its fitted bounds cover
   * the page's heights, plus the headroom the material adds.
   */
  attachOccluderProxy(slot, page) {
    const userData = slot.mesh.userData;
    userData.occlusionGeometry?.dispose();
    userData.occlusionGeometry = null;
    if (!this.rendererConfig.gpuOcclusion?.enabled) return;
    userData.occlusionGeometry = createTerrainOccluderGeometry({
      heights: page.heights,
      chunkSize: this.worldStore.chunkSize,
      tileSize: this.worldStore.tileSize,
    });
    userData.occlusionOccluder = true;
    userData.occlusionUpright = true;
    userData.occlusionPadding = 2;
  }

  render(camera) {
    this.finishApplications = 0;
    this.activeRenderPath = 'direct';
    this.beforeMainRender?.(camera);
    const draw = () => {
      if (
        this.godRays.enabled
        && ['volumetric', 'cinematic'].includes(this.godRays.technique)
        && this.godRays.render(camera)
      ) {
        this.activeRenderPath = `${this.godRays.technique}-god-rays`;
        this.finishApplications = this.godRays.technique === 'cinematic' ? 1 : 0;
        return;
      }
      if (this.postProcessing?.render(camera)) { this.activeRenderPath = 'post-processing'; return; }
      if (!this.godRays.render(camera)) {
        this.renderer.render(this.scene, camera);
      }
    };
    if (!this.occlusion) {
      draw();
      this.afterMainRender?.(camera);
      return;
    }
    // Hi-Z prepare runs immediately before the frame's draw, and its indirect-record
    // bridge stays installed across it. The bridge is geometry-keyed — only a draw
    // whose geometry has no indirect record of its own is redirected — so the post
    // passes inside the same pipeline call are untouched, and this project's
    // compute-compacted impostor and voxel draws are never candidates.
    this.occlusion.world.camera = camera;
    this.occlusion.prepare();
    this.occlusion.render(draw);
    this.afterMainRender?.(camera);
    const stats = this.occlusion.stats;
    PerfCounters.set(PERF_COUNTER_OCCLUSION_CANDIDATES, stats.candidates);
    PerfCounters.set(PERF_COUNTER_OCCLUSION_OCCLUDERS, stats.occluders);
    PerfCounters.set(PERF_COUNTER_OCCLUSION_CULLED_DRAWS, stats.culledDraws);
    PerfCounters.set(PERF_COUNTER_OCCLUSION_PREPARE_MS, this.occlusion.lastPrepareMs);
  }

  prewarmPostProcessing(camera) {
    if (this.godRays.enabled && ['volumetric', 'cinematic'].includes(this.godRays.technique)) {
      return this.godRays.prewarm(camera);
    }
    if (this.postProcessing?.warmup(camera)) return true;
    return this.godRays.prewarm(camera);
  }

  getStreamingStatus() {
    return Object.freeze({
      resident: this.slots.filter((slot) => slot.key && slot.mesh.visible).length,
      loading: this.slots.filter((slot) => slot.loading).length,
      pendingCommits: this.commitQueue.size,
      maxQueuedCommitAgeMs: this.commitQueue.maxQueuedAgeMs,
      capacity: this.slots.length,
      focusChunk: this.focusChunkKey,
      unavailableReason: this.worldStore.chunkWorker?.unavailableReason ?? null,
      cache: this.worldStore.getStats(),
      origin: this.floatingOrigin.getState(),
    });
  }

  cutToCanonical({ x, z }, timestamp = performance.now()) {
    if (![x, z, timestamp].every(Number.isFinite)) throw new Error('Camera cut coordinates and timestamp must be finite.');
    this.lastFocus = { x, z };
    this.lastFocusTimestamp = timestamp;
    this.focusVelocity.x = 0;
    this.focusVelocity.z = 0;
    this.streamingChunkState?.fill(Number.POSITIVE_INFINITY);
    this.updateStreamingFrame({ x, z }, timestamp, true);
  }

  async updateStreaming(focusWorld, timestamp = performance.now(), force = false) {
    this.updateStreamingFrame(focusWorld, timestamp, force);
  }

  updateStreamingFrame(focusWorld, timestamp = performance.now(), force = false) {
    if (this.disposed) return;
    const velocity = this.calculateVelocity(focusWorld, timestamp);
    this.focusVelocity = velocity;

    // The resident set is a pure function of the current + predicted chunk.
    // Compute both cheaply and skip the expensive descriptor rebuild when
    // neither changed, so steady-state frames don't churn Maps/sorts.
    const tileSize = this.worldStore.tileSize;
    const prefetchSeconds = this.streamingConfig.prefetchSeconds;
    const currentChunk = writeTerrainChunk(
      focusWorld.x,
      focusWorld.z,
      tileSize,
      this.chunkSize,
      this.focusChunk,
    );
    const predictedChunk = writeTerrainChunk(
      focusWorld.x + velocity.x * prefetchSeconds,
      focusWorld.z + velocity.z * prefetchSeconds,
      tileSize,
      this.chunkSize,
      this.predictedChunk ??= { chunkX: 0, chunkZ: 0 },
    );
    if (!this.streamingChunkState) {
      this.streamingChunkState = new Float64Array(4);
      this.streamingChunkState.fill(Number.POSITIVE_INFINITY);
    }
    const chunkState = this.streamingChunkState;
    const changed = currentChunk.chunkX !== chunkState[0]
      || currentChunk.chunkZ !== chunkState[1]
      || predictedChunk.chunkX !== chunkState[2]
      || predictedChunk.chunkZ !== chunkState[3];

    if (!force && !changed) {
      this.retryFailedSlots(timestamp);
      return;
    }
    chunkState[0] = currentChunk.chunkX;
    chunkState[1] = currentChunk.chunkZ;
    chunkState[2] = predictedChunk.chunkX;
    chunkState[3] = predictedChunk.chunkZ;
    this.focusChunkKey = `${currentChunk.chunkX}:${currentChunk.chunkZ}`
      + `|${predictedChunk.chunkX}:${predictedChunk.chunkZ}`;
    this.clock += 1;

    const selection = selectTerrainResidentDescriptors({
      focusWorld,
      velocity,
      tileSize,
      chunkSize: this.chunkSize,
      loadRadius: this.streamingConfig.loadRadius,
      unloadRadius: this.streamingConfig.unloadRadius,
      prefetchSeconds,
      slotCount: this.slots.length,
    });
    const plan = createTerrainSlotPlan({
      slots: this.slots,
      targets: selection.descriptors,
      focusChunk: selection.currentChunk,
    });
    const reassigned = plan.assignments.filter(({ evictedKey }) => evictedKey).length;
    if (reassigned > Math.max(1, Math.floor(this.slots.length / 2))) {
      this.emitStreaming(Object.freeze({
        kind: 'mass-chunk-reassignment',
        count: reassigned,
      }));
    }
    for (const slotIndex of plan.retained) {
      this.slots[slotIndex].lastUsed = this.clock;
    }
    for (const assignment of plan.assignments) {
      const slot = this.slots[assignment.slotIndex];
      // If this slot held a chunk that's no longer wanted and its generation
      // hasn't started, drop it so a wanted chunk can take the worker instead.
      if (assignment.evictedKey && slot.descriptor
          && typeof this.worldStore.cancelChunk === 'function') {
        this.worldStore.cancelChunk(slot.descriptor.chunkX, slot.descriptor.chunkZ);
      }
      void this.assignSlot(slot, assignment.descriptor);
    }
    this.retryFailedSlots(timestamp);
    this.positionSlots();
  }

  retryFailedSlots(timestamp) {
    if (timestamp < (this.nextRetryAt ?? Number.POSITIVE_INFINITY)) return;
    let nextRetryAt = Number.POSITIVE_INFINITY;
    for (const slot of this.slots) {
      if (slot.loading || !slot.descriptor || slot.retryAt == null) continue;
      if (timestamp >= slot.retryAt) {
        void this.assignSlot(slot, slot.descriptor);
      } else {
        nextRetryAt = Math.min(nextRetryAt, slot.retryAt);
      }
    }
    this.nextRetryAt = nextRetryAt;
  }

  calculateVelocity(focusWorld, timestamp) {
    const velocity = this.focusVelocity;
    velocity.x = 0;
    velocity.z = 0;
    if (this.lastFocus && Number.isFinite(this.lastFocusTimestamp)) {
      const deltaSeconds = Math.max(0.001, (timestamp - this.lastFocusTimestamp) / 1000);
      const dx = focusWorld.x - this.lastFocus.x;
      const dz = focusWorld.z - this.lastFocus.z;
      if (Math.hypot(dx, dz) <= Math.max(2 * this.chunkWorldSize, 250 * deltaSeconds)) {
        velocity.x = dx / deltaSeconds;
        velocity.z = dz / deltaSeconds;
      }
    }
    if (this.lastFocus) {
      this.lastFocus.x = focusWorld.x;
      this.lastFocus.z = focusWorld.z;
    } else {
      this.lastFocus = { x: focusWorld.x, z: focusWorld.z };
    }
    this.lastFocusTimestamp = timestamp;
    return velocity;
  }

  async assignSlot(slot, descriptor, { retainVisible = false } = {}) {
    if (this.disposed) return;
    PerfCounters.inc('terrainAssignSlots');
    slot.token += 1;
    const token = slot.token;
    slot.key = descriptor.key;
    slot.descriptor = descriptor;
    slot.lastUsed = this.clock;
    slot.loading = true;
    slot.retryAt = null;
    if (!retainVisible) slot.mesh.visible = false;
    this.positionSlot(slot);

    const requestPriority = this.focusChunk
      ? Math.max(
        Math.abs(descriptor.chunkX - this.focusChunk.chunkX),
        Math.abs(descriptor.chunkZ - this.focusChunk.chunkZ),
      )
      : 0;
    const fetchPromise = Promise.resolve()
      .then(() => {
        if (this.disposed || slot.token !== token) return null;
        return this.worldStore.requestChunk(
          descriptor.chunkX,
          descriptor.chunkZ,
          { priority: requestPriority },
        );
      })
      .then((page) => {
        if (this.disposed || slot.token !== token || slot.key !== descriptor.key) {
          if (slot.token === token) {
            slot.loading = false;
          }
          return;
        }
        this.commitQueue.enqueue(createTerrainCommitJob({
          slot,
          page,
          token,
          priority: commitPriority({
            descriptor,
            focusChunk: this.focusChunk,
            velocity: this.focusVelocity,
          }),
        }));
      })
      .catch((error) => {
        if (!this.disposed && slot.token === token) {
          slot.loading = false;
          // Retained slots are otherwise skipped even after a focus change.
          // Back off instead of leaving a permanent hole or retrying every frame.
          slot.retryAt = error?.streamingUnavailable ? null
            : performance.now() + TERRAIN_REQUEST_RETRY_DELAY_MS;
          if (slot.retryAt !== null) {
            this.nextRetryAt = Math.min(
              this.nextRetryAt ?? Number.POSITIVE_INFINITY,
              slot.retryAt,
            );
          }
        }
        // Cancellation is an intentional optimization, not a failure.
        if (!this.disposed && !error?.cancelled) {
          console.error('Terrain chunk request failed.', error);
        }
      });

    this.pendingFetches.add(fetchPromise);
    try {
      await fetchPromise;
    } finally {
      this.pendingFetches.delete(fetchPromise);
    }
  }

  ensurePageRenderPixels(page) {
    if (this.worldStore.renderPagesPreparedInWorker) {
      if (page.renderPixelsDirty) throw new Error('Terrain publication requires a current worker page.');
      return page;
    }
    if (page.tilePixels && page.surfaceMaskPixels && !page.renderPixelsDirty) {
      return page;
    }
    if (typeof this.worldStore.refreshPageRenderPixels === 'function') {
      return this.worldStore.refreshPageRenderPixels(page);
    }
    return enrichPageRenderPixels(
      page,
      (cellX, cellZ) => this.worldStore.getTile(cellX, cellZ),
      {...this.surfaceMaskConfig, worldSeed:this.worldStore.generator?.toMetadata?.().seed ?? 0},
      tileId => this.worldStore.generator?.getTileDefinition?.(tileId),
      {sampleHeight:(x,z)=>this.worldStore.getHeight(x,z),
        sampleWater:(x,z)=>this.worldStore.sampleWater?.(x,z) ?? this.worldStore.generator?.sampleWater?.(x,z)},
    );
  }

  /**
   * Main-thread materialization only: typed-array copies + texture flags.
   * Must not call getTile / generate masks (worker already did that).
   */
  commitPage(slot, page) {
    const ready = this.ensurePageRenderPixels(page);
    if (!ready.tilePixels || !ready.surfaceMaskPixels) {
      throw new Error('Terrain page commit requires tilePixels and surfaceMaskPixels.');
    }
    const streamedIn = slot.page !== ready;
    const commitStartedAt = performance.now();
    slot.texturePixels.set(ready.tilePixels);
    slot.surfaceMaskPixels.set(ready.surfaceMaskPixels);
    slot.heightPixels.set(ready.heights);
    fitSlotBounds(slot.mesh.geometry, ready.heights, this.chunkWorldSize);
    this.attachOccluderProxy(slot, ready);
    slot.tileTexture.needsUpdate = true;
    slot.surfaceMaskTexture.needsUpdate = true;
    slot.heightTexture.needsUpdate = true;
    slot.page = ready;
    slot.pageRevision = ready.revision;
    this.contentRevision = (this.contentRevision ?? 0) + 1;
    slot.mesh.visible = true;
    slot.loading = false;
    slot.retryAt = null;
    if (streamedIn) {
      this.emitStreaming(Object.freeze({
        kind: 'chunk-streamed-in',
        chunkX: slot.descriptor.chunkX,
        chunkZ: slot.descriptor.chunkZ,
      }));
    }
    const textureCommitMs = performance.now() - commitStartedAt;
    PerfCounters.inc('terrainUploadPages');
    PerfCounters.inc('textureCommitMs', textureCommitMs);
    PerfCounters.set('textureCommit', textureCommitMs);
    const timings = ready.timings;
    if (timings) {
      if (Number.isFinite(timings.workerCompleteMs)) {
        PerfCounters.inc('workerCompleteMs', timings.workerCompleteMs);
        PerfCounters.set('workerComplete', timings.workerCompleteMs);
      }
      if (Number.isFinite(timings.queueWaitMs)) {
        PerfCounters.inc('queueWaitMs', timings.queueWaitMs);
        PerfCounters.set('queueWait', timings.queueWaitMs);
      }
      if (Number.isFinite(timings.tilePixelsMs)) {
        PerfCounters.inc('tilePixelsMs', timings.tilePixelsMs);
        PerfCounters.set('tilePixels', timings.tilePixelsMs);
      }
      if (Number.isFinite(timings.surfaceMaskMs)) {
        PerfCounters.inc('surfaceMaskMs', timings.surfaceMaskMs);
        PerfCounters.set('surfaceMask', timings.surfaceMaskMs);
      }
      if (Number.isFinite(timings.grassScatterMs)) {
        PerfCounters.inc('grassScatterMs', timings.grassScatterMs);
        PerfCounters.set('grassScatter', timings.grassScatterMs);
      }
      if (Number.isFinite(timings.flowerScatterMs)) {
        PerfCounters.inc('flowerScatterMs', timings.flowerScatterMs);
        PerfCounters.set('flowerScatter', timings.flowerScatterMs);
      }
    }
    const bytes = (ready.tilePixels.byteLength ?? 0)
      + (ready.surfaceMaskPixels.byteLength ?? 0)
      + (ready.heights.byteLength ?? 0);
    PerfCounters.inc('textureBytesUploaded', bytes);
  }

  /**
   * Per-frame commit budget adapts to motion and backlog: stay conservative
   * while moving, including a chunk-boundary backlog. CPU copy time does not
   * include the GPU uploads and new draws that publication triggers later.
   */
  adaptiveCommitBudget() {
    const speed = Math.hypot(this.focusVelocity.x, this.focusVelocity.z);
    const moving = speed > TERRAIN_MOVING_SPEED_EPSILON;
    return moving ? this.maxCommitsPerFrameMoving : this.maxCommitsPerFrameIdle;
  }

  flushUploadQueue(options = {}) {
    if (this.disposed || this.commitQueue.size === 0) {
      return { committed: 0, remaining: 0, maxQueuedAgeMs: this.commitQueue.maxQueuedAgeMs };
    }
    const flushOptions = options.maxCommits === undefined
      ? { ...options, maxCommits: this.adaptiveCommitBudget() }
      : options;
    const result = this.commitQueue.flush(
      (job) => {
        const waitMs = performance.now() - job.enqueuedAt;
        PerfCounters.inc('commitQueueWaitMs', waitMs);
        PerfCounters.set('commitQueueWait', waitMs);
        this.commitPage(job.slot, job.page);
      },
      (job) => (
        !this.disposed
        && job.slot.token === job.token
        && job.slot.key === job.slot.descriptor?.key
      ),
      flushOptions,
    );
    PerfCounters.set('maxQueuedCommitAgeMs', result.maxQueuedAgeMs);
    return result;
  }

  async drainPendingUploads() {
    while (!this.disposed && (this.pendingFetches.size > 0 || this.commitQueue.size > 0)) {
      if (this.pendingFetches.size > 0) {
        await Promise.allSettled([...this.pendingFetches]);
      }
      this.commitQueue.drain(
        (job) => this.commitPage(job.slot, job.page),
        (job) => (
          !this.disposed
          && job.slot.token === job.token
          && job.slot.key === job.slot.descriptor?.key
        ),
      );
    }
  }

  /** Editor paint/sculpt path — mark dirty then memcpy commit. */
  uploadPage(slot, page) {
    page.renderPixelsDirty = true;
    this.commitPage(slot, page);
  }

  positionSlots() {
    for (const slot of this.slots) {
      this.positionSlot(slot);
    }
    if (this.preview.visible && this.preview.userData.cell) {
      this.positionPreview(this.preview.userData.cell);
    }
  }

  positionSlot(slot) {
    if (!slot.descriptor) {
      return;
    }
    const render = this.floatingOrigin.toRender(
      slot.descriptor.centerWorldX,
      slot.descriptor.centerWorldZ,
    );
    slot.mesh.position.set(render.x, 0, render.z);
    slot.chunkCenter.value.set(slot.descriptor.centerWorldX, slot.descriptor.centerWorldZ);
    slot.coastPatterns.update(slot.descriptor.centerWorldX, slot.descriptor.centerWorldZ);
    slot.transitionPatterns.update(slot.descriptor.centerWorldX, slot.descriptor.centerWorldZ);
  }

  onWorldChange(change) {
    if (change.kind === 'reset') {
      this.commitQueue.clear();
      for (const slot of this.slots) {
        if (slot.descriptor) {
          void this.assignSlot(slot, slot.descriptor);
        }
      }
      return;
    }
    const coordinates = change.cells ?? change.vertices ?? [];
    const affected = new Set();
    for (const coordinate of coordinates) {
      const chunkX = Math.floor(coordinate.x / this.chunkSize);
      const chunkZ = Math.floor(coordinate.z / this.chunkSize);
      const radius = Math.max(1, this.surfaceMaskChunkRadius);
      const minimumOffset = this.worldStore.renderPagesPreparedInWorker ? -radius
        : change.kind === 'tile' ? -this.surfaceMaskChunkRadius : -1;
      const maximumOffset = this.worldStore.renderPagesPreparedInWorker ? radius
        : change.kind === 'tile' ? this.surfaceMaskChunkRadius : 0;
      for (let offsetZ = minimumOffset; offsetZ <= maximumOffset; offsetZ += 1) {
        for (let offsetX = minimumOffset; offsetX <= maximumOffset; offsetX += 1) {
          affected.add(`${chunkX + offsetX}:${chunkZ + offsetZ}`);
        }
      }
    }
    for (const slot of this.slots) {
      if (slot.key && affected.has(slot.key)) {
        if (this.worldStore.renderPagesPreparedInWorker) {
          // Keep the last valid visual while workers resolve the authored edit.
          // A new token also invalidates any queued publication of the old page.
          void this.assignSlot(slot, slot.descriptor, { retainVisible: true });
          continue;
        }
        const page = this.worldStore.getChunk(slot.descriptor.chunkX, slot.descriptor.chunkZ);
        if (change.kind === 'tile') {
          page.renderPixelsDirty = true;
        }
        this.uploadPage(slot, page);
      }
    }
    if (change.kind === 'height' && this.preview.visible && this.preview.userData.cell) {
      this.positionPreview(this.preview.userData.cell);
    }
  }

  refreshAll() {
    for (const slot of this.slots) {
      if (slot.descriptor) {
        if (this.worldStore.renderPagesPreparedInWorker) {
          void this.assignSlot(slot, slot.descriptor, { retainVisible: true });
          continue;
        }
        const page = this.worldStore.getChunk(slot.descriptor.chunkX, slot.descriptor.chunkZ);
        this.uploadPage(slot, page);
      }
    }
    this.positionSlots();
  }

  updatePatch() {
    // World-store notifications update resident slots directly.
  }

  updateHeightPatch() {
    // World-store notifications update resident slots directly.
  }

  pickWorld(clientX, clientY, camera) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);
    this.pickPlane.constant = 0;
    if (!this.raycaster.ray.intersectPlane(this.pickPlane, this.pickPoint)) {
      return null;
    }
    for (let iteration = 0; iteration < PICK_ITERATIONS; iteration += 1) {
      const height = this.getWorldHeight(this.pickPoint.x, this.pickPoint.z);
      this.pickPlane.constant = -height;
      if (!this.raycaster.ray.intersectPlane(this.pickPlane, this.pickPoint)) {
        return null;
      }
    }
    return Object.freeze({ x: this.pickPoint.x, z: this.pickPoint.z });
  }

  pickCell(clientX, clientY, camera) {
    const world = this.pickWorld(clientX, clientY, camera);
    if (!world) {
      return null;
    }
    const canonical = this.floatingOrigin.toCanonical(world.x, world.z);
    return worldToCell(canonical.x, canonical.z, this.worldStore.tileSize);
  }

  getWorldHeight(renderX, renderZ) {
    const canonical = this.floatingOrigin.toCanonical(renderX, renderZ);
    return this.getCanonicalHeight(canonical.x, canonical.z);
  }

  getCanonicalHeight(worldX, worldZ) {
    const cellX = worldX / this.worldStore.tileSize;
    const cellZ = -worldZ / this.worldStore.tileSize;
    return this.heightField.sample(cellX, cellZ);
  }

  /**
   * World-unit distance to the nearest water tile, or Infinity past the
   * configured range. Backs the riparian term in the forest habitat field, which
   * accepts this as an optional provider. Measured from the canonical tile map so
   * it cannot vary with chunk residency or approach direction.
   */
  getCanonicalWaterDistance(worldX, worldZ) {
    if (!this.waterDistanceField) return Number.POSITIVE_INFINITY;
    return this.waterDistanceField.worldDistanceAt(worldX, worldZ);
  }

  setPreview(cell, brushSize, color) {
    if (!cell) {
      this.preview.visible = false;
      this.preview.userData.cell = null;
      return;
    }
    this.preview.userData.cell = cell;
    this.positionPreview(cell);
    this.preview.scale.set(brushSize, brushSize, 1);
    this.preview.material.color.set(color);
    this.preview.visible = true;
  }

  positionPreview(cell) {
    const world = this.cellToWorld(cell.x, cell.z);
    this.preview.position.set(world.x, world.y + PREVIEW_HEIGHT_OFFSET, world.z);
  }

  cellToWorld(x, z) {
    const canonical = cellCenterToWorld(x, z, this.worldStore.tileSize);
    const render = this.floatingOrigin.toRender(canonical.x, canonical.z);
    return {
      x: render.x,
      y: this.heightField.getCellHeight(x, z),
      z: render.z,
    };
  }

  boundsToWorld(bounds) {
    const min = this.cellToWorld(bounds.minX, bounds.minZ);
    const max = this.cellToWorld(bounds.maxX, bounds.maxZ);
    return {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    };
  }

  updateFloatingOrigin(renderFocus) {
    const event = this.floatingOrigin.update(renderFocus);
    if (event) {
      this.positionSlots();
    }
    return event;
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.surfaceAnisotropy?.dispose();
    this.emptyDrawSkip?.dispose();
    this.samplerPruning?.dispose();
    if (typeof this.worldStore.cancelChunk === 'function') {
      for (const slot of this.slots) {
        if (slot.loading && slot.descriptor) {
          this.worldStore.cancelChunk(slot.descriptor.chunkX, slot.descriptor.chunkZ);
        }
      }
    }
    this.commitQueue.clear();
    this.pendingFetches.clear();
    this.streamingListeners.clear();
    this.setAnimationLoop(null);
    this.unsubscribeWorld?.();
    this.preview.geometry.dispose();
    this.preview.material.dispose();
    // Slots share one material; each mesh carries its own bake state.
    new Set(this.slots.map((slot) => slot.material)).forEach((material) => material.dispose());
    this.valleyFog?.dispose();
    this.valleyFogSampling?.dispose();
    this.valleyFog = null;
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      slot.mesh.dispatchEvent({ type: 'dispose' });
      slot.tileTexture.dispose();
      slot.surfaceMaskTexture.dispose();
      slot.mesh.userData?.occlusionGeometry?.dispose();
      slot.heightTexture.dispose();
      slot.forestFloorTexture.dispose();
    }
    this.geometry.dispose();
    this.godRays.dispose();
    this.occlusion?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
