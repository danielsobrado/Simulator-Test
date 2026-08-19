import { PerfCounters } from '../performance/qa/PerfCounters.js';
import {
  clearTerrainMaterialBakeGpu,
  uploadTerrainMaterialBakeGpu,
} from './TerrainMaterialBakeGpu.js';

function createSlotState() {
  return {
    key: null,
    stale: false,
  };
}

export class TerrainMaterialBakeGpuBridge {
  constructor({ terrainView }) {
    if (!terrainView) {
      throw new Error('Terrain material GPU bridge requires a terrain view.');
    }
    this.terrainView = terrainView;
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

  clearSlot(slot, state) {
    if (state.key === null && !state.stale) return;
    clearTerrainMaterialBakeGpu(slot.material);
    state.key = null;
    state.stale = false;
  }

  updateSlot(slot, state) {
    const page = slot.materialBake;
    if (!page?.descriptor?.key || !slot.descriptor || !slot.mesh.visible) {
      this.clearSlot(slot, state);
      return false;
    }

    const stale = Boolean(slot.materialBakeStale);
    if (state.key === page.descriptor.key && state.stale === stale) return true;

    const bytes = uploadTerrainMaterialBakeGpu(slot.material, page, { stale });
    if (bytes > 0) {
      PerfCounters.inc('terrainMaterialBakeGpuUploads');
      PerfCounters.inc('terrainMaterialBakeGpuUploadBytes', bytes);
    }
    state.key = page.descriptor.key;
    state.stale = stale;
    return true;
  }

  update() {
    if (this.disposed) return;
    let readySlots = 0;
    let staleSlots = 0;
    const activeSlotIndexes = new Set();

    for (const slot of this.terrainView.slots) {
      activeSlotIndexes.add(slot.slotIndex);
      const state = this.stateFor(slot);
      if (this.updateSlot(slot, state)) {
        readySlots += 1;
        if (state.stale) staleSlots += 1;
      }
    }

    for (const slotIndex of this.states.keys()) {
      if (!activeSlotIndexes.has(slotIndex)) this.states.delete(slotIndex);
    }
    PerfCounters.set('terrainMaterialBakeGpuReadySlots', readySlots);
    PerfCounters.set('terrainMaterialBakeGpuStaleSlots', staleSlots);
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
  }
}
