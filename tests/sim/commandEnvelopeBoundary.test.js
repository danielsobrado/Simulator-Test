import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandEnvelope } from '../../src/sim/commands/commandEnvelope.js';

test('command envelopes reject non-finite numeric payloads instead of rewriting them', () => {
  assert.throws(
    () => createCommandEnvelope({
      id: 'bad-number',
      type: 'sim.patchEntity',
      issuedAtTick: 0,
      payload: { danger: Number.NaN },
    }),
    (error) => error?.code === 'invalid_command_payload',
  );
  assert.throws(
    () => createCommandEnvelope({
      id: 'bad-nested-number',
      type: 'sim.patchEntity',
      issuedAtTick: 0,
      payload: { nested: [1, Number.POSITIVE_INFINITY] },
    }),
    (error) => error?.code === 'invalid_command_payload',
  );
});

test('command envelopes require safe non-negative ticks and revisions', () => {
  assert.throws(
    () => createCommandEnvelope({
      id: 'unsafe-tick',
      type: 'sim.patchEntity',
      issuedAtTick: Number.MAX_SAFE_INTEGER + 1,
    }),
    (error) => error?.code === 'invalid_issued_at_tick',
  );
  assert.throws(
    () => createCommandEnvelope({
      id: 'unsafe-revision',
      type: 'sim.patchEntity',
      issuedAtTick: 0,
      expectedWorldRevision: -1,
    }),
    (error) => error?.code === 'invalid_expected_world_revision',
  );
});

test('command payload cloning retains existing JSON-compatible semantics', () => {
  const payload = { nested: { value: 1 }, omitted: undefined };
  const command = createCommandEnvelope({
    id: 'valid',
    type: 'sim.patchEntity',
    issuedAtTick: 1,
    expectedWorldRevision: 2,
    payload,
  });

  payload.nested.value = 9;
  assert.deepEqual(command.payload, { nested: { value: 1 } });
});
