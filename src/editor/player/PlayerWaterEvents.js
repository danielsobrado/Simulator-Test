import { PLAYER_WATER_DRY } from './PlayerWaterState.js';

export const PLAYER_WATER_EVENT_ENTER = 'water-enter';
export const PLAYER_WATER_EVENT_EXIT = 'water-exit';
export const PLAYER_WATER_EVENT_STATE = 'water-state-change';
export const PLAYER_WATER_EVENT_SUBMERGE = 'water-submerge';
export const PLAYER_WATER_EVENT_SURFACE = 'water-surface';
export const PLAYER_WATER_EVENT_BODY = 'water-body-change';

function snapshot(state) {
  return Object.freeze({
    waterState: state?.waterState ?? PLAYER_WATER_DRY,
    waterDepth: state?.waterDepth ?? 0,
    waterSurfaceHeight: state?.waterSurfaceHeight ?? null,
    waterBodyId: state?.waterBodyId ?? 0,
    waterKind: state?.waterKind ?? 0,
    waterFlowX: state?.waterFlowX ?? 0,
    waterFlowZ: state?.waterFlowZ ?? 0,
    headSubmerged: Boolean(state?.headSubmerged),
  });
}

function event(type, previous, current, timestamp) {
  return Object.freeze({ type, previous, current, timestamp });
}

export function createPlayerWaterEvents(previousState, currentState, timestamp = 0) {
  const previous = snapshot(previousState);
  const current = snapshot(currentState);
  const events = [];
  const wasWet = previous.waterState !== PLAYER_WATER_DRY;
  const isWet = current.waterState !== PLAYER_WATER_DRY;

  if (!wasWet && isWet) events.push(event(PLAYER_WATER_EVENT_ENTER, previous, current, timestamp));
  if (wasWet && !isWet) events.push(event(PLAYER_WATER_EVENT_EXIT, previous, current, timestamp));
  if (previous.waterState !== current.waterState) {
    events.push(event(PLAYER_WATER_EVENT_STATE, previous, current, timestamp));
  }
  if (!previous.headSubmerged && current.headSubmerged) {
    events.push(event(PLAYER_WATER_EVENT_SUBMERGE, previous, current, timestamp));
  }
  if (previous.headSubmerged && !current.headSubmerged) {
    events.push(event(PLAYER_WATER_EVENT_SURFACE, previous, current, timestamp));
  }
  if ((wasWet || isWet) && previous.waterBodyId !== current.waterBodyId) {
    events.push(event(PLAYER_WATER_EVENT_BODY, previous, current, timestamp));
  }
  return Object.freeze(events);
}
