import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommandDispatcher,
  registerCommandHandler,
} from '../src/sim/commands/dispatcher.js';
import { createEmptyWorldState } from '../src/sim/model/worldState.js';

const COMMAND_TYPE = 'test.runtimeSideEffectsRollback';

registerCommandHandler(COMMAND_TYPE, (_state, command) => {
  const { ledger, lod } = command.payload.__ctx;
  ledger.record({ kind: 'transient' });
  lod.value = 'mutated';
  return [{
    type: 'entity.patched',
    payload: { value: Number.NaN },
  }];
});

function createLedger() {
  const entries = [{ kind: 'existing' }];
  return {
    list: () => structuredClone(entries),
    clear: () => { entries.length = 0; },
    record: (entry) => { entries.push(structuredClone(entry)); },
  };
}

function createLod() {
  return {
    value: 'original',
    serialize() { return { value: this.value }; },
    restore(snapshot) { this.value = snapshot.value; },
  };
}

test('rejected commands roll back runtime side effects and invalid emitted events', () => {
  const state = createEmptyWorldState();
  const ledger = createLedger();
  const lod = createLod();
  const dispatcher = createCommandDispatcher();

  const result = dispatcher.dispatch(state, {
    id: 'command:rollback',
    type: COMMAND_TYPE,
    issuedAtTick: 1,
    expectedWorldRevision: null,
    payload: {},
  }, { ledger, lod });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid_event_payload');
  assert.deepEqual(ledger.list(), [{ kind: 'existing' }]);
  assert.equal(lod.value, 'original');
  assert.equal(state.diagnostics.commandsRejected, 1);
  assert.equal(state.diagnostics.eventsEmitted, 0);
});
