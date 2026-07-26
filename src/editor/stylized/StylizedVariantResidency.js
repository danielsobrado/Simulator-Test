import { PerfCounters } from '../performance/qa/PerfCounters.js';

/**
 * The key a variant is registered under in `prototypeIndicesByAsset`, and the
 * same key a `BiomeAssetPalette` selection names. Kept identical to the
 * expression in every view's build path so residency and palette pinning agree.
 */
export function variantKey(definition) {
  return definition.id ?? definition.scene;
}

/**
 * Which variants of a layer the given biomes need.
 *
 * A variant with no `tileIds` is authored as eligible everywhere the layer is,
 * so it is always required — those are the generic props that must be present
 * the moment the layer draws anything. Everything else is required only once one
 * of its biomes is inside the prefetch window.
 *
 * `pinnedKeys` are palette selections. A pinned asset is required even when its
 * own `tileIds` does not claim the nearby biome: the user chose it for that
 * biome explicitly, and dropping it would silently fall back to the automatic
 * mix.
 */
export function requiredVariantKeys({ definitions, tileIds, pinnedKeys = null }) {
  const required = new Set();
  for (const definition of definitions ?? []) {
    const key = variantKey(definition);
    if (typeof key !== 'string' || key.length === 0) continue;
    if (pinnedKeys?.has(key)) {
      required.add(key);
      continue;
    }
    if (!Array.isArray(definition.tileIds) || definition.tileIds.length === 0) {
      required.add(key);
      continue;
    }
    if (definition.tileIds.some((tileId) => tileIds.has(tileId))) required.add(key);
  }
  return required;
}

/**
 * Lazy, biome-driven residency for authored scatter variants.
 *
 * Loading every configured variant at boot cost ~35 MB of GLB and 110 KTX2
 * transcodes before the first frame, nearly all of it for biomes the player was
 * nowhere near. This walks the terrain around the focus chunk instead, and pulls
 * a variant in only once one of the biomes it is authored for enters a prefetch
 * window wider than the layer's residency window.
 *
 * Two separate throttles keep that off the frame budget: at most
 * `maxConcurrentLoads` GLB fetches are in flight (their decode and transcode run
 * off-thread), and at most `appliesPerFrame` land per frame, because turning a
 * loaded scene into prototypes and instanced renderers is main-thread work.
 */
export class StylizedVariantResidency {
  constructor({
    terrainView,
    revisionTracker = null,
    biomeAssetPalette = null,
    layers = [],
    prefetchChunks = 4,
    samplesPerChunkAxis = 4,
    appliesPerFrame = 1,
    maxConcurrentLoads = 2,
    rescanIntervalMs = 500,
  }) {
    this.terrainView = terrainView;
    this.revisionTracker = revisionTracker;
    this.biomeAssetPalette = biomeAssetPalette;
    this.layers = layers;
    this.prefetchChunks = prefetchChunks;
    this.samplesPerChunkAxis = Math.max(1, samplesPerChunkAxis);
    this.appliesPerFrame = Math.max(1, appliesPerFrame);
    this.maxConcurrentLoads = Math.max(1, maxConcurrentLoads);
    this.rescanIntervalMs = rescanIntervalMs;
    // Every layer scans the same window — the widest one any layer asks for.
    // A layer with a tighter residency then prefetches slightly earlier than it
    // strictly needs to, which is the harmless direction to be wrong in.
    this.scanRadiusChunks = layers.reduce(
      (widest, layer) => Math.max(widest, (layer.residentRadius ?? 1) + prefetchChunks),
      prefetchChunks,
    );
    this.chunkTileCache = new Map();
    this.requested = new Set();
    this.failed = new Set();
    this.pendingLoads = [];
    this.pendingApplies = [];
    this.inFlight = 0;
    this.lastScanAt = -Infinity;
    this.lastScanKey = null;
    this.disposed = false;
  }

  /** `${layerId}|${variantKey}`, the identity used by every queue here. */
  static requestId(layerId, key) {
    return `${layerId}|${key}`;
  }

  /**
   * Tile IDs present within the prefetch window.
   *
   * Sampled on a sparse grid rather than per cell: this only has to discover
   * which biomes are nearby, and a biome large enough to be worth streaming a
   * prop set for is far wider than the sample stride.
   */
  scanNearbyTileIds() {
    const focus = this.terrainView.focusChunk;
    const worldStore = this.terrainView.worldStore;
    const chunkSize = worldStore.chunkSize;
    const stride = Math.max(1, Math.floor(chunkSize / this.samplesPerChunkAxis));
    const radius = this.scanRadiusChunks;
    const tileIds = new Set();
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        const offsetX = chunkX - focus.chunkX;
        const offsetZ = chunkZ - focus.chunkZ;
        // Circular window: the corners of the square are further away than the
        // radius promises, and pulling their biomes in early defeats the point.
        if (offsetX * offsetX + offsetZ * offsetZ > radius * radius) continue;
        for (const tileId of this.chunkTileIds(chunkX, chunkZ, chunkSize, stride)) {
          tileIds.add(tileId);
        }
      }
    }
    return tileIds;
  }

  chunkTileIds(chunkX, chunkZ, chunkSize, stride) {
    const cacheKey = `${chunkX}:${chunkZ}`;
    const revision = this.revisionTracker?.signature(chunkX, chunkZ, 0) ?? '';
    const cached = this.chunkTileCache.get(cacheKey);
    if (cached && cached.revision === revision) return cached.tileIds;
    const tileIds = new Set();
    const baseX = chunkX * chunkSize;
    const baseZ = chunkZ * chunkSize;
    for (let localZ = 0; localZ < chunkSize; localZ += stride) {
      for (let localX = 0; localX < chunkSize; localX += stride) {
        const tileId = this.terrainView.tileMap.get(baseX + localX, baseZ + localZ);
        if (Number.isInteger(tileId)) tileIds.add(tileId);
      }
    }
    this.chunkTileCache.set(cacheKey, { revision, tileIds });
    return tileIds;
  }

  /** Palette selections for the nearby biomes, which pin a variant regardless of its own `tileIds`. */
  pinnedKeysForLayer(layer, tileIds) {
    if (!this.biomeAssetPalette || !layer.paletteLayerId) return null;
    const pinned = new Set();
    for (const tileId of tileIds) {
      const key = this.biomeAssetPalette.getSelection(tileId, layer.paletteLayerId);
      if (key) pinned.add(key);
    }
    return pinned;
  }

  rescan() {
    const tileIds = this.scanNearbyTileIds();
    for (const layer of this.layers) {
      const required = requiredVariantKeys({
        definitions: layer.definitions,
        tileIds,
        pinnedKeys: this.pinnedKeysForLayer(layer, tileIds),
      });
      for (const definition of layer.definitions ?? []) {
        const key = variantKey(definition);
        if (!required.has(key)) continue;
        const id = StylizedVariantResidency.requestId(layer.id, key);
        if (this.requested.has(id) || this.failed.has(id)) continue;
        this.requested.add(id);
        this.pendingLoads.push({ layer, definition, id });
      }
    }
    PerfCounters.set('stylizedVariantsPendingLoad', this.pendingLoads.length);
  }

  pumpLoads() {
    while (this.inFlight < this.maxConcurrentLoads && this.pendingLoads.length > 0) {
      const job = this.pendingLoads.shift();
      this.inFlight += 1;
      job.layer.acquire(job.definition.scene).then(
        (scene) => {
          this.inFlight -= 1;
          if (this.disposed) return;
          this.pendingApplies.push({ ...job, scene });
        },
        (error) => {
          this.inFlight -= 1;
          // Marked failed rather than retried: a missing or malformed variant
          // fails the same way every time, and retrying it each rescan would
          // turn one bad path into a permanent fetch loop.
          this.requested.delete(job.id);
          this.failed.add(job.id);
          console.warn(`Stylized variant ${job.definition.scene} failed to load.`, error);
        },
      );
    }
  }

  pumpApplies() {
    let applied = 0;
    while (applied < this.appliesPerFrame && this.pendingApplies.length > 0) {
      const job = this.pendingApplies.shift();
      applied += 1;
      const startedAt = performance.now();
      try {
        job.layer.apply([{ definition: job.definition, scene: job.scene }]);
        PerfCounters.inc('stylizedVariantsApplied');
      } catch (error) {
        this.requested.delete(job.id);
        this.failed.add(job.id);
        console.warn(`Stylized variant ${job.definition.scene} could not be installed.`, error);
      }
      PerfCounters.inc('stylizedVariantApplyMs', performance.now() - startedAt);
    }
  }

  update(now = performance.now()) {
    if (this.disposed || !this.terrainView.focusChunkKey) return;
    // Applies come first so a variant that landed during the previous frame is
    // installed before this frame's scan can queue more work behind it.
    this.pumpApplies();
    const focus = this.terrainView.focusChunk;
    const scanKey = `${focus.chunkX}:${focus.chunkZ}:${this.biomeAssetPalette?.revision ?? 0}`;
    if (scanKey !== this.lastScanKey || now - this.lastScanAt >= this.rescanIntervalMs) {
      this.lastScanKey = scanKey;
      this.lastScanAt = now;
      this.rescan();
    }
    this.pumpLoads();
  }

  dispose() {
    this.disposed = true;
    this.pendingLoads.length = 0;
    this.pendingApplies.length = 0;
    this.chunkTileCache.clear();
    this.requested.clear();
    this.failed.clear();
  }
}
