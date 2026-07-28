#!/usr/bin/env node
/**
 * Generate ConstructionRuinConfig.generated.js from ruin-masonry.yml.
 *
 * Usage:
 *   node tools/generate-construction-ruin-config.mjs
 *   node tools/generate-construction-ruin-config.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/ruin-masonry.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionRuinConfig.generated.js',
);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const YAML_PATH = argValue('--yaml') ?? DEFAULT_YAML_PATH;
const OUT_PATH = argValue('--out') ?? DEFAULT_OUT_PATH;

const ALLOWED_ROOT = new Set(['version', 'defaults', 'styles']);
const ALLOWED_TOP = new Set([
  'enabled', 'macro', 'damage', 'support', 'crown', 'openings', 'lod',
]);
const ALLOWED_MACRO = new Set([
  'wavelength', 'fineWavelengthRatio', 'lowWeight', 'fineWeight', 'bias',
  'collapseDepth', 'minimumHeight',
]);
const ALLOWED_DAMAGE = new Set([
  'reach', 'probability', 'cluster', 'protectedFooting',
]);
const ALLOWED_REACH = new Set(['base', 'perFactor']);
const ALLOWED_PROBABILITY = new Set([
  'base', 'topProximity', 'clusterInfluence', 'stoneNoiseInfluence', 'removeThreshold',
]);
const ALLOWED_CLUSTER = new Set([
  'wavelength', 'fineWavelengthRatio', 'minimumWidth', 'preferredWidth',
  'severeThreshold', 'isolatedHoleThreshold',
]);
const ALLOWED_FOOTING = new Set(['courses', 'minimumHeight']);
const ALLOWED_SUPPORT = new Set([
  'minimumOverlapRatio', 'strongOverlapRatio', 'minimumAbsoluteOverlap',
  'maximumCantilever', 'verticalTolerance', 'foundationTolerance',
  'maximumPropagationSteps',
]);
const ALLOWED_CROWN = new Set([
  'removeUnsupportedPinnacles', 'maximumUnsupportedToothCourses',
  'maximumSupportedToothCourses', 'minimumToothWidth',
  'isolatedToothStrongSupport', 'maximumBridgeSpan',
]);
const ALLOWED_OPENINGS = new Set([
  'protectLowerJambs', 'jambMinimumSupport', 'archRequiresBothSprings',
  'removeFloatingKeystone',
]);
const ALLOWED_LOD = new Set([
  'preserveDamageVoids', 'coarseMayMergeAcrossClusters', 'shellSampleSpacing',
]);

function fail(message) {
  throw new Error(`ruin-masonry.yml: ${message}`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
}

function assertNoUnknownKeys(object, allowed, label) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) fail(`${label} has unknown key "${key}".`);
  }
}

function finiteInRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} must be between ${minimum} and ${maximum}, got ${value}.`);
  }
  return value;
}

function finiteAbove(value, label, minimum) {
  if (!Number.isFinite(value) || value <= minimum) {
    fail(`${label} must be > ${minimum}, got ${value}.`);
  }
  return value;
}

function assertIntegerInRange(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}, got ${value}.`);
  }
  return value;
}

function validateProfile(profile, label) {
  assertPlainObject(profile, label);
  assertNoUnknownKeys(profile, ALLOWED_TOP, label);
  if (typeof profile.enabled !== 'boolean') fail(`${label}.enabled must be boolean.`);

  assertPlainObject(profile.macro, `${label}.macro`);
  assertNoUnknownKeys(profile.macro, ALLOWED_MACRO, `${label}.macro`);
  finiteAbove(profile.macro.wavelength, `${label}.macro.wavelength`, 0);
  finiteInRange(profile.macro.fineWavelengthRatio, `${label}.macro.fineWavelengthRatio`, 0, 2);
  finiteInRange(profile.macro.lowWeight, `${label}.macro.lowWeight`, 0, 2);
  finiteInRange(profile.macro.fineWeight, `${label}.macro.fineWeight`, 0, 2);
  finiteInRange(profile.macro.bias, `${label}.macro.bias`, -1, 1);
  finiteInRange(profile.macro.collapseDepth, `${label}.macro.collapseDepth`, 0, 1);
  finiteAbove(profile.macro.minimumHeight, `${label}.macro.minimumHeight`, 0);

  assertPlainObject(profile.damage, `${label}.damage`);
  assertNoUnknownKeys(profile.damage, ALLOWED_DAMAGE, `${label}.damage`);
  assertPlainObject(profile.damage.reach, `${label}.damage.reach`);
  assertNoUnknownKeys(profile.damage.reach, ALLOWED_REACH, `${label}.damage.reach`);
  finiteInRange(profile.damage.reach.base, `${label}.damage.reach.base`, 0, 10);
  finiteInRange(profile.damage.reach.perFactor, `${label}.damage.reach.perFactor`, 0, 10);

  assertPlainObject(profile.damage.probability, `${label}.damage.probability`);
  assertNoUnknownKeys(profile.damage.probability, ALLOWED_PROBABILITY, `${label}.damage.probability`);
  for (const key of ALLOWED_PROBABILITY) {
    finiteInRange(profile.damage.probability[key], `${label}.damage.probability.${key}`, 0, 1);
  }

  assertPlainObject(profile.damage.cluster, `${label}.damage.cluster`);
  assertNoUnknownKeys(profile.damage.cluster, ALLOWED_CLUSTER, `${label}.damage.cluster`);
  finiteAbove(profile.damage.cluster.wavelength, `${label}.damage.cluster.wavelength`, 0);
  finiteInRange(profile.damage.cluster.fineWavelengthRatio, `${label}.damage.cluster.fineWavelengthRatio`, 0, 2);
  finiteAbove(profile.damage.cluster.minimumWidth, `${label}.damage.cluster.minimumWidth`, 0);
  finiteAbove(profile.damage.cluster.preferredWidth, `${label}.damage.cluster.preferredWidth`, 0);
  if (profile.damage.cluster.preferredWidth < profile.damage.cluster.minimumWidth) {
    fail(`${label}.damage.cluster preferredWidth must be >= minimumWidth.`);
  }
  finiteInRange(profile.damage.cluster.severeThreshold, `${label}.damage.cluster.severeThreshold`, 0, 1);
  finiteInRange(profile.damage.cluster.isolatedHoleThreshold, `${label}.damage.cluster.isolatedHoleThreshold`, 0, 1);

  assertPlainObject(profile.damage.protectedFooting, `${label}.damage.protectedFooting`);
  assertNoUnknownKeys(profile.damage.protectedFooting, ALLOWED_FOOTING, `${label}.damage.protectedFooting`);
  assertIntegerInRange(profile.damage.protectedFooting.courses, `${label}.damage.protectedFooting.courses`, 0, 5);
  finiteAbove(profile.damage.protectedFooting.minimumHeight, `${label}.damage.protectedFooting.minimumHeight`, 0);

  assertPlainObject(profile.support, `${label}.support`);
  assertNoUnknownKeys(profile.support, ALLOWED_SUPPORT, `${label}.support`);
  for (const key of ['minimumOverlapRatio', 'strongOverlapRatio']) {
    finiteInRange(profile.support[key], `${label}.support.${key}`, 0, 1);
  }
  finiteInRange(profile.support.minimumAbsoluteOverlap, `${label}.support.minimumAbsoluteOverlap`, 0, 5);
  finiteInRange(profile.support.maximumCantilever, `${label}.support.maximumCantilever`, 0, 5);
  finiteInRange(profile.support.verticalTolerance, `${label}.support.verticalTolerance`, 0, 5);
  finiteInRange(profile.support.foundationTolerance, `${label}.support.foundationTolerance`, 0, 5);
  assertIntegerInRange(profile.support.maximumPropagationSteps, `${label}.support.maximumPropagationSteps`, 1, 128);
  if (profile.support.strongOverlapRatio < profile.support.minimumOverlapRatio) {
    fail(`${label}.support strongOverlapRatio must be >= minimumOverlapRatio.`);
  }

  assertPlainObject(profile.crown, `${label}.crown`);
  assertNoUnknownKeys(profile.crown, ALLOWED_CROWN, `${label}.crown`);
  if (typeof profile.crown.removeUnsupportedPinnacles !== 'boolean') {
    fail(`${label}.crown.removeUnsupportedPinnacles must be boolean.`);
  }
  assertIntegerInRange(profile.crown.maximumUnsupportedToothCourses, `${label}.crown.maximumUnsupportedToothCourses`, 0, 10);
  assertIntegerInRange(profile.crown.maximumSupportedToothCourses, `${label}.crown.maximumSupportedToothCourses`, 0, 10);
  finiteAbove(profile.crown.minimumToothWidth, `${label}.crown.minimumToothWidth`, 0);
  finiteInRange(profile.crown.isolatedToothStrongSupport, `${label}.crown.isolatedToothStrongSupport`, 0, 1);
  finiteInRange(profile.crown.maximumBridgeSpan, `${label}.crown.maximumBridgeSpan`, 0, 5);

  assertPlainObject(profile.openings, `${label}.openings`);
  assertNoUnknownKeys(profile.openings, ALLOWED_OPENINGS, `${label}.openings`);
  if (typeof profile.openings.protectLowerJambs !== 'boolean') {
    fail(`${label}.openings.protectLowerJambs must be boolean.`);
  }
  finiteInRange(profile.openings.jambMinimumSupport, `${label}.openings.jambMinimumSupport`, 0, 1);
  if (typeof profile.openings.archRequiresBothSprings !== 'boolean') {
    fail(`${label}.openings.archRequiresBothSprings must be boolean.`);
  }
  if (typeof profile.openings.removeFloatingKeystone !== 'boolean') {
    fail(`${label}.openings.removeFloatingKeystone must be boolean.`);
  }

  assertPlainObject(profile.lod, `${label}.lod`);
  assertNoUnknownKeys(profile.lod, ALLOWED_LOD, `${label}.lod`);
  if (typeof profile.lod.preserveDamageVoids !== 'boolean') {
    fail(`${label}.lod.preserveDamageVoids must be boolean.`);
  }
  if (typeof profile.lod.coarseMayMergeAcrossClusters !== 'boolean') {
    fail(`${label}.lod.coarseMayMergeAcrossClusters must be boolean.`);
  }
  finiteInRange(profile.lod.shellSampleSpacing, `${label}.lod.shellSampleSpacing`, 0.1, 2);
}

function deepMerge(base, override = {}) {
  if (!override || typeof override !== 'object') return structuredClone(base);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)
      && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function validatePartial(override, label) {
  assertPlainObject(override, label);
  assertNoUnknownKeys(override, ALLOWED_TOP, label);
}

function freezeLiteral(value, indent = '') {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `Object.freeze([${value.map((entry) => freezeLiteral(entry, `${indent}  `)).join(', ')}])`;
  }
  const inner = `${indent}  `;
  const lines = Object.entries(value).map(([key, child]) => (
    `${inner}${JSON.stringify(key)}: ${freezeLiteral(child, inner)},`
  ));
  return `Object.freeze({\n${lines.join('\n')}\n${indent}})`;
}

function loadDocument() {
  const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
  assertPlainObject(document, 'root');
  assertNoUnknownKeys(document, ALLOWED_ROOT, 'root');
  if (document.version !== 1) fail(`unsupported version ${document.version}.`);
  validateProfile(document.defaults, 'defaults');
  const styles = document.styles ?? {};
  assertPlainObject(styles, 'styles');
  for (const [key, override] of Object.entries(styles)) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(key)) {
      fail(`styles.${key} is not a valid style name.`);
    }
    validatePartial(override, `styles.${key}`);
    validateProfile(deepMerge(document.defaults, override), `styles.${key}`);
  }
  return document;
}

function generateSource(document) {
  const defaults = deepMerge(document.defaults);
  const styleKeys = Object.keys(document.styles ?? {}).sort();
  const styleEntries = styleKeys.map((key) => {
    const profile = deepMerge(document.defaults, document.styles[key]);
    return `  ${JSON.stringify(key)}: ${freezeLiteral(profile, '  ')},`;
  });
  return [
    '/* Generated by tools/generate-construction-ruin-config.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_RUIN_PROFILES = Object.freeze({',
    `  default: ${freezeLiteral(defaults, '  ')},`,
    ...styleEntries,
    '});',
    '',
    'export function constructionRuinProfile(styleKey) {',
    '  return CONSTRUCTION_RUIN_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_RUIN_PROFILES.default;',
    '}',
    '',
  ].join('\n');
}

const check = process.argv.includes('--check');
const document = loadDocument();
const source = generateSource(document);
if (check) {
  const current = readFileSync(OUT_PATH, 'utf8');
  if (current !== source) {
    console.error('ConstructionRuinConfig.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-ruin-config.mjs');
    process.exit(1);
  }
  console.log('ConstructionRuinConfig.generated.js is up to date.');
  process.exit(0);
}
writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
