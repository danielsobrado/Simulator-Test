#!/usr/bin/env node
/**
 * Generate ConstructionStoneEdgeWearProfiles.generated.js from stone-edge-wear.yml.
 *
 * Usage:
 *   node tools/generate-construction-stone-edge-wear.mjs
 *   node tools/generate-construction-stone-edge-wear.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-edge-wear.yml');
const DEFAULT_OUT_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js',
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
  'minimumStone',
  'bevel',
  'cornerVariation',
  'edgeVariation',
  'verticalBias',
  'cornerFlattening',
  'segments',
  'safeguards',
  'categories',
]);
const ALLOWED_MINIMUM_STONE = new Set(['width', 'height', 'depth']);
const ALLOWED_BEVEL = new Set([
  'widthRatio',
  'depthRatio',
  'absoluteMinimum',
  'absoluteMaximum',
]);
const ALLOWED_RATIO = new Set(['min', 'max']);
const ALLOWED_CORNER_VARIATION = new Set(['amount', 'correlation']);
const ALLOWED_EDGE_VARIATION = new Set(['amount', 'midpointBias']);
const ALLOWED_VERTICAL_BIAS = new Set(['top', 'bottom']);
const ALLOWED_FLATTENING = new Set(['chance', 'strengthMin', 'strengthMax']);
const ALLOWED_SEGMENTS = new Set(['near', 'coarse']);
const ALLOWED_SAFEGUARDS = new Set([
  'minimumFaceAreaRatio',
  'minimumEdgeLength',
  'maximumInsetEdgeRatio',
  'maximumDepthFraction',
  'maximumMortarFraction',
]);
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
  throw new Error(`stone-edge-wear.yml: ${message}`);
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

function validateRatio(range, label, minimum, maximum) {
  assertPlainObject(range, label);
  assertNoUnknownKeys(range, ALLOWED_RATIO, label);
  finiteInRange(range.min, `${label}.min`, minimum, maximum);
  finiteInRange(range.max, `${label}.max`, minimum, maximum);
  if (range.max < range.min) fail(`${label} range is reversed.`);
}

function validateMinimumStone(minimumStone, label) {
  assertPlainObject(minimumStone, label);
  assertNoUnknownKeys(minimumStone, ALLOWED_MINIMUM_STONE, label);
  for (const key of ['width', 'height', 'depth']) {
    if (!(Number.isFinite(minimumStone[key]) && minimumStone[key] > 0)) {
      fail(`${label}.${key} must be > 0, got ${minimumStone[key]}.`);
    }
  }
}

function validateBevel(bevel, label) {
  assertPlainObject(bevel, label);
  assertNoUnknownKeys(bevel, ALLOWED_BEVEL, label);
  validateRatio(bevel.widthRatio, `${label}.widthRatio`, 0, 0.4);
  validateRatio(bevel.depthRatio, `${label}.depthRatio`, 0, 0.4);
  finiteInRange(bevel.absoluteMinimum, `${label}.absoluteMinimum`, 0, 0.2);
  finiteInRange(bevel.absoluteMaximum, `${label}.absoluteMaximum`, 0, 0.2);
  if (bevel.absoluteMaximum < bevel.absoluteMinimum) {
    fail(`${label} absolute range is reversed.`);
  }
}

function validateCornerVariation(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_CORNER_VARIATION, label);
  finiteInRange(value.amount, `${label}.amount`, 0, 0.8);
  finiteInRange(value.correlation, `${label}.correlation`, 0, 1);
}

function validateEdgeVariation(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_EDGE_VARIATION, label);
  finiteInRange(value.amount, `${label}.amount`, 0, 0.5);
  finiteInRange(value.midpointBias, `${label}.midpointBias`, 0, 1);
}

function validateVerticalBias(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_VERTICAL_BIAS, label);
  finiteInRange(value.top, `${label}.top`, 0.5, 1.5);
  finiteInRange(value.bottom, `${label}.bottom`, 0.5, 1.5);
}

function validateFlattening(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_FLATTENING, label);
  finiteInRange(value.chance, `${label}.chance`, 0, 1);
  finiteInRange(value.strengthMin, `${label}.strengthMin`, 0, 0.5);
  finiteInRange(value.strengthMax, `${label}.strengthMax`, 0, 0.5);
  if (value.strengthMax < value.strengthMin) {
    fail(`${label} strength range is reversed.`);
  }
}

function validateSegments(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_SEGMENTS, label);
  assertIntegerInRange(value.near, `${label}.near`, 1, 4);
  assertIntegerInRange(value.coarse, `${label}.coarse`, 1, 2);
}

function validateSafeguards(value, label) {
  assertPlainObject(value, label);
  assertNoUnknownKeys(value, ALLOWED_SAFEGUARDS, label);
  finiteInRange(value.minimumFaceAreaRatio, `${label}.minimumFaceAreaRatio`, 0.3, 1);
  if (!(Number.isFinite(value.minimumEdgeLength) && value.minimumEdgeLength > 0)) {
    fail(`${label}.minimumEdgeLength must be > 0.`);
  }
  finiteInRange(value.maximumInsetEdgeRatio, `${label}.maximumInsetEdgeRatio`, 0.05, 0.45);
  finiteInRange(value.maximumDepthFraction, `${label}.maximumDepthFraction`, 0.05, 0.5);
  finiteInRange(value.maximumMortarFraction, `${label}.maximumMortarFraction`, 0.1, 0.9);
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
  if (typeof profile.enabled !== 'boolean') fail(`${label}.enabled must be a boolean.`);
  validateMinimumStone(profile.minimumStone, `${label}.minimumStone`);
  validateBevel(profile.bevel, `${label}.bevel`);
  validateCornerVariation(profile.cornerVariation, `${label}.cornerVariation`);
  validateEdgeVariation(profile.edgeVariation, `${label}.edgeVariation`);
  validateVerticalBias(profile.verticalBias, `${label}.verticalBias`);
  validateFlattening(profile.cornerFlattening, `${label}.cornerFlattening`);
  validateSegments(profile.segments, `${label}.segments`);
  validateSafeguards(profile.safeguards, `${label}.safeguards`);
  validateCategories(profile.categories, `${label}.categories`);
}

function mergeDeep(defaults, override = {}) {
  return {
    enabled: override.enabled ?? defaults.enabled,
    minimumStone: {
      width: override.minimumStone?.width ?? defaults.minimumStone.width,
      height: override.minimumStone?.height ?? defaults.minimumStone.height,
      depth: override.minimumStone?.depth ?? defaults.minimumStone.depth,
    },
    bevel: {
      widthRatio: {
        min: override.bevel?.widthRatio?.min ?? defaults.bevel.widthRatio.min,
        max: override.bevel?.widthRatio?.max ?? defaults.bevel.widthRatio.max,
      },
      depthRatio: {
        min: override.bevel?.depthRatio?.min ?? defaults.bevel.depthRatio.min,
        max: override.bevel?.depthRatio?.max ?? defaults.bevel.depthRatio.max,
      },
      absoluteMinimum: override.bevel?.absoluteMinimum ?? defaults.bevel.absoluteMinimum,
      absoluteMaximum: override.bevel?.absoluteMaximum ?? defaults.bevel.absoluteMaximum,
    },
    cornerVariation: {
      amount: override.cornerVariation?.amount ?? defaults.cornerVariation.amount,
      correlation: override.cornerVariation?.correlation ?? defaults.cornerVariation.correlation,
    },
    edgeVariation: {
      amount: override.edgeVariation?.amount ?? defaults.edgeVariation.amount,
      midpointBias: override.edgeVariation?.midpointBias ?? defaults.edgeVariation.midpointBias,
    },
    verticalBias: {
      top: override.verticalBias?.top ?? defaults.verticalBias.top,
      bottom: override.verticalBias?.bottom ?? defaults.verticalBias.bottom,
    },
    cornerFlattening: {
      chance: override.cornerFlattening?.chance ?? defaults.cornerFlattening.chance,
      strengthMin: override.cornerFlattening?.strengthMin ?? defaults.cornerFlattening.strengthMin,
      strengthMax: override.cornerFlattening?.strengthMax ?? defaults.cornerFlattening.strengthMax,
    },
    segments: {
      near: override.segments?.near ?? defaults.segments.near,
      coarse: override.segments?.coarse ?? defaults.segments.coarse,
    },
    safeguards: {
      minimumFaceAreaRatio:
        override.safeguards?.minimumFaceAreaRatio ?? defaults.safeguards.minimumFaceAreaRatio,
      minimumEdgeLength:
        override.safeguards?.minimumEdgeLength ?? defaults.safeguards.minimumEdgeLength,
      maximumInsetEdgeRatio:
        override.safeguards?.maximumInsetEdgeRatio ?? defaults.safeguards.maximumInsetEdgeRatio,
      maximumDepthFraction:
        override.safeguards?.maximumDepthFraction ?? defaults.safeguards.maximumDepthFraction,
      maximumMortarFraction:
        override.safeguards?.maximumMortarFraction ?? defaults.safeguards.maximumMortarFraction,
    },
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
  if (override.minimumStone) {
    assertPlainObject(override.minimumStone, `${label}.minimumStone`);
    assertNoUnknownKeys(override.minimumStone, ALLOWED_MINIMUM_STONE, `${label}.minimumStone`);
  }
  if (override.bevel) {
    assertPlainObject(override.bevel, `${label}.bevel`);
    assertNoUnknownKeys(override.bevel, ALLOWED_BEVEL, `${label}.bevel`);
    if (override.bevel.widthRatio) {
      validateRatio(override.bevel.widthRatio, `${label}.bevel.widthRatio`, 0, 0.4);
    }
    if (override.bevel.depthRatio) {
      validateRatio(override.bevel.depthRatio, `${label}.bevel.depthRatio`, 0, 0.4);
    }
  }
  if (override.cornerVariation) {
    assertPlainObject(override.cornerVariation, `${label}.cornerVariation`);
    assertNoUnknownKeys(override.cornerVariation, ALLOWED_CORNER_VARIATION, `${label}.cornerVariation`);
  }
  if (override.edgeVariation) {
    assertPlainObject(override.edgeVariation, `${label}.edgeVariation`);
    assertNoUnknownKeys(override.edgeVariation, ALLOWED_EDGE_VARIATION, `${label}.edgeVariation`);
  }
  if (override.verticalBias) {
    assertPlainObject(override.verticalBias, `${label}.verticalBias`);
    assertNoUnknownKeys(override.verticalBias, ALLOWED_VERTICAL_BIAS, `${label}.verticalBias`);
  }
  if (override.cornerFlattening) {
    assertPlainObject(override.cornerFlattening, `${label}.cornerFlattening`);
    assertNoUnknownKeys(override.cornerFlattening, ALLOWED_FLATTENING, `${label}.cornerFlattening`);
  }
  if (override.segments) {
    assertPlainObject(override.segments, `${label}.segments`);
    assertNoUnknownKeys(override.segments, ALLOWED_SEGMENTS, `${label}.segments`);
  }
  if (override.safeguards) {
    assertPlainObject(override.safeguards, `${label}.safeguards`);
    assertNoUnknownKeys(override.safeguards, ALLOWED_SAFEGUARDS, `${label}.safeguards`);
  }
  if (override.categories) {
    assertPlainObject(override.categories, `${label}.categories`);
    assertNoUnknownKeys(override.categories, ALLOWED_CATEGORIES, `${label}.categories`);
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
    if (typeof key !== 'string' || !/^[a-z][a-z0-9-]*$/.test(key)) {
      fail(`styles.${key} is not a valid style name.`);
    }
    validatePartialOverride(override, `styles.${key}`);
    validateProfile(mergeDeep(document.defaults, override), `styles.${key}`);
  }
  return document;
}

function freezeRatio(range) {
  return `Object.freeze({ min: ${range.min}, max: ${range.max} })`;
}

function freezeProfile(profile, indent = '') {
  const inner = `${indent}  `;
  return [
    'Object.freeze({',
    `${inner}enabled: ${profile.enabled},`,
    `${inner}minimumStone: Object.freeze({ width: ${profile.minimumStone.width}, height: ${profile.minimumStone.height}, depth: ${profile.minimumStone.depth} }),`,
    `${inner}bevel: Object.freeze({`,
    `${inner}  widthRatio: ${freezeRatio(profile.bevel.widthRatio)},`,
    `${inner}  depthRatio: ${freezeRatio(profile.bevel.depthRatio)},`,
    `${inner}  absoluteMinimum: ${profile.bevel.absoluteMinimum},`,
    `${inner}  absoluteMaximum: ${profile.bevel.absoluteMaximum},`,
    `${inner}}),`,
    `${inner}cornerVariation: Object.freeze({ amount: ${profile.cornerVariation.amount}, correlation: ${profile.cornerVariation.correlation} }),`,
    `${inner}edgeVariation: Object.freeze({ amount: ${profile.edgeVariation.amount}, midpointBias: ${profile.edgeVariation.midpointBias} }),`,
    `${inner}verticalBias: Object.freeze({ top: ${profile.verticalBias.top}, bottom: ${profile.verticalBias.bottom} }),`,
    `${inner}cornerFlattening: Object.freeze({ chance: ${profile.cornerFlattening.chance}, strengthMin: ${profile.cornerFlattening.strengthMin}, strengthMax: ${profile.cornerFlattening.strengthMax} }),`,
    `${inner}segments: Object.freeze({ near: ${profile.segments.near}, coarse: ${profile.segments.coarse} }),`,
    `${inner}safeguards: Object.freeze({`,
    `${inner}  minimumFaceAreaRatio: ${profile.safeguards.minimumFaceAreaRatio},`,
    `${inner}  minimumEdgeLength: ${profile.safeguards.minimumEdgeLength},`,
    `${inner}  maximumInsetEdgeRatio: ${profile.safeguards.maximumInsetEdgeRatio},`,
    `${inner}  maximumDepthFraction: ${profile.safeguards.maximumDepthFraction},`,
    `${inner}  maximumMortarFraction: ${profile.safeguards.maximumMortarFraction},`,
    `${inner}}),`,
    `${inner}categories: Object.freeze({`,
    `${inner}  field: ${profile.categories.field},`,
    `${inner}  coping: ${profile.categories.coping},`,
    `${inner}  ashlar: ${profile.categories.ashlar},`,
    `${inner}  quoin: ${profile.categories.quoin},`,
    `${inner}  voussoir: ${profile.categories.voussoir},`,
    `${inner}  merlon: ${profile.categories.merlon},`,
    `${inner}  recess: ${profile.categories.recess},`,
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
    '/* Generated by tools/generate-construction-stone-edge-wear.mjs — do not edit. */',
    '',
    'export const CONSTRUCTION_STONE_EDGE_WEAR_PROFILES = Object.freeze({',
    `  default: ${freezeProfile(defaults, '  ')},`,
    ...styleEntries,
    '});',
    '',
    'export function constructionStoneEdgeWearProfile(styleKey) {',
    '  return CONSTRUCTION_STONE_EDGE_WEAR_PROFILES[styleKey]',
    '    ?? CONSTRUCTION_STONE_EDGE_WEAR_PROFILES.default;',
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
    console.error('ConstructionStoneEdgeWearProfiles.generated.js is out of date. Run:');
    console.error('  node tools/generate-construction-stone-edge-wear.mjs');
    process.exit(1);
  }
  console.log('ConstructionStoneEdgeWearProfiles.generated.js is up to date.');
  process.exit(0);
}

writeFileSync(OUT_PATH, source);
console.log(`Wrote ${OUT_PATH}`);
