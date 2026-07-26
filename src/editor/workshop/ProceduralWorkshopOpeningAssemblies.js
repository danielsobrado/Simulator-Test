import { WORKSHOP_OPENING_ATTACHMENT_LIMITS } from './ProceduralWorkshopOpeningAttachments.js';

const OPENING_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ASSEMBLY_ID_PATTERN = /^assembly-(window|door)-[1-9][0-9]*$/;
const HOST_ID_PATTERN = /^structure-[a-z0-9-]{1,55}$/;
const ASSEMBLY_KINDS = new Set(['window', 'door']);
const MAX_OPENING_ASSEMBLIES = Math.floor(WORKSHOP_OPENING_ATTACHMENT_LIMITS.maximum / 2);

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

function normalizeAssembly(value, assemblyId, claimedMembers) {
  const source = requireObject(value, `Opening assembly ${assemblyId}`);
  if (!ASSEMBLY_KINDS.has(source.kind)) {
    throw new Error(`Opening assembly ${assemblyId} kind must be window or door.`);
  }
  const hostId = requireId(
    source.hostId,
    `Opening assembly ${assemblyId} host`,
    HOST_ID_PATTERN,
  );
  if (!Array.isArray(source.memberIds)) {
    throw new Error(`Opening assembly ${assemblyId} member IDs must be an array.`);
  }
  if (
    source.memberIds.length < 2
    || source.memberIds.length > WORKSHOP_OPENING_ATTACHMENT_LIMITS.maximum
  ) {
    throw new Error(
      `Opening assembly ${assemblyId} must contain between 2 and `
      + `${WORKSHOP_OPENING_ATTACHMENT_LIMITS.maximum} members.`,
    );
  }
  const localMembers = new Set();
  const memberIds = source.memberIds.map((memberId) => {
    const normalized = requireId(memberId, `Opening assembly ${assemblyId} member`);
    if (normalized === assemblyId) {
      throw new Error(`Opening assembly ${assemblyId} cannot contain itself.`);
    }
    if (localMembers.has(normalized)) {
      throw new Error(`Opening assembly ${assemblyId} contains duplicate member ${normalized}.`);
    }
    if (claimedMembers.has(normalized)) {
      throw new Error(`Opening assembly member ${normalized} belongs to more than one assembly.`);
    }
    localMembers.add(normalized);
    claimedMembers.add(normalized);
    return normalized;
  });
  return Object.freeze({
    kind: source.kind,
    hostId,
    memberIds: Object.freeze(memberIds),
  });
}

export function normalizeOpeningAssemblies(input) {
  const source = requireObject(input, 'Opening assemblies', { allowMissing: true });
  const entries = Object.entries(source);
  if (entries.length > MAX_OPENING_ASSEMBLIES) {
    throw new Error(`A workshop recipe supports at most ${MAX_OPENING_ASSEMBLIES} opening assemblies.`);
  }
  const claimedMembers = new Set();
  const normalized = {};
  for (const [assemblyId, assembly] of entries.sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    requireId(assemblyId, 'Opening assembly', ASSEMBLY_ID_PATTERN);
    normalized[assemblyId] = normalizeAssembly(assembly, assemblyId, claimedMembers);
  }
  return Object.freeze(normalized);
}

export function serializeOpeningAssemblies(input) {
  const normalized = normalizeOpeningAssemblies(input);
  return Object.fromEntries(Object.entries(normalized).map(([assemblyId, assembly]) => [
    assemblyId,
    {
      kind: assembly.kind,
      hostId: assembly.hostId,
      memberIds: [...assembly.memberIds],
    },
  ]));
}

export function nextOpeningAssemblyId(kind, assemblies) {
  if (!ASSEMBLY_KINDS.has(kind)) {
    throw new Error('Opening assembly kind must be window or door.');
  }
  const normalized = normalizeOpeningAssemblies(assemblies);
  for (let suffix = 1; suffix <= MAX_OPENING_ASSEMBLIES + 1; suffix += 1) {
    const candidate = `assembly-${kind}-${suffix}`;
    if (!normalized[candidate]) return candidate;
  }
  throw new Error('No opening assembly identifiers remain.');
}

export const WORKSHOP_OPENING_ASSEMBLY_LIMITS = Object.freeze({
  maximum: MAX_OPENING_ASSEMBLIES,
  maximumMembers: WORKSHOP_OPENING_ATTACHMENT_LIMITS.maximum,
});
