import { PerfCounters } from '../performance/qa/PerfCounters.js';
import {
  clearTerrainMaterialBakeGpu,
  getTerrainMaterialBakeGpuState,
  uploadTerrainMaterialBakeGpu,
} from './TerrainMaterialBakeGpu.js';

function clockNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function createSlotState() {
  return {
    key: null,
    stale: false,
    failedKey: null,
    publishedAt: null,
  };
}

export class TerrainMaterialBakeGpuBridge {
  constructor({
    terrainView,
    config = null,
    now = clockNow,
    onError = (error, context) => console.error('Terrain material GPU upload failed.', context, error),
  }) {
    if (!terrainView) {
      throw new Error('Terrain material GPU bridge requires a terrain view.');
    }
    if (typeof now !== 'function') {
      throw new Error('Terrain material GPU bridge clock must be a function.');
    }
    if (typeof onError !== 'function') {
      throw new Error('Terrain material GPU bridge error reporter must be a function.');
    }
    this.terrainView = terrainView;
    this.publishFadeMs = Math.max(0, Number(config?.render?.publishFadeMs) || 0);
    this.now = now;
    this.onError = onError;
    this.states = new Map();
    this.disposed = false;
  }

  stateFor(slot) {
    let state = this.states.get(slot.slotIndex);
    if (!state) {
      state = createSlotState();
      this.states.set(slot.slotIndex, state);
    }
    return state;
  }

  reportError(error, context) {
    try {
      this.onError(error, context);
    } catch {
      // Diagnostics must not interrupt rendering or material fallback.
    }
  }

  clearSlot(slot, state) {
    if (state.key !== null || state.stale) clearTerrainMaterialBakeGpu(slot.material);
    state.key = null;
    state.stale = false;
    state.failedKey = null;
    state.publishedAt = null;
  }

  failSlot(slot, state, page, error) {
    clearTerrainMaterialBakeGpu(slot.material);
    state.key = null;
    state.stale = false;
    state.failedKey = page.descriptor.key;
    state.publishedAt = null;
    PerfCounters.inc('terrainMaterialBakeGpuUploadFailures');
    this.reportError(error, {
      operation: 'upload',
      slotIndex: slot.slotIndex,
      descriptor: page.descriptor,
    });
  }

  advancePublication(slot, state, now) {
    const gpuState = getTerrainMaterialBakeGpuState(slot.material);
    if (!gpuState || gpuState.disposed || gpuState.ready.value < 0.5) return;
    if (gpuState.blend.value >= 1) return;
    if (this.publishFadeMs <= 0 || state.publishedAt === null) {
      gpuState.blend.value = 1;
      return;
    }
    gpuState.blend.value = clamp01((now - state.publishedAt) / this.publishFadeMs);
  }

  updateSlot(slot, state, now) {
    const page = slot.materialBake;
    if (!page?.descriptor?.key || !slot.descriptor || !slot.mesh.visible) {
      this.clearSlot(slot, state);
      return false;
    }
    if (state.failedKey === page.descriptor.key) return false;
    if (state.failedKey !== null) state.failedKey = null;

    const stale = Boolean(slot.materialBakeStale);
    if (state.key === page.descriptor.key && state.stale === stale) {
      this.advancePublication(slot, state, now);
      return true;
    }

    try {
      const previousKey = state.key;
      const bytes = uploadTerrainMaterialBakeGpu(slot.material, page, { stale });
      if (bytes > 0) {
        PerfCounters.inc('terrainMaterialBakeGpuUploads');
        PerfCounters.inc('terrainMaterialBakeGpuUploadBytes', bytes);
      }
      if (previousKey !== page.descriptor.key) {
        const gpuState = getTerrainMaterialBakeGpuState(slot.material);
        if (gpuState) gpuState.blend.value = 0;
        state.publishedAt = now;
      }
      state.key = page.descriptor.key;
      state.stale = stale;
      this.advancePublication(slot, state, now);
      return true;
    } catch (error) {
      this.failSlot(slot, state, page, error);
      return false;
    }
  }

  update() {
    if (this.disposed) return;
    const now = this.now();
    let readySlots = 0;
    let staleSlots = 0;
    let transitioningSlots = 0;
    const activeSlotIndexes = new Set();

    for (const slot of this.terrainView.slots) {
      activeSlotIndexes.add(slot.slotIndex);
      const state = this.stateFor(slot);
      if (this.updateSlot(slot, state, now)) {
        readySlots += 1;
        if (state.stale) staleSlots += 1;
        const gpuState = getTerrainMaterialBakeGpuState(slot.material);
        if (gpuState && gpuState.blend.value < 1) transitioningSlots += 1;
      }
    }

    for (const slotIndex of this.states.keys()) {
      if (!activeSlotIndexes.has(slotIndex)) this.states.delete(slotIndex);
    }
    PerfCounters.set('terrainMaterialBakeGpuReadySlots', readySlots);
    PerfCounters.set('terrainMaterialBakeGpuStaleSlots', staleSlots);
    PerfCounters.set('terrainMaterialBakeGpuTransitioningSlots', transitioningSlots);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.terrainView.slots) {
      clearTerrainMaterialBakeGpu(slot.material);
    }
    this.states.clear();
    PerfCounters.set('terrainMaterialBakeGpuReadySlots', 0);
    PerfCounters.set('terrainMaterialBakeGpuStaleSlots', 0);
    PerfCounters.set('terrainMaterialBakeGpuTransitioningSlots', 0);
  }
}
