import { uniform } from 'three/tsl';
import { GpuVoxelChunk } from './GpuVoxelChunk.js';
import { createVoxelStreamingPlan } from './VoxelStreamingPlan.js';
import {
  selectResidentChunkDescriptors,
  selectVoxelStampsForChunk,
  worldToVoxel,
  worldToVoxelChunk,
} from './VoxelWorldLayout.js';

function signatureFor(stamps) {
  return JSON.stringify(stamps.map((stamp) => [
    stamp.id,
    stamp.operation,
    ...stamp.center,
    stamp.radius,
    stamp.strength,
    stamp.smoothness,
  ]));
}

function createSlot(terrainView, layout, slotIndex) {
  const shaderDescriptor = {
    key: `slot-${slotIndex}`,
    offsetX: uniform(0),
    offsetZ: uniform(0),
    centerOffsetX: 0,
    centerOffsetZ: 0,
  };
  return {
    slotIndex,
    key: null,
    descriptor: null,
    lastUsed: 0,
    signature: null,
    chunk: new GpuVoxelChunk({
      terrainView,
      worldLayout: layout,
      descriptor: shaderDescriptor,
    }),
    shaderDescriptor,
  };
}

function aggregateStatus(slots, layout, stampStore, focusChunk) {
  const chunkStates = slots.map((slot) => slot.chunk.getStatus());
  const failed = chunkStates.find((state) => state.code === 'failed');
  const unsupported = chunkStates.find((state) => state.code === 'unsupported');
  const readyCount = chunkStates.filter((state) => state.ready).length;
  const rebuilding = chunkStates.some((state) => state.rebuilding);
  let code = 'pending';
  let error = null;

  if (!layout.enabled) {
    code = 'disabled';
  } else if (failed) {
    code = 'failed';
    error = failed.error;
  } else if (unsupported) {
    code = 'unsupported';
    error = unsupported.error;
  } else if (readyCount === slots.length) {
    code = 'ready';
  }

  return Object.freeze({
    code,
    enabled: layout.enabled,
    supported: code !== 'unsupported',
    ready: code === 'ready',
    visible: chunkStates.some((state) => state.visible),
    rebuilding,
    algorithm: 'marching-cubes',
    chunkCount: slots.length,
    readyChunkCount: readyCount,
    residentChunkCount: slots.filter((slot) => slot.key).length,
    worldChunkGrid: Object.freeze(['∞', '∞']),
    focusChunk: focusChunk ? Object.freeze([focusChunk.chunkX, focusChunk.chunkZ]) : null,
    chunkCells: Object.freeze([
      layout.chunkCellsX,
      layout.chunkCellsY,
      layout.chunkCellsZ,
    ]),
    cells: Object.freeze([Number.POSITIVE_INFINITY, layout.totalCellsY, Number.POSITIVE_INFINITY]),
    stampCount: stampStore?.size ?? 0,
    maxStamps: layout.maxGlobalStamps,
    error,
  });
}

export class GpuVoxelWorld {
  constructor({ terrainView, layout, stampStore }) {
    this.terrainView = terrainView;
    this.layout = layout;
    this.stampStore = stampStore;
    this.slots = Array.from(
      { length: layout.slotCount },
      (_, slotIndex) => createSlot(terrainView, layout, slotIndex),
    );
    this.chunks = this.slots.map((slot) => slot.chunk);
    this.unsubscribeStamps = null;
    this.focusChunk = null;
    this.focusKey = null;
    this.pendingFocusWorld = null;
    this.clock = 0;
    this.visible = layout.visible;
    this.initialized = false;
    this.disposed = false;
  }

  getStatus() {
    return aggregateStatus(this.slots, this.layout, this.stampStore, this.focusChunk);
  }

  async initialize(focusWorld = { x: 0, z: 0 }) {
    if (this.disposed) return this.getStatus();
    this.updateAssignments(focusWorld, false);
    for (const slot of this.slots) {
      if (this.disposed) return this.getStatus();
      await slot.chunk.initialize();
      if (this.disposed) return this.getStatus();
      this.positionSlot(slot);
      slot.chunk.setVisible(this.visible && Boolean(slot.key));
    }
    if (this.disposed) return this.getStatus();
    this.initialized = true;
    this.unsubscribeStamps = this.stampStore?.subscribe((stamps) => {
      this.applyStampSnapshot(stamps);
    });
    return this.getStatus();
  }

  updateAssignments(focusWorld, regenerate = this.initialized) {
    const selection = selectResidentChunkDescriptors(this.layout, focusWorld);
    const focusKey = `${selection.focusChunk.chunkX}:${selection.focusChunk.chunkZ}`;
    if (focusKey === this.focusKey && regenerate) {
      return;
    }

    const plan = createVoxelStreamingPlan({
      slots: this.slots,
      targets: selection.descriptors,
      focusChunk: selection.focusChunk,
    });
    this.focusChunk = selection.focusChunk;
    this.focusKey = focusKey;
    this.clock += 1;

    for (const slotIndex of plan.retained) {
      this.slots[slotIndex].lastUsed = this.clock;
    }
    for (const assignment of plan.assignments) {
      this.assignSlot(
        this.slots[assignment.slotIndex],
        assignment.descriptor,
        regenerate,
      );
    }
  }

  assignSlot(slot, descriptor, regenerate) {
    slot.key = descriptor.key;
    slot.descriptor = descriptor;
    slot.lastUsed = this.clock;
    slot.shaderDescriptor.offsetX.value = descriptor.offsetX;
    slot.shaderDescriptor.offsetZ.value = descriptor.offsetZ;
    slot.shaderDescriptor.centerOffsetX = descriptor.centerWorldX;
    slot.shaderDescriptor.centerOffsetZ = descriptor.centerWorldZ;
    const stamps = selectVoxelStampsForChunk(
      this.stampStore?.list() ?? [],
      descriptor,
      this.layout,
    );
    slot.signature = signatureFor(stamps);
    slot.chunk.stamps = stamps;
    this.positionSlot(slot);

    if (!regenerate) {
      return;
    }

    slot.chunk.setVisible(false);
    slot.chunk.setStamps(stamps).finally(() => {
      if (!this.disposed && slot.key === descriptor.key) {
        this.positionSlot(slot);
        slot.chunk.setVisible(this.visible);
      }
    });
  }

  positionSlot(slot) {
    const group = slot.chunk.group;
    const descriptor = slot.descriptor;
    if (!group || !descriptor) {
      return;
    }
    const render = this.terrainView.floatingOrigin
      ? this.terrainView.floatingOrigin.toRender(descriptor.centerWorldX, descriptor.centerWorldZ)
      : { x: descriptor.centerWorldX, z: descriptor.centerWorldZ };
    const groundHeight = this.terrainView.getCanonicalHeight
      ? this.terrainView.getCanonicalHeight(descriptor.centerWorldX, descriptor.centerWorldZ)
      : this.terrainView.getWorldHeight(render.x, render.z);
    group.position.set(
      render.x,
      groundHeight + this.layout.verticalOffset,
      render.z,
    );
  }

  applyStampSnapshot(stamps) {
    for (const slot of this.slots) {
      if (!slot.descriptor) {
        continue;
      }
      const selected = selectVoxelStampsForChunk(stamps, slot.descriptor, this.layout);
      const signature = signatureFor(selected);
      if (signature === slot.signature) {
        continue;
      }
      slot.signature = signature;
      slot.chunk.setStamps(selected);
    }
  }

  mapCellToVoxel(cellX, cellZ) {
    const render = this.terrainView.cellToWorld(cellX, cellZ);
    const canonical = this.terrainView.floatingOrigin
      ? this.terrainView.floatingOrigin.toCanonical(render.x, render.z)
      : render;
    return worldToVoxel(this.layout, canonical.x, canonical.z);
  }

  setVisible(visible) {
    if (!this.getStatus().ready) {
      return false;
    }
    this.visible = Boolean(visible);
    for (const slot of this.slots) {
      slot.chunk.setVisible(this.visible && Boolean(slot.key));
    }
    return this.visible;
  }

  toggle() {
    return this.setVisible(!this.visible);
  }

  update(focusWorld = { x: 0, z: 0 }) {
    const nextFocus = worldToVoxelChunk(this.layout, focusWorld.x, focusWorld.z);
    const nextKey = `${nextFocus.chunkX}:${nextFocus.chunkZ}`;
    if (nextKey !== this.focusKey) {
      this.pendingFocusWorld = { x: focusWorld.x, z: focusWorld.z };
    }

    const rebuilding = this.slots.some((slot) => slot.chunk.getStatus().rebuilding);
    if (this.pendingFocusWorld && !rebuilding) {
      const pendingFocusWorld = this.pendingFocusWorld;
      this.pendingFocusWorld = null;
      this.updateAssignments(pendingFocusWorld, true);
    }

    for (const slot of this.slots) {
      this.positionSlot(slot);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pendingFocusWorld = null;
    this.unsubscribeStamps?.();
    this.unsubscribeStamps = null;
    for (const slot of this.slots) {
      slot.chunk.dispose();
    }
  }
}
