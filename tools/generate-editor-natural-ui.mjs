#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML_PATH = join(ROOT, 'config/editor-natural-ui.yaml');
const OUT_PATH = join(ROOT, 'src/editor/ui/NaturalEditorUiConfig.generated.js');
const ROOT_KEYS = new Set([
  'version',
  'storage',
  'limits',
  'motion',
  'playerSettings',
  'primaryTools',
  'buildActions',
  'worldActions',
  'hints',
]);

function fail(message) {
  throw new Error(`editor-natural-ui.yaml: ${message}`);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) fail(`${label} must be a positive integer.`);
  return value;
}

function validateUniqueItems(items, label) {
  if (!Array.isArray(items) || items.length === 0) fail(`${label} must be a non-empty array.`);
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    plainObject(item, `${label}[${index}]`);
    const id = nonEmptyString(item.id, `${label}[${index}].id`);
    nonEmptyString(item.label, `${label}[${index}].label`);
    if (ids.has(id)) fail(`${label} contains duplicate id ${id}.`);
    ids.add(id);
  }
}

function validate(source) {
  plainObject(source, 'root');
  for (const key of Object.keys(source)) {
    if (!ROOT_KEYS.has(key)) fail(`unknown root key ${key}.`);
  }
  if (source.version !== 1) fail('version must be 1.');

  const storage = plainObject(source.storage, 'storage');
  for (const key of ['favoritesKey', 'recentKey', 'hintKey', 'reducedMotionKey']) {
    nonEmptyString(storage[key], `storage.${key}`);
  }

  const limits = plainObject(source.limits, 'limits');
  positiveInteger(limits.recentObjects, 'limits.recentObjects');
  positiveInteger(limits.favoriteObjects, 'limits.favoriteObjects');

  const motion = plainObject(source.motion, 'motion');
  for (const key of ['panelMs', 'toolbarMs', 'hintDurationMs']) positiveInteger(motion[key], `motion.${key}`);

  const playerSettings = plainObject(source.playerSettings, 'playerSettings');
  nonEmptyString(playerSettings.reducedMotionClass, 'playerSettings.reducedMotionClass');

  validateUniqueItems(source.primaryTools, 'primaryTools');
  validateUniqueItems(source.buildActions, 'buildActions');
  validateUniqueItems(source.worldActions, 'worldActions');

  const hints = plainObject(source.hints, 'hints');
  for (const key of ['firstRun', 'terrain', 'build']) nonEmptyString(hints[key], `hints.${key}`);
  return source;
}

function render(source) {
  return `// Generated from config/editor-natural-ui.yaml.\n`
    + `function deepFreeze(value) {\n`
    + `  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n`
    + `  for (const child of Object.values(value)) deepFreeze(child);\n`
    + `  return Object.freeze(value);\n`
    + `}\n\n`
    + `export const NATURAL_EDITOR_UI_CONFIG = deepFreeze(${JSON.stringify(source, null, 2)});\n`;
}

const source = validate(yaml.load(readFileSync(YAML_PATH, 'utf8')));
const output = render(source);
if (process.argv.includes('--check')) {
  const current = readFileSync(OUT_PATH, 'utf8');
  if (current !== output) {
    console.error('Natural editor UI generated config is stale.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(OUT_PATH, output);
  console.log(`Wrote ${OUT_PATH}`);
}
