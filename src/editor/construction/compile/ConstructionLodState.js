/**
 * Per-module construction LOD state: request / build / visible bands,
 * residence time, build-key dedupe, and optional crossfade bookkeeping.
 */

import { selectConstructionLod } from '../render/ConstructionLod.js';
import { constructionStoneLodProfile } from '../config/ConstructionStoneLodProfiles.generated.js';

/**
 * Distance-based hysteresis around near/coarse/shell thresholds.
 */
export function bandWithHysteresis({
  currentBand,
  distance,
  nearDistance,
  shellDistance,
  hysteresis,
}) {
  if (currentBand === 'near') {
    if (distance > nearDistance + hysteresis) return 'coarse';
    return 'near';
  }
  if (currentBand === 'coarse') {
    if (distance < nearDistance - hysteresis) return 'near';
    if (distance > shellDistance + hysteresis) return 'shell';
    return 'coarse';
  }
  if (distance < shellDistance - hysteresis) return 'coarse';
  return 'shell';
}

export function createModuleLodResident(initial = {}) {
  return {
    requestedBand: initial.requestedBand ?? null,
    builtBand: initial.builtBand ?? null,
    visibleBand: initial.visibleBand ?? null,
    requestedAt: initial.requestedAt ?? 0,
    visibleSince: initial.visibleSince ?? 0,
    pendingBuildKey: initial.pendingBuildKey ?? null,
    transition: initial.transition ?? null,
  };
}

export function moduleBuildKey({
  constructionId,
  revision,
  moduleId,
  contentHash,
  requestedBand,
}) {
  return [constructionId, revision, moduleId, contentHash, requestedBand].join('|');
}

/**
 * Decide whether a band change should start given residence / exceptions.
 */
export function shouldAcceptBandChange({
  resident,
  requestedBand,
  now,
  minimumResidenceMs,
  force = false,
}) {
  if (force) return true;
  if (!resident.visibleBand) return true;
  if (requestedBand === resident.visibleBand) return false;
  if (!(minimumResidenceMs > 0)) return true;
  return now - resident.visibleSince >= minimumResidenceMs;
}

/**
 * Resolve the band the resident should request, combining pixel LOD with
 * optional metre hysteresis and minimum residence.
 */
export function resolveRequestedLodBand({
  pixels,
  previousVisible = null,
  pinned = false,
  now = 0,
  visibleSince = 0,
  styleKey = null,
  distanceMetres = null,
  nearDistanceMetres = null,
  shellDistanceMetres = null,
  force = false,
}) {
  const profile = constructionStoneLodProfile(styleKey);
  const transition = profile.transition;
  let candidate = selectConstructionLod({
    pixels,
    previous: previousVisible,
    pinned,
  });

  if (
    !pinned
    && distanceMetres != null
    && nearDistanceMetres != null
    && shellDistanceMetres != null
  ) {
    candidate = bandWithHysteresis({
      currentBand: previousVisible ?? candidate,
      distance: distanceMetres,
      nearDistance: nearDistanceMetres,
      shellDistance: shellDistanceMetres,
      hysteresis: transition.hysteresisMetres,
    });
  }

  if (pinned) return 'near';

  if (
    previousVisible
    && candidate !== previousVisible
    && !force
    // `visibleSince` is 0 when no residence has been recorded yet. Treating that
    // as "visible since time zero" made the dwell `now - 0`, which against a
    // `performance.now()` clock that starts at process load meant *every*
    // transition was suppressed for the first `minimumResidenceMs` of the
    // process — LOD frozen at whatever it initialised to for the first half
    // second, and a band flip before then silently ignored.
    && visibleSince > 0
    && now - visibleSince < transition.minimumResidenceMs
  ) {
    return previousVisible;
  }

  return candidate;
}

/**
 * Suppress duplicate build enqueue when the same key is already pending.
 * @returns {{ enqueue: boolean, reason: string|null }}
 */
export function evaluateBuildRequest({ resident, buildKey }) {
  if (resident.pendingBuildKey === buildKey) {
    return { enqueue: false, reason: 'duplicate' };
  }
  return { enqueue: true, reason: null };
}

/**
 * Reject stale completions when revision / hash / band / presence drifted.
 */
export function isStaleBuildResult({
  buildKey,
  expectedKey,
  moduleExists,
}) {
  if (!moduleExists) return true;
  return buildKey !== expectedKey;
}

/**
 * Ordered Bayer dither visibility for LOD crossfade.
 * fade 0 → outgoing fully visible; fade 1 → incoming fully visible.
 */
export function lodDitherVisible({
  fade,
  fadeDirection,
  x,
  y,
  seed = 0,
  matrixSize = 4,
}) {
  const size = matrixSize === 8 ? 8 : 4;
  const bayer4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5,
  ];
  const bayer8 = [
    0, 32, 8, 40, 2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37,
    63, 31, 55, 23, 61, 29, 53, 21,
  ];
  const matrix = size === 8 ? bayer8 : bayer4;
  // Mix seed bits so module IDs that only differ in high bits still offset.
  const mixed = Math.imul(seed ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
  const ix = (Math.floor(x) + (mixed & 0xff)) & (size - 1);
  const iy = (Math.floor(y) + ((mixed >>> 8) & 0xff)) & (size - 1);
  const threshold = (matrix[iy * size + ix] + 0.5) / (size * size);
  const progress = Math.min(1, Math.max(0, fade));
  return fadeDirection > 0
    ? threshold <= progress
    : threshold > progress;
}

/**
 * Track concurrent crossfade slots.
 */
export function canStartTransition({ activeCount, maximumConcurrentModules }) {
  return activeCount < maximumConcurrentModules;
}
