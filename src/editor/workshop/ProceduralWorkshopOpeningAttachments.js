const MAX_OPENING_ATTACHMENTS = 48;
const OPENING_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const HOST_ID_PATTERN = /^structure-[a-z0-9-]{1,55}$/;
const POSITION_LIMIT = 32;
const SCALE_MIN = 0.1;
const SCALE_MAX = 4;

function requireObject(value, field, { allowMissing = false } = {}) {
  if (value === undefined && allowMissing) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function requireId(value, field, pattern = OPENING_ID_PATTERN) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${field} has an invalid identifier.`);
  }
  return value;
}

function requireVector(value, field, minimum, maximum) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${field} must contain exactly two values.`);
  }
  const result = value.map((entry) => {
    if (
      typeof entry !== 'number'
      || !Number.isFinite(entry)
      || entry < minimum
      || entry > maximum
    ) {
      throw new Error(`${field} values must be finite numbers between ${minimum} and ${maximum}.`);
    }
    return entry;
  });
  return Object.freeze(result);
}

function normalizeAttachment(value, componentId) {
  const source = requireObject(value, `Opening attachment ${componentId}`);
  return Object.freeze({
    sourceId: requireId(source.sourceId, `Opening attachment ${componentId} source`),
    hostId: requireId(
      source.hostId,
      `Opening attachment ${componentId} host`,
      HOST_ID_PATTERN,
    ),
    position: requireVector(
      source.position,
      `Opening attachment ${componentId} position`,
      -POSITION_LIMIT,
      POSITION_LIMIT,
    ),
    scale: requireVector(
      source.scale,
      `Opening attachment ${componentId} scale`,
      SCALE_MIN,
      SCALE_MAX,
    ),
  });
}

export function normalizeOpeningAttachments(input) {
  const source = requireObject(input, 'Opening attachments', { allowMissing: true });
  const entries = Object.entries(source);
  if (entries.length > MAX_OPENING_ATTACHMENTS) {
    throw new Error(`A workshop recipe supports at most ${MAX_OPENING_ATTACHMENTS} opening attachments.`);
  }
  const normalized = {};
  for (const [componentId, attachment] of entries.sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    requireId(componentId, 'Opening attachment component');
    normalized[componentId] = normalizeAttachment(attachment, componentId);
  }
  return Object.freeze(normalized);
}

export function serializeOpeningAttachments(input) {
  const normalized = normalizeOpeningAttachments(input);
  return Object.fromEntries(Object.entries(normalized).map(([componentId, attachment]) => [
    componentId,
    {
      sourceId: attachment.sourceId,
      hostId: attachment.hostId,
      position: [...attachment.position],
      scale: [...attachment.scale],
    },
  ]));
}

export function nextOpeningCopyId(sourceId, attachments) {
  const normalizedSource = requireId(sourceId, 'Opening copy source');
  const normalized = normalizeOpeningAttachments(attachments);
  for (let suffix = 1; suffix <= MAX_OPENING_ATTACHMENTS; suffix += 1) {
    const candidate = `copy-${normalizedSource}-${suffix}`;
    if (!normalized[candidate]) return candidate;
  }
  throw new Error('No opening copy identifiers remain.');
}

export const WORKSHOP_OPENING_ATTACHMENT_LIMITS = Object.freeze({
  maximum: MAX_OPENING_ATTACHMENTS,
  position: POSITION_LIMIT,
  scaleMin: SCALE_MIN,
  scaleMax: SCALE_MAX,
});
