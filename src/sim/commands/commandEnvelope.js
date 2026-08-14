function invalidPayload() {
  return Object.assign(new Error('invalid_command_payload'), { code: 'invalid_command_payload' });
}

function assertFiniteNumbers(value, seen = new Set()) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidPayload();
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    assertFiniteNumbers(entry, seen);
  }
}

function clonePlain(value) {
  assertFiniteNumbers(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw Object.assign(invalidPayload(), { cause: error });
  }
}

export function createCommandEnvelope({
  id,
  type,
  issuedAtTick,
  actorId = 'system',
  expectedWorldRevision = null,
  payload = {},
  source = 'system',
}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw Object.assign(new Error('invalid_command_id'), { code: 'invalid_command_id' });
  }
  if (typeof type !== 'string' || type.length === 0) {
    throw Object.assign(new Error('invalid_command_type'), { code: 'invalid_command_type' });
  }
  if (!Number.isSafeInteger(issuedAtTick) || issuedAtTick < 0) {
    throw Object.assign(new Error('invalid_issued_at_tick'), { code: 'invalid_issued_at_tick' });
  }
  if (expectedWorldRevision != null
      && (!Number.isSafeInteger(expectedWorldRevision) || expectedWorldRevision < 0)) {
    throw Object.assign(
      new Error('invalid_expected_world_revision'),
      { code: 'invalid_expected_world_revision' },
    );
  }
  return Object.freeze({
    id,
    type,
    issuedAtTick,
    actorId: String(actorId),
    expectedWorldRevision,
    payload: clonePlain(payload),
    source: String(source),
  });
}
