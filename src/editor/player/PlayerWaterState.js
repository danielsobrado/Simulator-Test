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

function dryState(surfaceHeight = null, bodyId = 0, kind = 0) {
  return Object.freeze({
    waterState: PLAYER_WATER_DRY,
    waterDepth: 0,
    waterSurfaceHeight: surfaceHeight,
    waterBodyId: bodyId,
    waterKind: kind,
    waterFlowX: 0,
    waterFlowZ: 0,
    headSubmerged: false,
  });
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
  if (!isCoveredWater(waterSample)) return dryState();

  const footY = eyeY - eyeHeight;
  const waterDepth = Math.max(0, waterSample.surfaceHeight - footY);
  if (waterDepth <= 0) {
    return dryState(waterSample.surfaceHeight, waterSample.bodyId ?? 0, waterSample.kind ?? 0);
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
    waterKind: waterSample.kind ?? 0,
    waterFlowX: Number.isFinite(waterSample.flowX) ? waterSample.flowX : 0,
    waterFlowZ: Number.isFinite(waterSample.flowZ) ? waterSample.flowZ : 0,
    headSubmerged: swimming && headSubmerged,
  });
}
