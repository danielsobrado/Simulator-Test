#!/usr/bin/env node
/**
 * Generate ConstructionJointProfiles.generated.js from masonry-joints.yml.
 *
 * Usage:
 *   node tools/generate-construction-joint-profiles.mjs
 *   node tools/generate-construction-joint-profiles.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/masonry-joints.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionJointProfiles.generated.js',
);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const YAML_PATH = argValue('--yaml') ?? DEFAULT_YAML_PATH;
const OUT_PATH = argValue('--out') ?? DEFAULT_OUT_PATH;

const ALLOWED_ROOT = new Set(['version', 'defaults', 'styles']);
const ALLOWED_PROFILE = new Set([
  'headJoint',
  'bedJoint',
  'coarseLodMultiplier',
  'mortarSafetyOverlap',
  'minimumRenderedWidth',
  'minimumRenderedHeight',
]);
const ALLOWED_RANGE = new Set(['min', 'max']);

function fail(message) {
  throw new Error(`masonry-joints.yml: ${message}`);
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

function validateRange(range, label) {
  assertPlainObject(range, label);
  assertNoUnknownKeys(range, ALLOWED_RANGE, label);
  finiteInRange(range.min, `${label}.min`, 0, 0.1);
  finiteInRange(range.max, `${label}.max`, 0, 0.1);
  if (range.max < range.min) fail(`${label} range is reversed.`);
}

function validateProfile(profile, label) {
  assertPlainObject(profile, label);
  assertNoUnknownKeys(profile, ALLOWED_PROFILE, label);
  validateRange(profile.headJoint, `${label}.headJoint`);
  validateRange(profile.bedJoint, `${label}.bedJoint`);
  finiteInRange(profile.coarseLodMultiplier, `${label}.coarseLodMultiplier`, 1, 2);
  finiteInRange(profile.mortarSafetyOverlap, `${label}.mortarSafetyOverlap`, 0, 0.02);
  finiteInRange(profile.minimumRenderedWidth, `${label}.minimumRenderedWidth`, Number.EPSILON, Infinity);
  finiteInRange(profile.minimumRenderedHeight, `${label}.minimumRenderedHeight`, Number.EPSILON, Infinity);
}

function freezeRange(range) {
  return `Object.freeze({ min: ${range.min}, max: ${range.max} })`;
}

function freezeProfile(profile, indent = '') {
  const inner = `${indent}  `;
  return [
    'Object.freeze({',
    `${inner}headJoint: ${freezeRange(profile.headJoint)},`,
    `${inner}bedJoint: ${freezeRange(profile.bedJoint)},`,
    `${inner}coarseLodMultiplier: ${profile.coarseLodMultiplier},`,
    `${inner}mortarSafetyOverlap: ${profile.mortarSafetyOverlap},`,
    `${inner}minimumRenderedWidth: ${profile.minimumRenderedWidth},`,
    `${inner}minimumRenderedHeight: ${profile.minimumRenderedHeight},`,
    `${indent}})`,
  ].join('\n');
}

function mergeProfile(defaults, override = {}) {
  return {
    headJoint: {
      min: override.headJoint?.min ?? defaults.headJoint.min,
      max: override.headJoint?.max ?? defaults.headJoint.max,
    },
    bedJoint: {
      min: override.bedJoint?.min ?? defaults.bedJoint.min,
      max: override.bedJoint?.max ?? defaults.bedJoint.max,
    },
    coarseLodMultiplier: override.coarseLodMultiplier ?? defaults.coarseLodMultiplier,
    mortarSafetyOverlap: override.mortarSafetyOverlap ?? defaults.mortarSafetyOverlap,
    minimumRenderedWidth: override.minimumRenderedWidth ?? defaults.minimumRenderedWidth,
    minimumRenderedHeight: override.minimumRenderedHeight ?? defaults.minimumRenderedHeight,
  };
}

function loadDocument(yamlPath = YAML_PATH) {
  const document = yaml.load(readFileSync(yamlPath, 'utf8'));
  assertPlainObject(document, 'root');
  assertNoUnknownKeys(document, ALLOWED_ROOT, 'root');
  if (document.version !== 1) fail(`unsupported version ${document.version}.`);
  assertPlainObject(document.defaults, 'defaults');
  validateProfile(document.defaults, 'defaults');
  const styles = document.styles ?? {};
  assertPlainObject(styles, 'styles');
  for (const [key, override] of Object.entries(styles)) {
    assertPlainObject(override, `styles.${key}`);
    assertNoUnknownKeys(override, ALLOWED_PROFILE, `styles.${key}`);
    if (override.headJoint) validateRange(override.headJoint, `styles.${key}.headJoint`);
    if (override.bedJoint) validateRange(override.bedJoint, `styles.${key}.bedJoint`);
    if (override.coarseLodMultiplier != null) {
      finiteInRange(override.coarseLodMultiplier, `styles.${key}.coarseLodMultiplier`, 1, 2);
    }
    if (override.mortarSafetyOverlap != null) {
      finiteInRange(override.mortarSafetyOverlap, `styles.${key}.mortarSafetyOverlap`, 0, 0.02);
    }
    if (override.minimumRenderedWidth != null) {
      finiteInRange(override.minimumRenderedWidth, `styles.${key}.minimumRenderedWidth`, Number.EPSILON, Infinity);
    }
    if (override.minimumRenderedHeight != null) {
      finiteInRange(override.minimumRenderedHeight, `styles.${key}.minimumRenderedHeight`, Number.EPSILON, Infinity);
    }
    validateProfile(mergeProfile(document.defaults, override), `styles.${key}`);
  }
  return document;
}

function generateSource(document) {
  const defaults = mergeProfile(document.defaults);
  const styleKeys = Object.keys(document.styles ?? {}).sort();
  const styleEntries = styleKeys.map((key) => {
    const profile = mergeProfile(document.defaults, document.styles[key]);
    return `  ${JSON.stringify(key)}: ${freezeProfile(profile, '  ')},`;
  });

  return [
    '/* Generated by tools/generate-construction-joint-profiles.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_JOINT_PROFILES = Object.freeze({',
    `  default: ${freezeProfile(defaults, '  ')},`,
    ...styleEntries,
    '});',
    '',
    'export function constructionJointProfile(styleKey) {',
    '  return CONSTRUCTION_JOINT_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_JOINT_PROFILES.default;',
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
    console.error('ConstructionJointProfiles.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-joint-profiles.mjs');
    process.exit(1);
  }
  console.log('ConstructionJointProfiles.generated.js is up to date.');
  process.exit(0);
}

writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
