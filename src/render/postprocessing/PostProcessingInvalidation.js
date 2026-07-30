export const POST_PROCESSING_RESET_REASONS = Object.freeze({
  INITIAL_FRAME: 'INITIAL_FRAME',
  RESIZE: 'RESIZE',
  RENDER_SCALE_CHANGED: 'RENDER_SCALE_CHANGED',
  CAMERA_MODE_CHANGED: 'CAMERA_MODE_CHANGED',
  CAMERA_TELEPORT: 'CAMERA_TELEPORT',
  CAMERA_FOV_CHANGED: 'CAMERA_FOV_CHANGED',
  FLOATING_ORIGIN_REBASE: 'FLOATING_ORIGIN_REBASE',
  WORLD_LOADED: 'WORLD_LOADED',
  WORLD_IMPORTED: 'WORLD_IMPORTED',
  SAVE_RESTORED: 'SAVE_RESTORED',
  PLAYER_SPAWNED: 'PLAYER_SPAWNED',
  ACTIVE_CAMERA_REPLACED: 'ACTIVE_CAMERA_REPLACED',
  MASS_CHUNK_REASSIGNMENT: 'MASS_CHUNK_REASSIGNMENT',
  POST_GRAPH_REBUILT: 'POST_GRAPH_REBUILT',
  MANUAL_RESET: 'MANUAL_RESET',
});

export const POST_PROCESSING_REACTIVE_EVENTS = Object.freeze({
  TERRAIN_EDIT: 'TERRAIN_EDIT',
  VOXEL_EDIT: 'VOXEL_EDIT',
  CONSTRUCTION_PLACEMENT: 'CONSTRUCTION_PLACEMENT',
  CONSTRUCTION_REMOVAL: 'CONSTRUCTION_REMOVAL',
  CHUNK_STREAMED_IN: 'CHUNK_STREAMED_IN',
  CHUNK_LOD_CHANGED: 'CHUNK_LOD_CHANGED',
  VEGETATION_LOD_CHANGED: 'VEGETATION_LOD_CHANGED',
  IMPOSTOR_TRANSITION: 'IMPOSTOR_TRANSITION',
  WEATHER_STARTED: 'WEATHER_STARTED',
  SPELL_STARTED: 'SPELL_STARTED',
});

const FULL_RESET_REASON_SET = new Set(Object.values(POST_PROCESSING_RESET_REASONS));

export const POST_PROCESSING_REACTIVE_LIFETIMES = Object.freeze({
  TERRAIN_EDIT: 2,
  VOXEL_EDIT: 2,
  CONSTRUCTION_PLACEMENT: 2,
  CONSTRUCTION_REMOVAL: 2,
  CHUNK_STREAMED_IN: 3,
  CHUNK_LOD_CHANGED: 2,
  VEGETATION_LOD_CHANGED: 2,
  IMPOSTOR_TRANSITION: 2,
  WEATHER_STARTED: 3,
  SPELL_STARTED: 3,
});

export class PostProcessingInvalidation {
  constructor({ history, diagnostics = null, debug = console.debug } = {}) {
    if (!history || typeof history.invalidate !== 'function') {
      throw new Error('Post-processing invalidation requires a history API.');
    }
    this.history = history;
    this.diagnostics = diagnostics;
    this.debug = typeof debug === 'function' ? debug : null;
    this.reactiveFrames = new Map();
  }

  invalidate(reason) {
    if (!FULL_RESET_REASON_SET.has(reason)) {
      throw new Error(`Unknown post-processing reset reason: ${reason}`);
    }
    this.history.invalidate(reason);
    this.diagnostics?.historyReset(reason);
    this.debug?.(`[post-processing] Temporal history reset: ${reason}`);
  }

  notifyReactive(event, transitionFrames = 0) {
    const baseLifetime = POST_PROCESSING_REACTIVE_LIFETIMES[event];
    if (!Number.isInteger(baseLifetime)) {
      throw new Error(`Unknown post-processing reactive event: ${event}`);
    }
    const extraFrames = event === POST_PROCESSING_REACTIVE_EVENTS.CHUNK_LOD_CHANGED
      || event === POST_PROCESSING_REACTIVE_EVENTS.VEGETATION_LOD_CHANGED
      || event === POST_PROCESSING_REACTIVE_EVENTS.IMPOSTOR_TRANSITION
      ? Math.max(0, Math.ceil(transitionFrames))
      : 0;
    const lifetime = baseLifetime + extraFrames;
    this.reactiveFrames.set(
      event,
      Math.max(lifetime, this.reactiveFrames.get(event) ?? 0),
    );
    return lifetime;
  }

  beginFrame() {
    for (const [event, frames] of this.reactiveFrames) {
      if (frames <= 1) this.reactiveFrames.delete(event);
      else this.reactiveFrames.set(event, frames - 1);
    }
  }

  consumeReactiveFrame() {
    const reactive = this.isReactive();
    this.beginFrame();
    return reactive;
  }

  isReactive() {
    return this.reactiveFrames.size > 0;
  }

  reactiveLifetime(event) {
    return this.reactiveFrames.get(event) ?? 0;
  }

  clearReactive() {
    this.reactiveFrames.clear();
  }
}
