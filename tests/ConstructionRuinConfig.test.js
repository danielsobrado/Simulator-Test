import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_RUIN_PROFILES,
  constructionRuinProfile,
} from '../src/editor/construction/config/ConstructionRuinConfig.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = join(ROOT, 'tools/generate-construction-ruin-config.mjs');

test('soft limestone ruin profile merges cluster overrides', () => {
  const profile = constructionRuinProfile('soft-limestone-rubble');
  assert.equal(profile.damage.cluster.wavelength, 2.8);
  assert.equal(profile.support.minimumOverlapRatio, 0.36);
  assert.equal(profile.macro.wavelength, 6.3);
});

test('unknown style falls back to default', () => {
  assert.equal(constructionRuinProfile('missing'), CONSTRUCTION_RUIN_PROFILES.default);
});

test('generator --check passes', () => {
  const result = spawnSync(process.execPath, [GENERATOR, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('generator rejects preferredWidth below minimumWidth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ruin-cfg-'));
  try {
    const document = yaml.load(readFileSync(
      join(ROOT, 'src/editor/construction/config/ruin-masonry.yml'),
      'utf8',
    ));
    document.defaults.damage.cluster.preferredWidth = 0.1;
    document.defaults.damage.cluster.minimumWidth = 0.9;
    const path = join(dir, 'bad.yml');
    writeFileSync(path, yaml.dump(document));
    const result = spawnSync(process.execPath, [
      GENERATOR, '--yaml', path, '--out', join(dir, 'out.js'),
    ], { cwd: ROOT, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /preferredWidth/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
