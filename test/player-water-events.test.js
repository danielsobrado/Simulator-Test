import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAYER_WATER_EVENT_BODY,
  PLAYER_WATER_EVENT_ENTER,
  PLAYER_WATER_EVENT_EXIT,
  PLAYER_WATER_EVENT_STATE,
  PLAYER_WATER_EVENT_SUBMERGE,
  PLAYER_WATER_EVENT_SURFACE,
  createPlayerWaterEvents,
} from '../src/editor/player/PlayerWaterEvents.js';

function state(overrides = {}) {
  return {
    waterState: 'dry',
    waterDepth: 0,
    waterSurfaceHeight: null,
    waterBodyId: 0,
    waterKind: 0,
    waterFlowX: 0,
    waterFlowZ: 0,
    headSubmerged: false,
    ...overrides,
  };
}

test('water entry and body changes publish immutable integration events', () => {
  const events = createPlayerWaterEvents(
    state(),
    state({ waterState: 'wading', waterDepth: 0.9, waterBodyId: 8, waterKind: 3 }),
    120,
  );
  assert.deepEqual(events.map((event) => event.type), [
    PLAYER_WATER_EVENT_ENTER,
    PLAYER_WATER_EVENT_STATE,
    PLAYER_WATER_EVENT_BODY,
  ]);
  assert.equal(events[0].timestamp, 120);
  assert.equal(Object.isFrozen(events[0]), true);
});

test('submerge, surface, and exit transitions remain distinct', () => {
  const swimming = state({ waterState: 'swimming', waterBodyId: 4, waterKind: 1 });
  const submerged = state({ ...swimming, waterState: 'submerged', headSubmerged: true });
  assert.deepEqual(
    createPlayerWaterEvents(swimming, submerged).map((event) => event.type),
    [PLAYER_WATER_EVENT_STATE, PLAYER_WATER_EVENT_SUBMERGE],
  );
  assert.deepEqual(
    createPlayerWaterEvents(submerged, swimming).map((event) => event.type),
    [PLAYER_WATER_EVENT_STATE, PLAYER_WATER_EVENT_SURFACE],
  );
  assert.ok(createPlayerWaterEvents(swimming, state()).some((event) => event.type === PLAYER_WATER_EVENT_EXIT));
});
