import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { TerrainMaterialBakeCache } from './TerrainMaterialBakeCache.js';
import {
  bakeTerrainMaterialPage,
  captureTerrainMaterialBakeSource,
} from './TerrainMaterialBakeCpu.js';
import { createTerrainMaterialBakeDescriptor } from './TerrainMaterialBakeDescriptor.js';

function clockNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createSlotState() {
  return {
    chunkKey: null,
    forestFloorKey: null,
    pendingKey: null,
    generation: 0,
    retryAt: 0,
    lease: null,
  };
}

function validForestFloorKey(slot) {
  const key = slot.forestFloorKey;
  return slot.descriptor && typeof key === 'string' && key.startsWith(`${slot.descriptor.key}:`)
    ? key
    : null;
}

function focusDistance(slot, focus) {
  if (!focus || !slot.descriptor) return 0;
  return Math.max(
    Math.abs(slot.descriptor.chunkX - focus.chunkX),
    Math.abs(slot.descriptor.chunkZ - focus.chunkZ),
  );
}

export class TerrainMaterialBakeRuntime {
  constructor({
    terrainView,
    revisionTracker,
    config,
    cache = null,
    bakePage = bakeTerrainMaterialPage,
    onError = (error, context) => console.error('Terrain material bake failed.', context, error),
  }) {
    if (!terrainView || !revisionTracker) {
      throw new Error('Terrain material bake runtime requires terrain view and revision tracker.');
    }
    if (typeof bakePage !== 'function') {
      throw new Error('Terrain material bake runtime baker must be a function.');
    }
    this.terrainView = terrainView;
    this.revisionTracker = revisionTracker;
    this.config = config;
    this.enabled = Boolean(config?.enabled);
    this.bakePage = bakePage;
    this.onError = onError;
    this.cache = this.enabled
      ? cache ?? new TerrainMaterialBakeCache({
        config,
        onError: (error, context) => this.reportError(error, context),
      })
      : null;
    this.states = new Map();
    this.disposed = false;
    if (this.enabled) {
      terrainView.materialBakeRuntime = this;
      for (const slot of terrainView.slots) {
        slot.materialBake = null;
        slot.materialBakeStale = false;
      }
    }
  }

  reportError(error, context) {
    try {
      this.onError?.(error, context);
    } catch {
      // Diagnostics must not break material-cache lifecycle guarantees.
    }
  }

  worldSeed() {
    const seed = this.terrainView.worldStore.generator?.toMetadata?.().seed;
    return Number.isSafeInteger(seed) ? seed : 0;
  }

  stateFor(slot) {
    let state = this.states.get(slot.slotIndex);
    if (!state) {
      state = createSlotState();
      this.states.set(slot.slotIndex, state);
    }
    return state;
  }

  clearLease(slot, state) {
    state.lease?.release();
    state.lease = null;
    slot.materialBake = null;
    slot.materialBakeStale = false;
  }

  resetStateForChunk(slot, state) {
    state.generation += 1;
    this.clearLease(slot, state);
    state.chunkKey = slot.descriptor?.key ?? null;
    state.forestFloorKey = validForestFloorKey(slot);
    state.pendingKey = null;
    state.retryAt = 0;
  }

  syncCanopyRevision(slot, state) {
    const key = validForestFloorKey(slot);
    if (state.forestFloorKey === key) return;
    state.forestFloorKey = key;
    this.revisionTracker.touchMaterialField(
      slot.descriptor.chunkX,
      slot.descriptor.chunkZ,
      'canopy',
    );
  }

  descriptorFor(slot) {
    const { chunkX, chunkZ } = slot.descriptor;
    return createTerrainMaterialBakeDescriptor({
      chunkX,
      chunkZ,
      quality: this.config.quality,
      revisions: this.revisionTracker.materialRevisionsFor(chunkX, chunkZ, {
        tileHalo: this.terrainView.surfaceMaskChunkRadius ?? 0,
      }),
    });
  }

  captureSource(slot) {
    const hasCanopy = Boolean(validForestFloorKey(slot));
    return captureTerrainMaterialBakeSource({
      page: slot.page,
      canopyPixels: hasCanopy ? slot.forestFloorPixels : null,
      canopySize: hasCanopy ? slot.forestFloorSize : 0,
    });
  }

  prepareSlot(slot, state) {
    if (state.chunkKey !== slot.descriptor.key) this.resetStateForChunk(slot, state);
    this.syncCanopyRevision(slot, state);
    const descriptor = this.descriptorFor(slot);
    if (state.lease && state.lease.descriptor.key !== descriptor.key) {
      slot.materialBakeStale = true;
    }
    return descriptor;
  }

  installLease(slot, state, descriptor, lease, generation) {
    if (this.disposed
        || generation !== state.generation
        || slot.descriptor?.key !== state.chunkKey) {
      lease.release();
      return false;
    }
    this.clearLease(slot, state);
    state.lease = lease;
    slot.materialBake = lease.value;
    slot.materialBakeStale = lease.stale;
    return true;
  }

  retryLater(state, descriptor, error) {
    state.pendingKey = null;
    state.retryAt = clockNow() + this.config.build.retryDelayMs;
    this.reportError(error, { operation: 'bake', descriptor });
  }

  waitForFresh(slot, state, descriptor, generation) {
    void this.cache.whenResident(descriptor)
      .then((resident) => {
        if (resident
            && !this.disposed
            && generation === state.generation
            && slot.descriptor?.key === state.chunkKey) {
          state.pendingKey = null;
          state.retryAt = 0;
        }
      })
      .catch((error) => {
        if (!this.disposed && generation === state.generation) {
          this.retryLater(state, descriptor, error);
        }
      });
  }

  requestSlot(slot, state, descriptor, now) {
    if (state.lease?.descriptor.key === descriptor.key && !state.lease.stale) return false;
    if (state.pendingKey === descriptor.key || now < state.retryAt) return false;

    const source = this.captureSource(slot);
    const generation = state.generation + 1;
    state.generation = generation;
    state.pendingKey = descriptor.key;
    const build = async () => {
      const result = await this.bakePage({
        source,
        descriptor,
        config: this.config,
        chunkSize: this.terrainView.chunkSize,
        tileSize: this.terrainView.worldStore.tileSize,
        worldSeed: this.worldSeed(),
      });
      PerfCounters.inc('terrainMaterialBakeCpuMs', result.value.durationMs ?? 0);
      return result;
    };

    void this.cache.acquire(descriptor, build)
      .then((lease) => {
        if (!this.installLease(slot, state, descriptor, lease, generation)) return;
        if (lease.stale) {
          this.waitForFresh(slot, state, descriptor, generation);
          return;
        }
        state.pendingKey = null;
        state.retryAt = 0;
      })
      .catch((error) => {
        if (!this.disposed && generation === state.generation) {
          this.retryLater(state, descriptor, error);
        }
      });
    return true;
  }

  publishCounters() {
    const stats = this.cache.getStats();
    PerfCounters.set('terrainMaterialBakeEntries', stats.entries);
    PerfCounters.set('terrainMaterialBakeResidentBytes', stats.residentBytes);
    PerfCounters.set('terrainMaterialBakeInFlight', stats.inFlight);
    PerfCounters.set('terrainMaterialBakeActiveLeases', stats.activeLeases);
    PerfCounters.set('terrainMaterialBakeHits', stats.hits);
    PerfCounters.set('terrainMaterialBakeMisses', stats.misses);
    PerfCounters.set('terrainMaterialBakeBuildFailures', stats.buildFailures);
  }

  update() {
    if (!this.enabled || this.disposed) return;
    const now = clockNow();
    const activeSlotIndexes = new Set();
    const candidates = [];

    for (const slot of this.terrainView.slots) {
      const state = this.stateFor(slot);
      activeSlotIndexes.add(slot.slotIndex);
      if (!slot.descriptor || !slot.page || !slot.mesh.visible) {
        if (state.chunkKey !== null || state.lease) this.resetStateForChunk(slot, state);
        continue;
      }
      candidates.push({ slot, state, descriptor: this.prepareSlot(slot, state) });
    }
    for (const [slotIndex, state] of this.states) {
      if (activeSlotIndexes.has(slotIndex)) continue;
      state.lease?.release();
      this.states.delete(slotIndex);
    }

    candidates.sort((left, right) => (
      focusDistance(left.slot, this.terrainView.focusChunk)
      - focusDistance(right.slot, this.terrainView.focusChunk)
      || left.slot.slotIndex - right.slot.slotIndex
    ));
    let available = Math.max(0, this.config.build.maxConcurrent - this.cache.getStats().inFlight);
    for (const candidate of candidates) {
      if (available <= 0) break;
      if (this.requestSlot(candidate.slot, candidate.state, candidate.descriptor, now)) {
        available -= 1;
      }
    }
    this.publishCounters();
  }

  getStats() {
    return this.cache?.getStats() ?? Object.freeze({
      entries: 0,
      residentBytes: 0,
      activeLeases: 0,
      inFlight: 0,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [slotIndex, state] of this.states) {
      state.generation += 1;
      state.lease?.release();
      const slot = this.terrainView.slots[slotIndex];
      if (slot) {
        slot.materialBake = null;
        slot.materialBakeStale = false;
      }
    }
    this.states.clear();
    this.cache?.dispose();
    if (this.terrainView.materialBakeRuntime === this) {
      this.terrainView.materialBakeRuntime = null;
    }
  }
}
