function invalidEventPayload() {
  return Object.assign(new Error('invalid_event_payload'), { code: 'invalid_event_payload' });
}

function assertFiniteNumbers(value, seen = new Set()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidEventPayload();
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    assertFiniteNumbers(entry, seen);
  }
}

export function createDomainEvent({
  id,
  type,
  tick,
  causedByCommandId,
  entityIds = [],
  payload = {},
  schemaVersion = 1,
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw Object.assign(new Error('invalid_event_id'), { code: 'invalid_event_id' });
  }
  if (typeof type !== 'string' || type.length === 0) {
    throw Object.assign(new Error('invalid_event_type'), { code: 'invalid_event_type' });
  }
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw Object.assign(new Error('invalid_event_tick'), { code: 'invalid_event_tick' });
  }
  if (!Array.isArray(entityIds)) {
    throw Object.assign(new Error('invalid_event_entity_ids'), { code: 'invalid_event_entity_ids' });
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw Object.assign(new Error('invalid_event_schema_version'), {
      code: 'invalid_event_schema_version',
    });
  }
  return Object.freeze({
    id,
    type,
    tick,
    causedByCommandId: String(causedByCommandId),
    entityIds: Object.freeze(entityIds.map(String).sort()),
    payload: clonePlain(stripPrivate(payload)),
    schemaVersion,
  });
}

function stripPrivate(payload) {
  if (payload == null || typeof payload !== 'object') return payload;
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('__')) continue;
    out[key] = value;
  }
  return out;
}

function clonePlain(value) {
  assertFiniteNumbers(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw Object.assign(invalidEventPayload(), { cause: error });
  }
}
