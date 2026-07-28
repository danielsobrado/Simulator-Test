import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_STONE_RELIEF_PROFILES,
  constructionStoneReliefProfile,
} from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-face-relief.yml');
const GENERATED_PATH = join(
  ROOT,
  'src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js',
);
const GENERATOR = join(ROOT, 'tools/generate-construction-stone-relief.mjs');

function runGenerator(args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function writeTempYaml(document) {
  const dir = mkdtempSync(join(tmpdir(), 'stone-relief-'));
  const path = join(dir, 'stone-face-relief.yml');
  writeFileSync(path, yaml.dump(document));
  return { dir, path };
}

const validBase = {
  version: 1,
  defaults: {
    enabled: false,
    grid: { columns: 3, rows: 2 },
    minimumStone: { width: 0.32, height: 0.18 },
    recession: {
      ratioMin: 0.018,
      ratioMax: 0.04,
      minimum: 0.006,
      maximum: 0.022,
    },
    edgeFalloffPower: 1.65,
    asymmetry: 0.28,
    saddleStrength: 0.12,
    maximumBevelFraction: 0.45,
    maximumMortarRecessFraction: 0.5,
    categories: {
      field: 1,
      coping: 0,
      ashlar: 0,
      quoin: 0,
      voussoir: 0,
      merlon: 0,
      recess: 0,
    },
  },
  styles: {},
};

function assertGeneratorRejects(document, messagePart) {
  const { dir, path } = writeTempYaml(document);
  try {
    const result = runGenerator(['--yaml', path, '--out', join(dir, 'out.js')]);
    assert.notEqual(result.status, 0, 'generator should fail');
    const err = `${result.stderr || ''}${result.stdout || ''}`;
    assert.match(err, new RegExp(messagePart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('generated config matches YAML source values', () => {
  const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
  const defaults = constructionStoneReliefProfile('default');
  assert.equal(defaults.enabled, document.defaults.enabled);
  assert.equal(defaults.grid.columns, document.defaults.grid.columns);
  assert.equal(defaults.grid.rows, document.defaults.grid.rows);
  assert.equal(defaults.recession.ratioMin, document.defaults.recession.ratioMin);
  assert.equal(defaults.edgeFalloffPower, document.defaults.edgeFalloffPower);

  const soft = constructionStoneReliefProfile('soft-limestone-rubble');
  const softYaml = document.styles['soft-limestone-rubble'];
  assert.equal(soft.enabled, true);
  assert.equal(soft.recession.ratioMin, softYaml.recession.ratioMin);
  assert.equal(soft.recession.maximum, softYaml.recession.maximum);
  assert.equal(soft.edgeFalloffPower, softYaml.edgeFalloffPower);
  assert.equal(soft.asymmetry, softYaml.asymmetry);
  assert.equal(soft.saddleStrength, softYaml.saddleStrength);
});

test('generator --check passes for checked-in output', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('generator output is deterministic', () => {
  const first = runGenerator();
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const afterFirst = readFileSync(GENERATED_PATH, 'utf8');
  const second = runGenerator();
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(readFileSync(GENERATED_PATH, 'utf8'), afterFirst);
});

test('legacy styles fall back to disabled defaults', () => {
  const profile = constructionStoneReliefProfile('coursed-rubble');
  assert.equal(profile.enabled, false);
  assert.equal(profile, CONSTRUCTION_STONE_RELIEF_PROFILES.default);
});

test('soft-limestone-rubble resolves its override', () => {
  const profile = constructionStoneReliefProfile('soft-limestone-rubble');
  assert.equal(profile.enabled, true);
  assert.notEqual(profile, CONSTRUCTION_STONE_RELIEF_PROFILES.default);
});

test('generated objects are frozen', () => {
  assert.equal(Object.isFrozen(CONSTRUCTION_STONE_RELIEF_PROFILES), true);
  for (const profile of Object.values(CONSTRUCTION_STONE_RELIEF_PROFILES)) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.grid), true);
    assert.equal(Object.isFrozen(profile.minimumStone), true);
    assert.equal(Object.isFrozen(profile.recession), true);
    assert.equal(Object.isFrozen(profile.categories), true);
  }
});

test('unknown style keys fall back to default', () => {
  assert.equal(
    constructionStoneReliefProfile('does-not-exist'),
    CONSTRUCTION_STONE_RELIEF_PROFILES.default,
  );
});

test('unknown fields are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: { ...validBase.defaults, edgeFallofPower: 1.5 },
    },
    'unknown key "edgeFallofPower"',
  );
});

test('invalid grid size is rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        grid: { columns: 1, rows: 2 },
      },
    },
    'must be an integer between 2 and 6',
  );
});

test('recession maximum above 0.05 is rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        recession: {
          ...validBase.defaults.recession,
          maximum: 0.06,
        },
      },
    },
    'must be between 0 and 0.05',
  );
});

test('reversed recession ratios are rejected', () => {
  assertGeneratorRejects(
    {
      ...validBase,
      defaults: {
        ...validBase.defaults,
        recession: {
          ...validBase.defaults.recession,
          ratioMin: 0.04,
          ratioMax: 0.02,
        },
      },
    },
    'ratioMax must be >= ratioMin',
  );
});
