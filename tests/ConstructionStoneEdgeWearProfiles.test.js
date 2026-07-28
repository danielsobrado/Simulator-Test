import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_STONE_EDGE_WEAR_PROFILES,
  constructionStoneEdgeWearProfile,
} from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = join(ROOT, 'tools/generate-construction-stone-edge-wear.mjs');
const YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-edge-wear.yml');

function runGenerator(args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('generated config matches YAML and soft limestone is enabled', () => {
  const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
  const soft = constructionStoneEdgeWearProfile('soft-limestone-rubble');
  assert.equal(soft.enabled, true);
  assert.equal(soft.bevel.widthRatio.min, document.styles['soft-limestone-rubble'].bevel.widthRatio.min);
  assert.equal(soft.cornerVariation.amount, document.styles['soft-limestone-rubble'].cornerVariation.amount);
  assert.equal(constructionStoneEdgeWearProfile('coursed-rubble').enabled, false);
  assert.equal(Object.isFrozen(CONSTRUCTION_STONE_EDGE_WEAR_PROFILES), true);
  assert.equal(Object.isFrozen(soft.bevel), true);
});

test('generator --check passes for checked-in output', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('unknown fields are rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edge-wear-'));
  try {
    const path = join(dir, 'stone-edge-wear.yml');
    const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
    document.defaults.cornerVariaton = { amount: 0.1, correlation: 0.5 };
    writeFileSync(path, yaml.dump(document));
    const result = runGenerator(['--yaml', path, '--out', join(dir, 'out.js')]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /unknown key "cornerVariaton"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
