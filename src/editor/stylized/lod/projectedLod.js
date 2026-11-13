let cachedProjectionCamera = null;
let cachedProjectionOrthographic = false;
let cachedProjectionFov = null;
let cachedProjectionTop = null;
let cachedProjectionBottom = null;
let cachedProjectionZoom = null;
let cachedProjectionValue = null;

function distance3(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function lodIndex(band) {
  switch (band) {
    case 'near': return 0;
    case 'proxy': return 1;
    case 'impostor': return 2;
    case 'cluster': return 3;
    case 'culled': return 4;
    default: return -1;
  }
}

function cameraProjection(camera) {
  const orthographic = Boolean(camera.isOrthographicCamera);
  const zoom = camera.zoom ?? 1;
  if (orthographic) {
    const top = camera.top;
    const bottom = camera.bottom;
    if (
      camera === cachedProjectionCamera
      && cachedProjectionOrthographic
      && cachedProjectionTop === top
      && cachedProjectionBottom === bottom
      && cachedProjectionZoom === zoom
    ) {
      return cachedProjectionValue;
    }

    cachedProjectionCamera = camera;
    cachedProjectionOrthographic = true;
    cachedProjectionTop = top;
    cachedProjectionBottom = bottom;
    cachedProjectionZoom = zoom;
    cachedProjectionFov = null;
    cachedProjectionValue = Math.abs(top - bottom) / Math.max(0.0001, zoom);
    return cachedProjectionValue;
  }

  const fov = camera.fov ?? 60;
  if (
    camera === cachedProjectionCamera
    && !cachedProjectionOrthographic
    && cachedProjectionFov === fov
    && cachedProjectionZoom === zoom
  ) {
    return cachedProjectionValue;
  }

  cachedProjectionCamera = camera;
  cachedProjectionOrthographic = false;
  cachedProjectionFov = fov;
  cachedProjectionTop = null;
  cachedProjectionBottom = null;
  cachedProjectionZoom = zoom;
  const fovRadians = fov * Math.PI / 180;
  cachedProjectionValue = 2 * Math.tan(fovRadians / 2) / Math.max(0.0001, zoom);
  return cachedProjectionValue;
}

function baseBand(pixels, thresholds) {
  if (pixels >= thresholds.nearPixels) return 'near';
  if (pixels >= thresholds.proxyPixels) return 'proxy';
  if (pixels >= thresholds.impostorPixels) return 'impostor';
  // A zero threshold disables the band rather than matching everything, which is
  // how the aggregate canopy is switched off: `pixels >= 0` is always true.
  if (thresholds.clusterPixels > 0 && pixels >= thresholds.clusterPixels) return 'cluster';
  return 'culled';
}

function representation(band, fade, ditherDirection = 1) {
  return Object.freeze({ band, fade, ditherDirection });
}

export function projectedPixelHeight({ camera, worldPosition, worldHeight, viewportHeight }) {
  return projectedPixelHeightAt(camera, worldPosition, worldHeight, viewportHeight);
}

/** Positional `projectedPixelHeight`, so per-chunk loops need no options object. */
export function projectedPixelHeightAt(camera, worldPosition, worldHeight, viewportHeight) {
  if (!camera || !Number.isFinite(worldHeight) || worldHeight <= 0
      || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return 0;
  }

  const projection = cameraProjection(camera);
  if (camera.isOrthographicCamera) {
    return projection > 0 ? worldHeight * viewportHeight / projection : 0;
  }

  const distance = Math.max(0.001, distance3(camera.position, worldPosition));
  const pixelsPerWorldUnit = viewportHeight / (projection * distance);
  return worldHeight * pixelsPerWorldUnit;
}

export function selectProjectedLod({
  pixels,
  previous = null,
  hysteresisRatio = 0.15,
  ...thresholds
}) {
  return selectLodBand(pixels, previous, thresholds, hysteresisRatio);
}

/** `selectProjectedLod` without its option spread; `thresholds` may carry extra keys. */
export function selectLodBand(pixels, previous, thresholds, hysteresisRatio = 0.15) {
  const next = baseBand(pixels, thresholds);
  if (!previous || previous === next) return next;

  const previousIndex = lodIndex(previous);
  if (previousIndex < 0) return next;
  const nextIndex = lodIndex(next);
  // Hysteresis holds each *boundary*, not the previous band as a whole. The old
  // rule compared only against the target band's threshold and otherwise kept
  // `previous`, so a jump across several bands — a zoom, a module streaming in
  // close — could hold a far representation well past every intermediate
  // threshold: a wall at 150 px stayed a flat shell while a smaller neighbour
  // got stone (wall handoff 4B). Each crossed boundary now applies its own
  // margin, and the result stops at the band those margins allow.
  if (nextIndex > previousIndex) {
    const demoted = baseBand(pixels / (1 - hysteresisRatio), thresholds);
    return lodIndex(demoted) > previousIndex ? demoted : previous;
  }
  const promoted = promotedBand(pixels, thresholds, hysteresisRatio);
  return lodIndex(promoted) < previousIndex ? promoted : previous;
}

/** The finest band whose threshold `pixels` exceeds by the promotion margin. */
function promotedBand(pixels, thresholds, hysteresisRatio) {
  const margin = 1 + hysteresisRatio;
  if (pixels > thresholds.nearPixels * margin) return 'near';
  if (pixels > thresholds.proxyPixels * margin) return 'proxy';
  if (pixels > thresholds.impostorPixels * margin) return 'impostor';
  if (thresholds.clusterPixels > 0 && pixels > thresholds.clusterPixels * margin) return 'cluster';
  return 'culled';
}

/**
 * Collapse logical bands that share the same outer radius onto one physical
 * representation. This prevents transitions such as proxy → impostor from writing
 * the same proxy mesh twice when a layer only implements near/proxy rendering.
 */
export function normalizeLodBandForRadii(options) {
  return normalizeBand(options.band, options);
}

function normalizeBand(band, { meshRadius, proxyRadius, impostorRadius, clusterRadius }) {
  let result = band;
  if (result === 'cluster' && clusterRadius <= impostorRadius) result = 'impostor';
  if (result === 'impostor' && impostorRadius <= proxyRadius) result = 'proxy';
  if (result === 'proxy' && proxyRadius <= meshRadius) result = 'near';
  return result;
}

export function clampLodToRadii(options) {
  return clampBandToRadii(options.band, options.chunkDistance, options);
}

/**
 * `clampLodToRadii` with band and distance passed beside `radii` ({ meshRadius, proxyRadius,
 * impostorRadius, clusterRadius, forceNearWithinMeshRadius }), which may carry extra keys.
 */
export function clampBandToRadii(band, chunkDistance, radii) {
  const { meshRadius, proxyRadius, impostorRadius, clusterRadius, forceNearWithinMeshRadius } = radii;
  // Chunk-center projection can underestimate a layer whose instances span the
  // whole chunk. Layers opting into a physical near guarantee keep full geometry
  // around the player even when the chunk center itself projects very small.
  if (forceNearWithinMeshRadius && chunkDistance <= meshRadius) return 'near';

  let result = band;
  if (chunkDistance > clusterRadius) {
    result = 'culled';
  } else if (band === 'near' && chunkDistance > meshRadius) {
    if (chunkDistance <= proxyRadius) result = 'proxy';
    else if (chunkDistance <= impostorRadius) result = 'impostor';
    else result = 'cluster';
  } else if (band === 'proxy' && chunkDistance > proxyRadius) {
    result = chunkDistance <= impostorRadius ? 'impostor' : 'cluster';
  } else if (band === 'impostor' && chunkDistance > impostorRadius) {
    result = 'cluster';
  }

  return normalizeBand(result, radii);
}

export function updateLodTransition({ state, target, timestamp, durationMs }) {
  return advanceLodTransition(state, target, timestamp, durationMs);
}

/** Positional `updateLodTransition`, so per-chunk loops need no options object. */
export function advanceLodTransition(state, target, timestamp, durationMs) {
  if (state?.complete && state.from === target && state.target === target) {
    return state;
  }

  const safeDuration = Math.max(1, durationMs);
  if (!state) {
    if (target === 'culled') {
      return {
        from: target,
        target,
        startedAt: timestamp,
        complete: true,
        representations: Object.freeze([representation(target, 1)]),
      };
    }
    return {
      from: 'culled',
      target,
      startedAt: timestamp,
      complete: false,
      representations: Object.freeze([
        representation('culled', 1, -1),
        representation(target, 0, 1),
      ]),
    };
  }

  let nextState = state;
  if (state.target !== target) {
    const progress = Math.min(1, Math.max(0, (timestamp - state.startedAt) / safeDuration));
    const dominant = state.complete || progress >= 0.5 ? state.target : state.from;
    nextState = {
      from: dominant,
      target,
      startedAt: timestamp,
      complete: dominant === target,
    };
  }

  if (nextState.from === nextState.target) {
    return {
      ...nextState,
      complete: true,
      representations: Object.freeze([representation(nextState.target, 1)]),
    };
  }

  const progress = Math.min(1, Math.max(0, (timestamp - nextState.startedAt) / safeDuration));
  if (progress >= 1) {
    return {
      from: nextState.target,
      target: nextState.target,
      startedAt: nextState.startedAt,
      complete: true,
      representations: Object.freeze([representation(nextState.target, 1)]),
    };
  }

  return {
    ...nextState,
    complete: false,
    representations: Object.freeze([
      representation(nextState.from, 1 - progress, -1),
      representation(nextState.target, progress, 1),
    ]),
  };
}

export function quantizeFade(fade, steps = 8) {
  return Math.round(Math.min(1, Math.max(0, fade)) * Math.max(1, steps));
}
