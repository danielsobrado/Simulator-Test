import fs from 'node:fs';
import yaml from 'js-yaml';

const SPEEDS = new Set(['walk', 'run']);

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value;
}

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNumber(value, name, { minimum = 0, integer = false } = {}) {
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isSafeInteger(value))) {
    const qualifier = integer ? 'safe integer' : 'finite number';
    throw new Error(`${name} must be a ${qualifier} greater than or equal to ${minimum}.`);
  }
  return value;
}

function assertBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function stringList(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  const entries = value.map((entry, index) => assertString(entry, `${name}[${index}]`));
  if (new Set(entries).size !== entries.length) {
    throw new Error(`${name} must not contain duplicates.`);
  }
  return Object.freeze(entries);
}

function optionalNumber(value, name, options = {}) {
  return value == null ? null : assertNumber(value, name, options);
}

function freezeCase(rawCase, index) {
  const source = assertObject(rawCase, `cases[${index}]`);
  const speed = assertString(source.speed, `cases[${index}].speed`);
  if (!SPEEDS.has(speed)) throw new Error(`cases[${index}].speed must be walk or run.`);

  const spawn = source.spawn == null
    ? null
    : Object.freeze({
      x: assertNumber(source.spawn.x, `cases[${index}].spawn.x`, {
        minimum: -Number.MAX_VALUE,
      }),
      z: assertNumber(source.spawn.z, `cases[${index}].spawn.z`, {
        minimum: -Number.MAX_VALUE,
      }),
    });

  return Object.freeze({
    id: assertString(source.id, `cases[${index}].id`),
    label: assertString(source.label, `cases[${index}].label`),
    scenario: assertString(source.scenario, `cases[${index}].scenario`),
    collisionRequired: assertBoolean(
      source.collisionRequired,
      `cases[${index}].collisionRequired`,
    ),
    compareFrameToBaseline: assertBoolean(
      source.compareFrameToBaseline,
      `cases[${index}].compareFrameToBaseline`,
    ),
    warmupSeconds: assertNumber(source.warmupSeconds, `cases[${index}].warmupSeconds`),
    durationSeconds: assertNumber(
      source.durationSeconds,
      `cases[${index}].durationSeconds`,
      { minimum: 0.5 },
    ),
    speed,
    coverage: stringList(source.coverage ?? [], `cases[${index}].coverage`),
    spawn,
    yawDegrees: optionalNumber(source.yawDegrees, `cases[${index}].yawDegrees`, {
      minimum: -Number.MAX_VALUE,
    }),
    pitchDegrees: optionalNumber(source.pitchDegrees, `cases[${index}].pitchDegrees`, {
      minimum: -Number.MAX_VALUE,
    }),
    buildings: optionalNumber(source.buildings, `cases[${index}].buildings`, {
      minimum: 1,
      integer: true,
    }),
  });
}

function freezeGates(rawGates) {
  const gates = assertObject(rawGates, 'gates');
  return Object.freeze({
    collisionP95Ms: assertNumber(gates.collisionP95Ms, 'gates.collisionP95Ms'),
    frameP95RegressionMs: assertNumber(
      gates.frameP95RegressionMs,
      'gates.frameP95RegressionMs',
    ),
    maxHitches: assertNumber(gates.maxHitches, 'gates.maxHitches', { integer: true }),
    maxReadinessMisses: assertNumber(
      gates.maxReadinessMisses,
      'gates.maxReadinessMisses',
      { integer: true },
    ),
    maxFailedChunks: assertNumber(gates.maxFailedChunks, 'gates.maxFailedChunks', {
      integer: true,
    }),
    maxFinalQueueDepth: assertNumber(
      gates.maxFinalQueueDepth,
      'gates.maxFinalQueueDepth',
      { integer: true },
    ),
    requireCanonicalSignature: assertBoolean(
      gates.requireCanonicalSignature,
      'gates.requireCanonicalSignature',
    ),
    requireConsistentAdapter: assertBoolean(
      gates.requireConsistentAdapter,
      'gates.requireConsistentAdapter',
    ),
  });
}

export function validateCollisionAcceptanceConfig(rawConfig) {
  const source = assertObject(rawConfig, 'collision acceptance config');
  const cases = Object.freeze((source.cases ?? []).map(freezeCase));
  if (cases.length === 0) {
    throw new Error('collision acceptance config requires at least one case.');
  }

  const caseIds = cases.map((entry) => entry.id);
  if (new Set(caseIds).size !== caseIds.length) {
    throw new Error('collision acceptance case IDs must be unique.');
  }

  const baselineCase = assertString(source.baselineCase, 'baselineCase');
  const baseline = cases.find((entry) => entry.id === baselineCase);
  if (!baseline) throw new Error(`baselineCase ${baselineCase} does not exist.`);
  if (baseline.collisionRequired) throw new Error('baselineCase must not require collision.');
  if (baseline.compareFrameToBaseline) {
    throw new Error('baselineCase cannot compare its frame time to itself.');
  }

  return Object.freeze({
    version: assertNumber(source.version, 'version', { minimum: 1, integer: true }),
    repeats: assertNumber(source.repeats, 'repeats', { minimum: 1, integer: true }),
    baselineCase,
    hitchMs: assertNumber(source.hitchMs, 'hitchMs', { minimum: 1 }),
    timeoutPaddingSeconds: assertNumber(
      source.timeoutPaddingSeconds,
      'timeoutPaddingSeconds',
    ),
    gates: freezeGates(source.gates),
    requiredCoverage: stringList(source.requiredCoverage ?? [], 'requiredCoverage'),
    cases,
  });
}

export function loadCollisionAcceptanceConfig(filePath) {
  const raw = yaml.load(fs.readFileSync(filePath, 'utf8'));
  return validateCollisionAcceptanceConfig(raw);
}
