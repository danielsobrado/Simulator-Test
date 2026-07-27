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
import { emitAudio } from '../audio/index.js';

const UP_NORMAL = Object.freeze({ x: 0, y: 1, z: 0 });
const EMPTY_CONTACTS = Object.freeze([]);
/** Allows a short overshoot past configured verticalSwimSpeed before drag settles it. */
const VERTICAL_SWIM_SPEED_OVERSHOOT = 1.5;

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
    kind: 0,
    bodyId: 0,
    coverage: 0,
    surfaceHeight: groundHeight,
    flowX: 0,
    flowZ: 0,
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
      waterKind: 0,
      waterFlowX: 0,
      waterFlowZ: 0,
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
  const springAcceleration = verticalInput === 0
    ? (targetY - state.y) * waterConfig.buoyancy
    : 0;
  const dragAcceleration = (desiredVelocity - state.verticalVelocity) * waterConfig.swimDrag;
  const maximumVelocity = waterConfig.verticalSwimSpeed * VERTICAL_SWIM_SPEED_OVERSHOOT;
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

function defaultMovementResult({
  state,
  nextX,
  nextZ,
  getGroundHeight,
  eyeHeight,
}) {
  const supportHeight = getGroundHeight(nextX, nextZ);
  return {
    position: { x: nextX, y: state.y - eyeHeight, z: nextZ },
    ready: true,
    blocked: false,
    stepped: false,
    slopeConstrained: false,
    supportSourceId: 'terrain',
    supportHeight,
    supportNormal: UP_NORMAL,
    contacts: EMPTY_CONTACTS,
    previousValidPosition: { x: nextX, y: supportHeight, z: nextZ },
  };
}

function supportSearchDown(state, delta, config) {
  if (state.grounded) return config.groundSnapDistance;
  const fallingSpeed = Math.max(0, -(state.verticalVelocity ?? 0));
  const predictedFall = fallingSpeed * delta + config.gravity * delta * delta * 0.5;
  return Math.max(config.groundSnapDistance, predictedFall + PLAYER_GROUND_EPSILON);
}

export function createPlayerState({ x, z, groundHeight, eyeHeight }) {
  return {
    x,
    y: groundHeight + eyeHeight,
    footY: groundHeight,
    z,
    verticalVelocity: 0,
    grounded: true,
    supportSourceId: 'terrain',
    supportNormal: UP_NORMAL,
    collisionReady: true,
    collisionBlocked: false,
    collisionStepped: false,
    collisionContacts: EMPTY_CONTACTS,
    previousValidPosition: Object.freeze({ x, y: groundHeight, z }),
    waterState: PLAYER_WATER_DRY,
    waterDepth: 0,
    waterSurfaceHeight: null,
    waterBodyId: 0,
    waterKind: 0,
    waterFlowX: 0,
    waterFlowZ: 0,
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
  resolveHorizontalMotion = null,
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
  const currentScale = isSwimmingWaterState(movementState.waterState)
    ? Math.max(0, Number(config.water?.currentDriftSpeed) || 0) * delta
    : 0;
  const desiredX = clampToBounds(
    state.x + movementX * scale + (movementState.waterFlowX ?? 0) * currentScale,
    bounds?.minX,
    bounds?.maxX,
  );
  const desiredZ = clampToBounds(
    state.z + movementZ * scale + (movementState.waterFlowZ ?? 0) * currentScale,
    bounds?.minZ,
    bounds?.maxZ,
  );
  const currentFootY = Number.isFinite(state.footY)
    ? state.footY
    : state.y - config.eyeHeight;
  let movement = typeof resolveHorizontalMotion === 'function'
    ? resolveHorizontalMotion({
      start: { x: state.x, y: currentFootY, z: state.z },
      displacement: { x: desiredX - state.x, z: desiredZ - state.z },
      grounded: state.grounded,
      allowStep: state.grounded && !isSwimmingWaterState(movementState.waterState),
      supportDownDistance: supportSearchDown(state, delta, config),
    })
    : defaultMovementResult({
      state,
      nextX: desiredX,
      nextZ: desiredZ,
      getGroundHeight,
      eyeHeight: config.eyeHeight,
    });

  let nextX = movement.position.x;
  let nextZ = movement.position.z;
  let supportHeight = Number.isFinite(movement.supportHeight)
    ? movement.supportHeight
    : getGroundHeight(nextX, nextZ);
  let groundEyeY = supportHeight + config.eyeHeight;
  let nextSample = sampleWater(nextX, nextZ);
  let water = sampleWaterState({ state: movementState, sample: nextSample, eyeY: state.y, config });

  if (!isSwimmingWaterState(water.waterState)
      && groundEyeY - state.y > config.stepHeight) {
    nextX = state.x;
    nextZ = state.z;
    supportHeight = getGroundHeight(nextX, nextZ);
    groundEyeY = supportHeight + config.eyeHeight;
    nextSample = sampleWater(nextX, nextZ);
    water = sampleWaterState({ state: movementState, sample: nextSample, eyeY: state.y, config });
    movement = defaultMovementResult({
      state,
      nextX,
      nextZ,
      getGroundHeight,
      eyeHeight: config.eyeHeight,
    });
  }

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
      emitAudio('player.jump');
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
  if (!isSwimmingWaterState(water.waterState)
      && nextY <= groundEyeY + PLAYER_GROUND_EPSILON) {
    nextY = groundEyeY;
    verticalVelocity = 0;
    grounded = true;
  }

  const supportSourceId = grounded ? movement.supportSourceId ?? 'terrain' : null;
  const supportNormal = grounded ? movement.supportNormal ?? UP_NORMAL : UP_NORMAL;
  return {
    x: nextX,
    y: nextY,
    footY: nextY - config.eyeHeight,
    z: nextZ,
    verticalVelocity,
    grounded,
    supportSourceId,
    supportNormal,
    collisionReady: movement.ready !== false,
    collisionBlocked: Boolean(movement.blocked),
    collisionStepped: Boolean(movement.stepped),
    collisionContacts: movement.contacts ?? EMPTY_CONTACTS,
    previousValidPosition: movement.previousValidPosition
      ?? state.previousValidPosition
      ?? Object.freeze({ x: nextX, y: supportHeight, z: nextZ }),
    ...water,
  };
}
