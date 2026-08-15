import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMigrationRegistry,
  SIMULATION_SCHEMA_VERSION,
} from '../src/sim/persistence/snapshot.js';

test('migration registry advances snapshots one schema version at a time', () => {
  const migrations = createMigrationRegistry();
  migrations.register(0, 1, (snapshot) => ({
    ...snapshot,
    simulationSchemaVersion: 1,
    migrated: true,
  }));

  const result = migrations.migrate({ simulationSchemaVersion: 0 });

  assert.equal(result.simulationSchemaVersion, SIMULATION_SCHEMA_VERSION);
  assert.equal(result.migrated, true);
});

test('migration registry rejects migrations that do not advance exactly one version', () => {
  const migrations = createMigrationRegistry();

  assert.throws(
    () => migrations.register(0, 2, () => ({})),
    (error) => error.code === 'invalid_migration',
  );
  assert.throws(
    () => migrations.register(0, 1, null),
    (error) => error.code === 'invalid_migration',
  );
});

test('migration registry rejects a migration that fails to advance the snapshot', () => {
  const migrations = createMigrationRegistry();
  migrations.register(0, 1, (snapshot) => snapshot);

  assert.throws(
    () => migrations.migrate({ simulationSchemaVersion: 0 }),
    (error) => error.code === 'invalid_migration',
  );
});

test('migration registry rejects malformed and future schema versions', () => {
  const migrations = createMigrationRegistry();

  assert.throws(
    () => migrations.migrate({ simulationSchemaVersion: Number.NaN }),
    (error) => error.code === 'invalid_migration',
  );
  assert.throws(
    () => migrations.migrate({ simulationSchemaVersion: SIMULATION_SCHEMA_VERSION + 1 }),
    (error) => error.code === 'unsupported_schema_version',
  );
});

test('migration registry rejects duplicate migration registrations', () => {
  const migrations = createMigrationRegistry();
  migrations.register(0, 1, (snapshot) => ({ ...snapshot, simulationSchemaVersion: 1 }));

  assert.throws(
    () => migrations.register(0, 1, (snapshot) => ({ ...snapshot, simulationSchemaVersion: 1 })),
    (error) => error.code === 'duplicate_migration',
  );
});
