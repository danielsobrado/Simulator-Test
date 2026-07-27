export const PLAYER_WATER_DRY = 'dry';
export const PLAYER_WATER_WADING = 'wading';
export const PLAYER_WATER_SWIMMING = 'swimming';
export const PLAYER_WATER_SUBMERGED = 'submerged';

const SWIMMING_STATES = new Set([PLAYER_WATER_SWIMMING, PLAYER_WATER_SUBMERGED]);

function isCoveredWater(sample) {
  return Boolean(
    sample
    && Number.isFinite(sample.surfaceHeight)
    && Number.isFinite(sample.coverage)
    && sample.coverage > 0,
  );
}

function thresholdActive(value, threshold, hysteresis, wasActive) {
  const boundary = wasActive ? threshold - hysteresis : threshold + hysteresis;
  return value >= boundary;
}

export function isSwimmingWaterState(value) {
  return SWIMMING_STATES.has(value);
}

export function resolvePlayerWaterState({
  previous = null,
  waterSample = null,
  eyeY,
  eyeHeight,
  config,
}) {
  const previousState = previous?.waterState ?? PLAYER_WATER_DRY;
  if (!isCoveredWater(waterSample)) {
    return Object.freeze({
      waterState: PLAYER_WATER_DRY,
      waterDepth: 0,
      waterSurfaceHeight: null,
      waterBodyId: 0,
      headSubmerged: false,
    });
  }

  const footY = eyeY - eyeHeight;
  const waterDepth = Math.max(0, waterSample.surfaceHeight - footY);
  if (waterDepth <= 0) {
    return Object.freeze({
      waterState: PLAYER_WATER_DRY,
      waterDepth: 0,
      waterSurfaceHeight: waterSample.surfaceHeight,
      waterBodyId: waterSample.bodyId ?? 0,
      headSubmerged: false,
    });
  }

  const hysteresis = config.transitionHysteresis;
  const wasSwimming = isSwimmingWaterState(previousState);
  const wasWading = previousState === PLAYER_WATER_WADING || wasSwimming;
  const swimming = thresholdActive(waterDepth, config.swimDepth, hysteresis, wasSwimming);
  const wading = thresholdActive(waterDepth, config.wadeDepth, hysteresis, wasWading);
  const headDepth = waterSample.surfaceHeight - eyeY;
  const headSubmerged = thresholdActive(
    headDepth,
    0,
    hysteresis,
    Boolean(previous?.headSubmerged),
  );

  let waterState = PLAYER_WATER_DRY;
  if (swimming) {
    waterState = headSubmerged ? PLAYER_WATER_SUBMERGED : PLAYER_WATER_SWIMMING;
  } else if (wading) {
    waterState = PLAYER_WATER_WADING;
  }

  return Object.freeze({
    waterState,
    waterDepth,
    waterSurfaceHeight: waterSample.surfaceHeight,
    waterBodyId: waterSample.bodyId ?? 0,
    headSubmerged: swimming && headSubmerged,
  });
}
