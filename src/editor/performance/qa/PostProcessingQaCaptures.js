/**
 * Deterministic capture locations and movement route for post-processing QA.
 * Poses are render-space; construction fixtures load via `fixture: 'construction-ring'`.
 */

export const POST_PROCESSING_WARMUP_FRAMES = 120;
export const POST_PROCESSING_MEASURE_FRAMES = 600;

export const POST_PROCESSING_CAPTURE_LOCATIONS = Object.freeze([
  Object.freeze({
    id: 'forest-close',
    label: 'Forest close',
    spawn: Object.freeze({ x: 48, z: 64 }),
    yawDegrees: 35,
    pitchDegrees: -8,
    density: 'dense-forest',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'forest-aerial',
    label: 'Forest aerial',
    spawn: Object.freeze({ x: 48, z: 64 }),
    yawDegrees: 20,
    pitchDegrees: -42,
    density: 'dense-forest',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'river-close',
    label: 'River close',
    spawn: Object.freeze({ x: 180, z: -40 }),
    yawDegrees: 90,
    pitchDegrees: -12,
    density: 'standard',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'coast',
    label: 'Coast',
    spawn: Object.freeze({ x: 320, z: -220 }),
    yawDegrees: 140,
    pitchDegrees: -6,
    density: 'standard',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'castle',
    label: 'Castle / masonry',
    spawn: Object.freeze({ x: 0, z: -24 }),
    yawDegrees: 0,
    pitchDegrees: -10,
    density: 'standard',
    fixture: 'construction-ring',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'dense-settlement',
    label: 'Dense settlement',
    spawn: Object.freeze({ x: 12, z: 0 }),
    yawDegrees: 45,
    pitchDegrees: -8,
    density: 'standard',
    fixture: 'construction-ring',
    keys: Object.freeze(['KeyW', 'ShiftLeft']),
  }),
  Object.freeze({
    id: 'snow-or-ice',
    label: 'Snow or ice',
    spawn: Object.freeze({ x: -280, z: 420 }),
    yawDegrees: -30,
    pitchDegrees: -10,
    density: 'standard',
    weather: 'snow',
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'night-emissive',
    label: 'Night emissive',
    spawn: Object.freeze({ x: 0, z: -24 }),
    yawDegrees: 15,
    pitchDegrees: -6,
    density: 'standard',
    fixture: 'construction-ring',
    night: true,
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'spell-combat',
    label: 'Spell combat',
    spawn: Object.freeze({ x: 24, z: 16 }),
    yawDegrees: 0,
    pitchDegrees: -8,
    density: 'standard',
    spell: true,
    keys: Object.freeze([]),
  }),
  Object.freeze({
    id: 'weather-heavy',
    label: 'Weather heavy',
    spawn: Object.freeze({ x: 64, z: 32 }),
    yawDegrees: 60,
    pitchDegrees: -10,
    density: 'dense-mixed',
    weather: 'storm',
    keys: Object.freeze(['KeyW']),
  }),
]);

/**
 * Multi-phase route: forward → rotate → chunk cross → floating-origin rebase → 5s static.
 * Rebase uses a teleport near the floating-origin threshold, then a short forward push.
 */
export function createPostProcessingRoutePhases({
  floatingOriginThreshold = 4096,
  warmupFrames = POST_PROCESSING_WARMUP_FRAMES,
  measureFrames = POST_PROCESSING_MEASURE_FRAMES,
} = {}) {
  const rebaseX = Math.max(64, floatingOriginThreshold - 128);
  // Budget the measured phases to sum near measureFrames while keeping a 5s static hold.
  const staticFrames = 300;
  const motionBudget = Math.max(60, measureFrames - staticFrames);
  const forwardFrames = Math.floor(motionBudget * 0.28);
  const rotateFrames = Math.floor(motionBudget * 0.18);
  const chunkFrames = Math.floor(motionBudget * 0.28);
  const rebaseMoveFrames = Math.max(
    30,
    motionBudget - forwardFrames - rotateFrames - chunkFrames - 2,
  );

  return Object.freeze([
    Object.freeze({
      id: 'warmup',
      label: 'Warmup (settle streaming)',
      durationFrames: warmupFrames,
      keys: Object.freeze([]),
      record: false,
    }),
    Object.freeze({
      id: 'forward',
      label: 'Forward movement',
      durationFrames: forwardFrames,
      keys: Object.freeze(['KeyW', 'ShiftLeft']),
      record: true,
    }),
    Object.freeze({
      id: 'rotate',
      label: 'Rotation',
      durationFrames: rotateFrames,
      keys: Object.freeze([]),
      yawDeltaDegreesPerFrame: 1.2,
      record: true,
    }),
    Object.freeze({
      id: 'chunk-cross',
      label: 'Chunk crossing',
      durationFrames: chunkFrames,
      keys: Object.freeze(['KeyW', 'ShiftLeft']),
      record: true,
    }),
    Object.freeze({
      id: 'rebase-teleport',
      label: 'Floating-origin rebase prep',
      durationFrames: 2,
      keys: Object.freeze([]),
      teleport: Object.freeze({ x: rebaseX, z: 0 }),
      yawDegrees: 0,
      record: true,
    }),
    Object.freeze({
      id: 'rebase-move',
      label: 'Floating-origin rebase',
      durationFrames: rebaseMoveFrames,
      keys: Object.freeze(['KeyW', 'ShiftLeft']),
      record: true,
    }),
    Object.freeze({
      id: 'static',
      label: 'Static hold (5s)',
      durationFrames: staticFrames,
      keys: Object.freeze([]),
      record: true,
    }),
  ]);
}

export function listPostProcessingCaptureIds() {
  return POST_PROCESSING_CAPTURE_LOCATIONS.map((entry) => entry.id);
}

export function resolvePostProcessingCapture(id) {
  return POST_PROCESSING_CAPTURE_LOCATIONS.find((entry) => entry.id === id) ?? null;
}
