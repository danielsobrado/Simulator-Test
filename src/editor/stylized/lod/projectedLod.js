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
  if (orthographic) {
    const top = camera.top;
    const bottom = camera.bottom;
    const zoom = camera.zoom ?? 1;
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
  ) {
    return cachedProjectionValue;
  }

  cachedProjectionCamera = camera;
  cachedProjectionOrthographic = false;
  cachedProjectionFov = fov;
  cachedProjectionTop = null;
  cachedProjectionBottom = null;
  cachedProjectionZoom = null;
  const fovRadians = fov * Math.PI / 180;
  cachedProjectionValue = 2 * Math.tan(fovRadians / 2);
  return cachedProjectionValue;
}

function thresholdForBand(band, thresholds) {
  if (band === 'near') return thresholds.nearPixels;
  if (band === 'proxy') return thresholds.proxyPixels;
  if (band === 'impostor') return thresholds.impostorPixels;
  if (band === 'cluster') return thresholds.clusterPixels;
  return 0;
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
  const next = baseBand(pixels, thresholds);
  if (!previous || previous === next) return next;

  const previousIndex = lodIndex(previous);
  if (previousIndex < 0) return next;
  const nextIndex = lodIndex(next);
  if (nextIndex > previousIndex) {
    const threshold = thresholdForBand(previous, thresholds);
    return pixels >= threshold * (1 - hysteresisRatio) ? previous : next;
  }

  const threshold = thresholdForBand(next, thresholds);
  return pixels <= threshold * (1 + hysteresisRatio) ? previous : next;
}

/**
 * Collapse logical bands that share the same outer radius onto one physical
 * representation. This prevents transitions such as proxy → impostor from writing
 * the same proxy mesh twice when a layer only implements near/proxy rendering.
 */
export function normalizeLodBandForRadii({
  band,
  meshRadius,
  proxyRadius,
  impostorRadius,
  clusterRadius,
}) {
  let result = band;
  if (result === 'cluster' && clusterRadius <= impostorRadius) result = 'impostor';
  if (result === 'impostor' && impostorRadius <= proxyRadius) result = 'proxy';
  if (result === 'proxy' && proxyRadius <= meshRadius) result = 'near';
  return result;
}

export function clampLodToRadii({
  band,
  chunkDistance,
  meshRadius,
  proxyRadius,
  impostorRadius,
  clusterRadius,
  forceNearWithinMeshRadius = false,
}) {
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

  return normalizeLodBandForRadii({
    band: result,
    meshRadius,
    proxyRadius,
    impostorRadius,
    clusterRadius,
  });
}

export function updateLodTransition({
  state,
  target,
  timestamp,
  durationMs,
}) {
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
