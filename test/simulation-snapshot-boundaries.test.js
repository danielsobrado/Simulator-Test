import assert from 'node:assert/strict';
import test from 'node:test';

import { checksumCanonical } from '../src/sim/persistence/canonicalSerialize.js';
import {
  createEventHistory,
  restoreWorldSnapshot,
  serializeWorldSnapshot,
} from '../src/sim/persistence/snapshot.js';
import { createWorldDefinition } from '../src/sim/model/worldDefinition.js';
import { createEmptyWorldState } from '../src/sim/model/worldState.js';

function createValidSnapshot() {
  const definition = createWorldDefinition({ worldId: 'test-world', seed: '1' });
  const state = createEmptyWorldState();
  return serializeWorldSnapshot({ definition, state });
}

function refreshChecksum(snapshot) {
  const unsigned = { ...snapshot };
  delete unsigned.snapshotChecksum;
  snapshot.snapshotChecksum = checksumCanonical(unsigned);
}

test('snapshot restore requires a checksum', () => {
  const snapshot = createValidSnapshot();
  delete snapshot.snapshotChecksum;

  assert.throws(
    () => restoreWorldSnapshot(snapshot),
    (error) => error.code === 'missing_checksum',
  );
});

test('snapshot restore rejects semantically invalid entity state even with a valid checksum', () => {
  const snapshot = createValidSnapshot();
  snapshot.entities.settlements.push({
    id: 'settlement:invalid',
    kind: 'region',
    status: 'active',
    data: {},
  });
  refreshChecksum(snapshot);

  assert.throws(
    () => restoreWorldSnapshot(snapshot),
    (error) => error.code === 'invalid_world_state'
      && error.failures.some((failure) => failure.code === 'invalid_entity_kind'),
  );
});

test('event history rejects invalid retention limits', () => {
  for (const maxImportant of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    assert.throws(
      () => createEventHistory({ maxImportant }),
      (error) => error.code === 'invalid_limit' && error.field === 'maxImportant',
    );
  }
});

test('event history stays within its retention bound', () => {
  const history = createEventHistory({ maxImportant: 2 });
  history.append({ id: 'important' }, { important: true });
  history.append({ id: 'discard-first' });
  history.append({ id: 'keep-latest' });

  assert.deepEqual(
    history.list().map((event) => event.id),
    ['important', 'keep-latest'],
  );
});
