import {
  PLAYER_GROUND_EPSILON,
  PLAYER_MAX_DELTA_SECONDS,
} from './playerConstants.js';
import {
  PLAYER_WATER_DRY,
  PLAYER_WATER_WADING,
  isSwimmingWaterState,
  resolvePlayerWaterState,
} from './PlayerWaterState.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampToBounds(value, minimum, maximum) {
  return Number.isFinite(minimum) && Number.isFinite(maximum)
    ? clamp(value, minimum, maximum)
    : value;
}

function noWaterSample(groundHeight) {
  return {
    bodyId: 0,
    coverage: 0,
    surfaceHeight: groundHeight,
  };
}

function movementSpeed(state, input, config) {
  const water = config.water;
  if (!water) return config.walkSpeed * (input.running ? config.runMultiplier : 1);
  if (isSwimmingWaterState(state.waterState)) return water.swimSpeed;
  const baseSpeed = config.walkSpeed * (input.running ? config.runMultiplier : 1);
  if (state.waterState !== PLAYER_WATER_WADING) return baseSpeed;
  const range = Math.max(1e-6, water.swimDepth - water.wadeDepth);
  const progress = clamp((state.waterDepth - water.wadeDepth) / range, 0, 1);
  return baseSpeed * Math.max(0.1, 1 - water.wadeDrag * progress);
}

function sampleWaterState({ state, sample, eyeY, config }) {
  if (!config.water) {
    return {
      waterState: PLAYER_WATER_DRY,
      waterDepth: 0,
      waterSurfaceHeight: null,
      waterBodyId: 0,
      headSubmerged: false,
    };
  }
  return resolvePlayerWaterState({
    previous: state,
    waterSample: sample,
    eyeY,
    eyeHeight: config.eyeHeight,
    config: config.water,
  });
}

function applySwimmingVertical({
  state,
  input,
  delta,
  config,
  water,
  groundEyeY,
}) {
  const waterConfig = config.water;
  const targetY = water.waterSurfaceHeight + config.eyeHeight - waterConfig.swimDepth;
  const verticalInput = clamp((input.ascend ?? 0) - (input.descend ?? 0), -1, 1);
  const desiredVelocity = verticalInput * waterConfig.verticalSwimSpeed;
  const springAcceleration = (targetY - state.y) * waterConfig.buoyancy;
  const dragAcceleration = (desiredVelocity - state.verticalVelocity) * waterConfig.swimDrag;
  const maximumVelocity = waterConfig.verticalSwimSpeed * 1.5;
  let verticalVelocity = clamp(
    state.verticalVelocity + (springAcceleration + dragAcceleration) * delta,
    -maximumVelocity,
    maximumVelocity,
  );
  let nextY = state.y + verticalVelocity * delta;
  if (nextY < groundEyeY) {
    nextY = groundEyeY;
    verticalVelocity = Math.max(0, verticalVelocity);
  }
  return { nextY, verticalVelocity, grounded: false };
}

export function createPlayerState({ x, z, groundHeight, eyeHeight }) {
  return {
    x,
    y: groundHeight + eyeHeight,
    z,
    verticalVelocity: 0,
    grounded: true,
    waterState: PLAYER_WATER_DRY,
    waterDepth: 0,
    waterSurfaceHeight: null,
    waterBodyId: 0,
    headSubmerged: false,
  };
}

export function stepPlayerPhysics({
  state,
  input,
  deltaSeconds,
  config,
  forward,
  right,
  getGroundHeight,
  getWaterSample = null,
  bounds = null,
}) {
  const delta = clamp(deltaSeconds, 0, PLAYER_MAX_DELTA_SECONDS);
  const sampleWater = typeof getWaterSample === 'function'
    ? getWaterSample
    : (x, z) => noWaterSample(getGroundHeight(x, z));
  const currentSample = sampleWater(state.x, state.z);
  const currentWater = sampleWaterState({ state, sample: currentSample, eyeY: state.y, config });
  const movementState = { ...state, ...currentWater };
  const movementX = forward.x * input.forward + right.x * input.right;
  const movementZ = forward.z * input.forward + right.z * input.right;
  const length = Math.hypot(movementX, movementZ);
  const speed = movementSpeed(movementState, input, config);
  const scale = length > 0 ? speed * delta / length : 0;
  let nextX = clampToBounds(
    state.x + movementX * scale,
    bounds?.minX,
    bounds?.maxX,
  );
  let nextZ = clampToBounds(
    state.z + movementZ * scale,
    bounds?.minZ,
    bounds?.maxZ,
  );
  let groundEyeY = getGroundHeight(nextX, nextZ) + config.eyeHeight;

  if (!isSwimmingWaterState(currentWater.waterState)
      && groundEyeY - state.y > config.stepHeight) {
    nextX = state.x;
    nextZ = state.z;
    groundEyeY = getGroundHeight(nextX, nextZ) + config.eyeHeight;
  }

  const nextSample = sampleWater(nextX, nextZ);
  let water = sampleWaterState({ state: movementState, sample: nextSample, eyeY: state.y, config });
  let verticalVelocity = state.verticalVelocity;
  let nextY = state.y;
  let grounded = state.grounded;

  if (isSwimmingWaterState(water.waterState)) {
    ({ nextY, verticalVelocity, grounded } = applySwimmingVertical({
      state,
      input,
      delta,
      config,
      water,
      groundEyeY,
    }));
  } else {
    if (grounded && input.jump) {
      verticalVelocity = config.jumpSpeed;
      grounded = false;
    }

    if (grounded) {
      const dropDistance = state.y - groundEyeY;
      if (dropDistance <= config.groundSnapDistance) {
        nextY = groundEyeY;
      } else {
        grounded = false;
      }
    }

    if (!grounded) {
      verticalVelocity -= config.gravity * delta;
      nextY += verticalVelocity * delta;
    }

    if (nextY <= groundEyeY + PLAYER_GROUND_EPSILON && verticalVelocity <= 0) {
      nextY = groundEyeY;
      verticalVelocity = 0;
      grounded = true;
    }
  }

  water = sampleWaterState({
    state: { ...movementState, ...water },
    sample: nextSample,
    eyeY: nextY,
    config,
  });

  return {
    x: nextX,
    y: nextY,
    z: nextZ,
    verticalVelocity,
    grounded,
    ...water,
  };
}
