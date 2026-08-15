import { canonicalSerialize, checksumCanonical } from './canonicalSerialize.js';
import { ENTITY_KINDS } from '../model/entityKinds.js';
import { collectionNameForKind, createEmptyWorldState, listEntities } from '../model/worldState.js';
import { createWorldDefinition } from '../model/worldDefinition.js';
import { validateWorldState } from '../model/validation/validateWorldState.js';

export const SIMULATION_SCHEMA_VERSION = 1;

function invalidSnapshot(path = null) {
  return Object.assign(new Error(path ? `invalid_snapshot:${path}` : 'invalid_snapshot'), {
    code: 'invalid_snapshot',
    path,
  });
}

function invalidMigration(field, code = 'invalid_migration') {
  return Object.assign(new Error(`${code}:${field}`), {
    code,
    field,
  });
}

function assertSchemaVersion(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidMigration(field);
  }
}

function assertSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw invalidSnapshot();
  }
  for (const key of ['definition', 'calendar', 'diagnostics', 'entities']) {
    const value = snapshot[key];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw invalidSnapshot(key);
    }
  }
}

function assertPositiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw Object.assign(new Error(`invalid_limit:${field}`), {
      code: 'invalid_limit',
      field,
    });
  }
}

export function serializeWorldSnapshot({ definition, state, commandRange = null, eventRange = null }) {
  const entities = {};
  for (const kind of ENTITY_KINDS) {
    entities[collectionNameForKind(kind)] = listEntities(
      state,
      kind,
      { includeDestroyed: true },
    ).map((entity) => structuredClone(entity));
  }
  const snapshot = {
    documentVersion: 1,
    simulationSchemaVersion: SIMULATION_SCHEMA_VERSION,
    projectionVersion: definition.projectionVersion,
    worldId: definition.worldId,
    sourceFingerprint: definition.sourceFingerprint,
    snapshotTick: state.calendar.tick,
    worldRevision: state.revision,
    definition: {
      worldId: definition.worldId,
      seed: definition.seed,
      sourceFingerprint: definition.sourceFingerprint,
      projectionVersion: definition.projectionVersion,
      schemaVersion: definition.schemaVersion,
      physicalScale: structuredClone(definition.physicalScale),
      cultures: structuredClone(definition.cultures),
      religions: structuredClone(definition.religions),
      biomes: structuredClone(definition.biomes),
      sourceMeta: structuredClone(definition.sourceMeta),
    },
    calendar: structuredClone(state.calendar),
    diagnostics: structuredClone(state.diagnostics),
    entities,
    commandRange: commandRange == null ? null : structuredClone(commandRange),
    eventRange: eventRange == null ? null : structuredClone(eventRange),
  };
  const checksum = checksumCanonical(snapshot);
  return {
    ...snapshot,
    snapshotChecksum: checksum,
  };
}

export function restoreWorldSnapshot(snapshot) {
  assertSnapshotShape(snapshot);
  if (snapshot.simulationSchemaVersion !== SIMULATION_SCHEMA_VERSION) {
    throw Object.assign(
      new Error(`unsupported_schema_version:${snapshot.simulationSchemaVersion}`),
      { code: 'unsupported_schema_version' },
    );
  }
  if (typeof snapshot.snapshotChecksum !== 'string' || snapshot.snapshotChecksum.length === 0) {
    throw Object.assign(new Error('missing_checksum'), { code: 'missing_checksum' });
  }
  const forCheck = { ...snapshot };
  delete forCheck.snapshotChecksum;
  const actual = checksumCanonical(forCheck);
  if (snapshot.snapshotChecksum !== actual) {
    throw Object.assign(new Error('checksum_mismatch'), { code: 'checksum_mismatch' });
  }

  const definition = createWorldDefinition(snapshot.definition);
  const state = createEmptyWorldState({
    calendar: { ...snapshot.calendar },
    revision: snapshot.worldRevision,
  });
  state.diagnostics = structuredClone(snapshot.diagnostics);
  for (const kind of ENTITY_KINDS) {
    const key = collectionNameForKind(kind);
    const serializedEntities = snapshot.entities[key] ?? [];
    if (!Array.isArray(serializedEntities)) throw invalidSnapshot(`entities.${key}`);
    for (const entity of serializedEntities) {
      state[key].set(entity.id, structuredClone(entity));
    }
  }
  const validation = validateWorldState(state);
  if (!validation.ok) {
    throw Object.assign(new Error('invalid_world_state'), {
      code: 'invalid_world_state',
      failures: validation.failures,
    });
  }
  return { definition, state, checksum: actual };
}

export function createCommandJournal() {
  const commands = [];
  return {
    append(command) {
      commands.push(structuredClone(command));
    },
    list() {
      return commands.map((c) => structuredClone(c));
    },
    clear() {
      commands.length = 0;
    },
    serialize() {
      return canonicalSerialize(commands);
    },
    checksum() {
      return checksumCanonical(commands);
    },
  };
}

export function createEventHistory({ maxImportant = 10000 } = {}) {
  assertPositiveSafeInteger(maxImportant, 'maxImportant');
  const events = [];
  return {
    append(event, { important = false } = {}) {
      events.push({ ...structuredClone(event), important: !!important });
      if (events.length > maxImportant) {
        const idx = events.findIndex((e) => !e.important);
        if (idx >= 0) events.splice(idx, 1);
        else events.shift();
      }
    },
    list() {
      return events.map((e) => structuredClone(e));
    },
    clear() {
      events.length = 0;
    },
  };
}

export function createInMemorySaveStore() {
  const saves = new Map();
  const pending = new Map();
  let transactionSeq = 0;

  function pendingQueue(slot) {
    const queue = pending.get(slot) ?? [];
    if (!pending.has(slot)) pending.set(slot, queue);
    return queue;
  }

  function takePending(slot, transactionId = null) {
    const queue = pending.get(slot);
    if (!queue?.length) return null;
    const index = transactionId == null
      ? 0
      : queue.findIndex((entry) => entry.transactionId === transactionId);
    if (index < 0) return null;
    const [entry] = queue.splice(index, 1);
    if (queue.length === 0) pending.delete(slot);
    return entry;
  }

  return {
    async beginSave(slot, payload) {
      transactionSeq += 1;
      const transactionId = `save:${transactionSeq}`;
      pendingQueue(slot).push({
        transactionId,
        payload: structuredClone(payload),
      });
      return { ok: true, slot, pending: true, transactionId };
    },
    async commitSave(slot, transactionId = null) {
      const entry = takePending(slot, transactionId);
      if (!entry) {
        return { ok: false, code: 'missing_pending_save' };
      }
      saves.set(slot, entry.payload);
      return { ok: true, slot, transactionId: entry.transactionId };
    },
    async abortSave(slot, transactionId = null) {
      const entry = takePending(slot, transactionId);
      return {
        ok: true,
        slot,
        aborted: Boolean(entry),
        transactionId: entry?.transactionId ?? transactionId,
      };
    },
    async save(slot, payload) {
      const pendingSave = await this.beginSave(slot, payload);
      return this.commitSave(slot, pendingSave.transactionId);
    },
    async load(slot) {
      if (!saves.has(slot)) {
        return { ok: false, code: 'missing_save' };
      }
      return { ok: true, payload: structuredClone(saves.get(slot)) };
    },
    async list() {
      return [...saves.keys()].sort();
    },
    /** IndexedDB adapter interface stub for future browser integration. */
    async openIndexedDb() {
      return {
        kind: 'indexeddb-stub',
        ready: false,
        reasonCodes: ['indexeddb_not_wired'],
      };
    },
  };
}

export function detectCorruption(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, code: 'invalid_snapshot' };
    }
    if (!snapshot.snapshotChecksum) {
      return { ok: false, code: 'missing_checksum' };
    }
    const forCheck = { ...snapshot };
    delete forCheck.snapshotChecksum;
    const actual = checksumCanonical(forCheck);
    if (actual !== snapshot.snapshotChecksum) {
      return { ok: false, code: 'checksum_mismatch', expected: snapshot.snapshotChecksum, actual };
    }
    return { ok: true, code: 'ok' };
  } catch (error) {
    return { ok: false, code: 'corruption_detected', message: error.message };
  }
}

export function localizeReplayDivergence(a, b) {
  const diffs = [];
  if (a.revision !== b.revision) diffs.push({ path: 'revision', a: a.revision, b: b.revision });
  if (a.calendar?.tick !== b.calendar?.tick) {
    diffs.push({ path: 'calendar.tick', a: a.calendar?.tick, b: b.calendar?.tick });
  }
  const kinds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...kinds].sort()) {
    if (!key.endsWith('s') && key !== 'regions' && key !== 'settlements') continue;
    if (!(a[key] instanceof Map) || !(b[key] instanceof Map)) continue;
    const ids = new Set([...a[key].keys(), ...b[key].keys()]);
    for (const id of [...ids].sort()) {
      const left = a[key].get(id);
      const right = b[key].get(id);
      if (!left || !right) {
        diffs.push({ path: `${key}.${id}`, code: 'missing_entity' });
        continue;
      }
      if (checksumCanonical(left) !== checksumCanonical(right)) {
        diffs.push({
          path: `${key}.${id}`,
          code: 'entity_divergence',
          kind: left.kind,
          subsystem: key,
        });
      }
    }
  }
  return { ok: diffs.length === 0, diffs };
}

export function createReplayRunner({ dispatcher }) {
  return {
    replay({ definition, state, commands }) {
      let current = state;
      const applied = [];
      for (const command of commands) {
        const result = dispatcher.dispatch(current, command);
        if (!result.ok) {
          return {
            ok: false,
            code: result.code,
            applied,
            state: current,
            definition,
          };
        }
        current = result.state;
        applied.push(command.id);
      }
      return {
        ok: true,
        code: 'ok',
        applied,
        state: current,
        definition,
      };
    },
  };
}

export function createMigrationRegistry() {
  const migrations = new Map();
  return {
    register(fromVersion, toVersion, fn) {
      assertSchemaVersion(fromVersion, 'fromVersion');
      assertSchemaVersion(toVersion, 'toVersion');
      if (toVersion !== fromVersion + 1) {
        throw invalidMigration(`${fromVersion}->${toVersion}`);
      }
      if (typeof fn !== 'function') {
        throw invalidMigration('migrationFn');
      }
      const key = `${fromVersion}->${toVersion}`;
      if (migrations.has(key)) {
        throw invalidMigration(key, 'duplicate_migration');
      }
      migrations.set(key, fn);
    },
    migrate(snapshot) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw invalidMigration('snapshot');
      }
      let current = structuredClone(snapshot);
      assertSchemaVersion(current.simulationSchemaVersion, 'simulationSchemaVersion');
      if (current.simulationSchemaVersion > SIMULATION_SCHEMA_VERSION) {
        throw Object.assign(
          new Error(`unsupported_schema_version:${current.simulationSchemaVersion}`),
          { code: 'unsupported_schema_version' },
        );
      }
      while (current.simulationSchemaVersion < SIMULATION_SCHEMA_VERSION) {
        const fromVersion = current.simulationSchemaVersion;
        const toVersion = fromVersion + 1;
        const key = `${fromVersion}->${toVersion}`;
        const fn = migrations.get(key);
        if (!fn) {
          throw Object.assign(
            new Error(`missing_migration:${key}`),
            { code: 'missing_migration' },
          );
        }
        const migrated = fn(structuredClone(current));
        if (!migrated || typeof migrated !== 'object' || Array.isArray(migrated)) {
          throw invalidMigration(key);
        }
        if (migrated.simulationSchemaVersion !== toVersion) {
          throw invalidMigration(key);
        }
        current = structuredClone(migrated);
      }
      return current;
    },
  };
}

export function buildDiagnosticReport({ definition, state, queries }) {
  return {
    worldId: definition.worldId,
    tick: state.calendar.tick,
    revision: state.revision,
    checksum: queries.getStateChecksum(),
    entityCounts: queries.countByKind(),
    diagnostics: queries.getDiagnostics(),
    calendar: queries.getCalendar(),
  };
}
