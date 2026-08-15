import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainEvent } from '../src/sim/events/domainEvent.js';

function createEvent(overrides = {}) {
  return createDomainEvent({
    id: 'event:1',
    type: 'entity.patched',
    tick: 1,
    causedByCommandId: 'command:1',
    entityIds: ['entity:1'],
    payload: { value: 1 },
    schemaVersion: 1,
    ...overrides,
  });
}

test('domain events reject unsafe ticks and schema versions', () => {
  for (const tick of [Number.MAX_SAFE_INTEGER + 1, Infinity, Number.NaN, -1]) {
    assert.throws(() => createEvent({ tick }), { code: 'invalid_event_tick' });
  }
  for (const schemaVersion of [0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createEvent({ schemaVersion }),
      { code: 'invalid_event_schema_version' },
    );
  }
});

test('domain events reject malformed entity id collections', () => {
  assert.throws(
    () => createEvent({ entityIds: 'entity:1' }),
    { code: 'invalid_event_entity_ids' },
  );
});

test('domain events reject non-finite payload numbers instead of serializing them as null', () => {
  for (const value of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(
      () => createEvent({ payload: { value } }),
      { code: 'invalid_event_payload' },
    );
  }
});
