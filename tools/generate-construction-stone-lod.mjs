#!/usr/bin/env node
/**
 * Generate ConstructionStoneLodProfiles.generated.js from stone-geometry-lod.yml.
 *
 * Usage:
 *   node tools/generate-construction-stone-lod.mjs
 *   node tools/generate-construction-stone-lod.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-geometry-lod.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionStoneLodProfiles.generated.js',
);

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const YAML_PATH = argValue('--yaml') ?? DEFAULT_YAML_PATH;
const OUT_PATH = argValue('--out') ?? DEFAULT_OUT_PATH;

const ALLOWED_ROOT = new Set(['version', 'defaults', 'styles']);
const ALLOWED_PROFILE = new Set(['near', 'coarse', 'transition']);
const ALLOWED_BAND = new Set([
  'mode',
  'faceGrid',
  'bevelRings',
  'edgeMidpoints',
  'cornerFlattening',
  'reliefAmplitudeScale',
  'edgeVariationScale',
]);
const ALLOWED_GRID = new Set(['columns', 'rows']);
const ALLOWED_TRANSITION = new Set(['hysteresisMetres', 'minimumResidenceMs', 'crossfade']);
const ALLOWED_CROSSFADE = new Set([
  'enabled',
  'durationMs',
  'ditherScale',
  'maximumConcurrentModules',
]);
const ALLOWED_MODES = new Set(['legacy', 'soft', 'soft-coarse']);

function fail(message) {
  throw new Error(`stone-geometry-lod.yml: ${message}`);
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

function assertIntegerInRange(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}, got ${value}.`);
  }
  return value;
}

function validateBand(band, label) {
  assertPlainObject(band, label);
  assertNoUnknownKeys(band, ALLOWED_BAND, label);
  if (!ALLOWED_MODES.has(band.mode)) fail(`${label}.mode "${band.mode}" is invalid.`);
  assertPlainObject(band.faceGrid, `${label}.faceGrid`);
  assertNoUnknownKeys(band.faceGrid, ALLOWED_GRID, `${label}.faceGrid`);
  assertIntegerInRange(band.faceGrid.columns, `${label}.faceGrid.columns`, 0, 6);
  assertIntegerInRange(band.faceGrid.rows, `${label}.faceGrid.rows`, 0, 6);
  assertIntegerInRange(band.bevelRings, `${label}.bevelRings`, 1, 3);
  if (typeof band.edgeMidpoints !== 'boolean') fail(`${label}.edgeMidpoints must be boolean.`);
  if (typeof band.cornerFlattening !== 'boolean') {
    fail(`${label}.cornerFlattening must be boolean.`);
  }
  finiteInRange(band.reliefAmplitudeScale, `${label}.reliefAmplitudeScale`, 0, 1);
  finiteInRange(band.edgeVariationScale, `${label}.edgeVariationScale`, 0, 1);
  if (
    (band.mode === 'soft' || band.mode === 'soft-coarse')
    && (band.faceGrid.columns < 1 || band.faceGrid.rows < 1)
  ) {
    fail(`${label}.faceGrid must be at least 1×1 when mode is ${band.mode}.`);
  }
}

function validateTransition(transition, label) {
  assertPlainObject(transition, label);
  assertNoUnknownKeys(transition, ALLOWED_TRANSITION, label);
  finiteInRange(transition.hysteresisMetres, `${label}.hysteresisMetres`, 0, 50);
  finiteInRange(transition.minimumResidenceMs, `${label}.minimumResidenceMs`, 0, 5000);
  assertPlainObject(transition.crossfade, `${label}.crossfade`);
  assertNoUnknownKeys(transition.crossfade, ALLOWED_CROSSFADE, `${label}.crossfade`);
  if (typeof transition.crossfade.enabled !== 'boolean') {
    fail(`${label}.crossfade.enabled must be boolean.`);
  }
  finiteInRange(transition.crossfade.durationMs, `${label}.crossfade.durationMs`, 0, 2000);
  finiteInRange(transition.crossfade.ditherScale, `${label}.crossfade.ditherScale`, 0, 8);
  assertIntegerInRange(
    transition.crossfade.maximumConcurrentModules,
    `${label}.crossfade.maximumConcurrentModules`,
    1,
    32,
  );
}

function validateProfile(profile, label) {
  assertPlainObject(profile, label);
  assertNoUnknownKeys(profile, ALLOWED_PROFILE, label);
  validateBand(profile.near, `${label}.near`);
  validateBand(profile.coarse, `${label}.coarse`);
  validateTransition(profile.transition, `${label}.transition`);
}

function mergeDeep(defaults, override = {}) {
  const mergeBand = (base, next = {}) => ({
    mode: next.mode ?? base.mode,
    faceGrid: {
      columns: next.faceGrid?.columns ?? base.faceGrid.columns,
      rows: next.faceGrid?.rows ?? base.faceGrid.rows,
    },
    bevelRings: next.bevelRings ?? base.bevelRings,
    edgeMidpoints: next.edgeMidpoints ?? base.edgeMidpoints,
    cornerFlattening: next.cornerFlattening ?? base.cornerFlattening,
    reliefAmplitudeScale: next.reliefAmplitudeScale ?? base.reliefAmplitudeScale,
    edgeVariationScale: next.edgeVariationScale ?? base.edgeVariationScale,
  });
  return {
    near: mergeBand(defaults.near, override.near),
    coarse: mergeBand(defaults.coarse, override.coarse),
    transition: {
      hysteresisMetres: override.transition?.hysteresisMetres ?? defaults.transition.hysteresisMetres,
      minimumResidenceMs:
        override.transition?.minimumResidenceMs ?? defaults.transition.minimumResidenceMs,
      crossfade: {
        enabled: override.transition?.crossfade?.enabled ?? defaults.transition.crossfade.enabled,
        durationMs:
          override.transition?.crossfade?.durationMs ?? defaults.transition.crossfade.durationMs,
        ditherScale:
          override.transition?.crossfade?.ditherScale ?? defaults.transition.crossfade.ditherScale,
        maximumConcurrentModules:
          override.transition?.crossfade?.maximumConcurrentModules
          ?? defaults.transition.crossfade.maximumConcurrentModules,
      },
    },
  };
}

function validatePartial(override, label) {
  assertPlainObject(override, label);
  assertNoUnknownKeys(override, ALLOWED_PROFILE, label);
  if (override.near) {
    assertPlainObject(override.near, `${label}.near`);
    assertNoUnknownKeys(override.near, ALLOWED_BAND, `${label}.near`);
    if (override.near.mode != null && !ALLOWED_MODES.has(override.near.mode)) {
      fail(`${label}.near.mode "${override.near.mode}" is invalid.`);
    }
  }
  if (override.coarse) {
    assertPlainObject(override.coarse, `${label}.coarse`);
    assertNoUnknownKeys(override.coarse, ALLOWED_BAND, `${label}.coarse`);
    if (override.coarse.mode != null && !ALLOWED_MODES.has(override.coarse.mode)) {
      fail(`${label}.coarse.mode "${override.coarse.mode}" is invalid.`);
    }
  }
  if (override.transition) {
    assertPlainObject(override.transition, `${label}.transition`);
    assertNoUnknownKeys(override.transition, ALLOWED_TRANSITION, `${label}.transition`);
  }
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
    validateProfile(mergeDeep(document.defaults, override), `styles.${key}`);
  }
  return document;
}

function freezeBand(band, indent = '') {
  const inner = `${indent}  `;
  return [
    'Object.freeze({',
    `${inner}mode: ${JSON.stringify(band.mode)},`,
    `${inner}faceGrid: Object.freeze({ columns: ${band.faceGrid.columns}, rows: ${band.faceGrid.rows} }),`,
    `${inner}bevelRings: ${band.bevelRings},`,
    `${inner}edgeMidpoints: ${band.edgeMidpoints},`,
    `${inner}cornerFlattening: ${band.cornerFlattening},`,
    `${inner}reliefAmplitudeScale: ${band.reliefAmplitudeScale},`,
    `${inner}edgeVariationScale: ${band.edgeVariationScale},`,
    `${indent}})`,
  ].join('\n');
}

function freezeProfile(profile, indent = '') {
  const inner = `${indent}  `;
  return [
    'Object.freeze({',
    `${inner}near: ${freezeBand(profile.near, inner)},`,
    `${inner}coarse: ${freezeBand(profile.coarse, inner)},`,
    `${inner}transition: Object.freeze({`,
    `${inner}  hysteresisMetres: ${profile.transition.hysteresisMetres},`,
    `${inner}  minimumResidenceMs: ${profile.transition.minimumResidenceMs},`,
    `${inner}  crossfade: Object.freeze({`,
    `${inner}    enabled: ${profile.transition.crossfade.enabled},`,
    `${inner}    durationMs: ${profile.transition.crossfade.durationMs},`,
    `${inner}    ditherScale: ${profile.transition.crossfade.ditherScale},`,
    `${inner}    maximumConcurrentModules: ${profile.transition.crossfade.maximumConcurrentModules},`,
    `${inner}  }),`,
    `${inner}}),`,
    `${indent}})`,
  ].join('\n');
}

function generateSource(document) {
  const defaults = mergeDeep(document.defaults);
  const styleKeys = Object.keys(document.styles ?? {}).sort();
  const styleEntries = styleKeys.map((key) => {
    const profile = mergeDeep(document.defaults, document.styles[key]);
    return `  ${JSON.stringify(key)}: ${freezeProfile(profile, '  ')},`;
  });
  return [
    '/* Generated by tools/generate-construction-stone-lod.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_STONE_LOD_PROFILES = Object.freeze({',
    `  default: ${freezeProfile(defaults, '  ')},`,
    ...styleEntries,
    '});',
    '',
    'export function constructionStoneLodProfile(styleKey) {',
    '  return CONSTRUCTION_STONE_LOD_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_STONE_LOD_PROFILES.default;',
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
    console.error('ConstructionStoneLodProfiles.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-stone-lod.mjs');
    process.exit(1);
  }
  console.log('ConstructionStoneLodProfiles.generated.js is up to date.');
  process.exit(0);
}
writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
