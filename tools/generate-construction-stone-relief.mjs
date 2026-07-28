#!/usr/bin/env node
/**
 * Generate ConstructionStoneReliefProfiles.generated.js from stone-face-relief.yml.
 *
 * Usage:
 *   node tools/generate-construction-stone-relief.mjs
 *   node tools/generate-construction-stone-relief.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-face-relief.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js',
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
  'enabled',
  'grid',
  'minimumStone',
  'recession',
  'edgeFalloffPower',
  'asymmetry',
  'saddleStrength',
  'maximumBevelFraction',
  'maximumMortarRecessFraction',
  'categories',
]);
const ALLOWED_GRID = new Set(['columns', 'rows']);
const ALLOWED_MINIMUM_STONE = new Set(['width', 'height']);
const ALLOWED_RECESSION = new Set(['ratioMin', 'ratioMax', 'minimum', 'maximum']);
const ALLOWED_CATEGORIES = new Set([
  'field',
  'coping',
  'ashlar',
  'quoin',
  'voussoir',
  'merlon',
  'recess',
]);

function fail(message) {
  throw new Error(`stone-face-relief.yml: ${message}`);
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

function validateGrid(grid, label) {
  assertPlainObject(grid, label);
  assertNoUnknownKeys(grid, ALLOWED_GRID, label);
  assertIntegerInRange(grid.columns, `${label}.columns`, 2, 6);
  assertIntegerInRange(grid.rows, `${label}.rows`, 2, 6);
}

function validateMinimumStone(minimumStone, label) {
  assertPlainObject(minimumStone, label);
  assertNoUnknownKeys(minimumStone, ALLOWED_MINIMUM_STONE, label);
  if (!(Number.isFinite(minimumStone.width) && minimumStone.width > 0)) {
    fail(`${label}.width must be > 0, got ${minimumStone.width}.`);
  }
  if (!(Number.isFinite(minimumStone.height) && minimumStone.height > 0)) {
    fail(`${label}.height must be > 0, got ${minimumStone.height}.`);
  }
}

function validateRecession(recession, label) {
  assertPlainObject(recession, label);
  assertNoUnknownKeys(recession, ALLOWED_RECESSION, label);
  finiteInRange(recession.ratioMin, `${label}.ratioMin`, 0, Infinity);
  finiteInRange(recession.ratioMax, `${label}.ratioMax`, 0, Infinity);
  if (recession.ratioMax < recession.ratioMin) {
    fail(`${label}.ratioMax must be >= ratioMin.`);
  }
  finiteInRange(recession.minimum, `${label}.minimum`, 0, Infinity);
  finiteInRange(recession.maximum, `${label}.maximum`, 0, 0.05);
  if (recession.maximum < recession.minimum) {
    fail(`${label}.maximum must be >= minimum.`);
  }
}

function validateCategories(categories, label) {
  assertPlainObject(categories, label);
  assertNoUnknownKeys(categories, ALLOWED_CATEGORIES, label);
  for (const key of ALLOWED_CATEGORIES) {
    if (!(key in categories)) fail(`${label} is missing "${key}".`);
    finiteInRange(categories[key], `${label}.${key}`, 0, 1);
  }
}

function validateProfile(profile, label) {
  assertPlainObject(profile, label);
  assertNoUnknownKeys(profile, ALLOWED_PROFILE, label);
  if (typeof profile.enabled !== 'boolean') {
    fail(`${label}.enabled must be a boolean.`);
  }
  validateGrid(profile.grid, `${label}.grid`);
  validateMinimumStone(profile.minimumStone, `${label}.minimumStone`);
  validateRecession(profile.recession, `${label}.recession`);
  finiteInRange(profile.edgeFalloffPower, `${label}.edgeFalloffPower`, 0.5, 4);
  finiteInRange(profile.asymmetry, `${label}.asymmetry`, 0, 1);
  finiteInRange(profile.saddleStrength, `${label}.saddleStrength`, 0, 0.5);
  finiteInRange(profile.maximumBevelFraction, `${label}.maximumBevelFraction`, 0, 0.9);
  finiteInRange(
    profile.maximumMortarRecessFraction,
    `${label}.maximumMortarRecessFraction`,
    0,
    0.9,
  );
  validateCategories(profile.categories, `${label}.categories`);
}

function mergeDeep(defaults, override = {}) {
  return {
    enabled: override.enabled ?? defaults.enabled,
    grid: {
      columns: override.grid?.columns ?? defaults.grid.columns,
      rows: override.grid?.rows ?? defaults.grid.rows,
    },
    minimumStone: {
      width: override.minimumStone?.width ?? defaults.minimumStone.width,
      height: override.minimumStone?.height ?? defaults.minimumStone.height,
    },
    recession: {
      ratioMin: override.recession?.ratioMin ?? defaults.recession.ratioMin,
      ratioMax: override.recession?.ratioMax ?? defaults.recession.ratioMax,
      minimum: override.recession?.minimum ?? defaults.recession.minimum,
      maximum: override.recession?.maximum ?? defaults.recession.maximum,
    },
    edgeFalloffPower: override.edgeFalloffPower ?? defaults.edgeFalloffPower,
    asymmetry: override.asymmetry ?? defaults.asymmetry,
    saddleStrength: override.saddleStrength ?? defaults.saddleStrength,
    maximumBevelFraction: override.maximumBevelFraction ?? defaults.maximumBevelFraction,
    maximumMortarRecessFraction:
      override.maximumMortarRecessFraction ?? defaults.maximumMortarRecessFraction,
    categories: {
      field: override.categories?.field ?? defaults.categories.field,
      coping: override.categories?.coping ?? defaults.categories.coping,
      ashlar: override.categories?.ashlar ?? defaults.categories.ashlar,
      quoin: override.categories?.quoin ?? defaults.categories.quoin,
      voussoir: override.categories?.voussoir ?? defaults.categories.voussoir,
      merlon: override.categories?.merlon ?? defaults.categories.merlon,
      recess: override.categories?.recess ?? defaults.categories.recess,
    },
  };
}

function validatePartialOverride(override, label) {
  assertPlainObject(override, label);
  assertNoUnknownKeys(override, ALLOWED_PROFILE, label);
  if (override.enabled != null && typeof override.enabled !== 'boolean') {
    fail(`${label}.enabled must be a boolean.`);
  }
  if (override.grid) validateGrid(override.grid, `${label}.grid`);
  if (override.minimumStone) {
    assertPlainObject(override.minimumStone, `${label}.minimumStone`);
    assertNoUnknownKeys(override.minimumStone, ALLOWED_MINIMUM_STONE, `${label}.minimumStone`);
    if (override.minimumStone.width != null
      && !(Number.isFinite(override.minimumStone.width) && override.minimumStone.width > 0)) {
      fail(`${label}.minimumStone.width must be > 0.`);
    }
    if (override.minimumStone.height != null
      && !(Number.isFinite(override.minimumStone.height) && override.minimumStone.height > 0)) {
      fail(`${label}.minimumStone.height must be > 0.`);
    }
  }
  if (override.recession) {
    assertPlainObject(override.recession, `${label}.recession`);
    assertNoUnknownKeys(override.recession, ALLOWED_RECESSION, `${label}.recession`);
    if (override.recession.ratioMin != null) {
      finiteInRange(override.recession.ratioMin, `${label}.recession.ratioMin`, 0, Infinity);
    }
    if (override.recession.ratioMax != null) {
      finiteInRange(override.recession.ratioMax, `${label}.recession.ratioMax`, 0, Infinity);
    }
    if (override.recession.minimum != null) {
      finiteInRange(override.recession.minimum, `${label}.recession.minimum`, 0, Infinity);
    }
    if (override.recession.maximum != null) {
      finiteInRange(override.recession.maximum, `${label}.recession.maximum`, 0, 0.05);
    }
  }
  if (override.edgeFalloffPower != null) {
    finiteInRange(override.edgeFalloffPower, `${label}.edgeFalloffPower`, 0.5, 4);
  }
  if (override.asymmetry != null) {
    finiteInRange(override.asymmetry, `${label}.asymmetry`, 0, 1);
  }
  if (override.saddleStrength != null) {
    finiteInRange(override.saddleStrength, `${label}.saddleStrength`, 0, 0.5);
  }
  if (override.maximumBevelFraction != null) {
    finiteInRange(override.maximumBevelFraction, `${label}.maximumBevelFraction`, 0, 0.9);
  }
  if (override.maximumMortarRecessFraction != null) {
    finiteInRange(
      override.maximumMortarRecessFraction,
      `${label}.maximumMortarRecessFraction`,
      0,
      0.9,
    );
  }
  if (override.categories) {
    assertPlainObject(override.categories, `${label}.categories`);
    assertNoUnknownKeys(override.categories, ALLOWED_CATEGORIES, `${label}.categories`);
    for (const [key, value] of Object.entries(override.categories)) {
      finiteInRange(value, `${label}.categories.${key}`, 0, 1);
    }
  }
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
    validatePartialOverride(override, `styles.${key}`);
    validateProfile(mergeDeep(document.defaults, override), `styles.${key}`);
  }
  return document;
}

function freezeGrid(grid) {
  return `Object.freeze({ columns: ${grid.columns}, rows: ${grid.rows} })`;
}

function freezeMinimumStone(minimumStone) {
  return `Object.freeze({ width: ${minimumStone.width}, height: ${minimumStone.height} })`;
}

function freezeRecession(recession) {
  return [
    'Object.freeze({',
    `  ratioMin: ${recession.ratioMin},`,
    `  ratioMax: ${recession.ratioMax},`,
    `  minimum: ${recession.minimum},`,
    `  maximum: ${recession.maximum},`,
    '})',
  ].join('\n');
}

function freezeCategories(categories, indent = '') {
  const inner = `${indent}  `;
  return [
    'Object.freeze({',
    `${inner}field: ${categories.field},`,
    `${inner}coping: ${categories.coping},`,
    `${inner}ashlar: ${categories.ashlar},`,
    `${inner}quoin: ${categories.quoin},`,
    `${inner}voussoir: ${categories.voussoir},`,
    `${inner}merlon: ${categories.merlon},`,
    `${inner}recess: ${categories.recess},`,
    `${indent}})`,
  ].join('\n');
}

function freezeProfile(profile, indent = '') {
  const inner = `${indent}  `;
  const recession = freezeRecession(profile.recession).replaceAll('\n', `\n${inner}`);
  const categories = freezeCategories(profile.categories, inner);
  return [
    'Object.freeze({',
    `${inner}enabled: ${profile.enabled},`,
    `${inner}grid: ${freezeGrid(profile.grid)},`,
    `${inner}minimumStone: ${freezeMinimumStone(profile.minimumStone)},`,
    `${inner}recession: ${recession},`,
    `${inner}edgeFalloffPower: ${profile.edgeFalloffPower},`,
    `${inner}asymmetry: ${profile.asymmetry},`,
    `${inner}saddleStrength: ${profile.saddleStrength},`,
    `${inner}maximumBevelFraction: ${profile.maximumBevelFraction},`,
    `${inner}maximumMortarRecessFraction: ${profile.maximumMortarRecessFraction},`,
    `${inner}categories: ${categories},`,
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
    '/* Generated by tools/generate-construction-stone-relief.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_STONE_RELIEF_PROFILES = Object.freeze({',
    `  default: ${freezeProfile(defaults, '  ')},`,
    ...styleEntries,
    '});',
    '',
    'export function constructionStoneReliefProfile(styleKey) {',
    '  return CONSTRUCTION_STONE_RELIEF_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_STONE_RELIEF_PROFILES.default;',
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
    console.error('ConstructionStoneReliefProfiles.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-stone-relief.mjs');
    process.exit(1);
  }
  console.log('ConstructionStoneReliefProfiles.generated.js is up to date.');
  process.exit(0);
}

writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
