import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CONSTRUCTION_STONE_LOD_PROFILES,
  constructionStoneLodProfile,
} from '../src/editor/construction/config/ConstructionStoneLodProfiles.generated.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const YAML_PATH = join(ROOT, 'src/editor/construction/config/stone-geometry-lod.yml');
const GENERATOR = join(ROOT, 'tools/generate-construction-stone-lod.mjs');

function runGenerator(args = []) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

test('generated soft-limestone lod profile matches YAML', () => {
  const document = yaml.load(readFileSync(YAML_PATH, 'utf8'));
  const profile = constructionStoneLodProfile('soft-limestone-rubble');
  assert.equal(profile.near.mode, 'soft');
  assert.equal(profile.coarse.mode, 'soft-coarse');
  assert.equal(profile.coarse.faceGrid.columns, 1);
  assert.equal(profile.coarse.bevelRings, 1);
  assert.equal(profile.coarse.reliefAmplitudeScale, 0.55);
  assert.equal(profile.transition.minimumResidenceMs, 650);
  assert.equal(
    profile.coarse.edgeVariationScale,
    document.styles['soft-limestone-rubble'].coarse.edgeVariationScale,
  );
});

test('unknown style falls back to default legacy profile', () => {
  const profile = constructionStoneLodProfile('missing-style');
  assert.equal(profile, CONSTRUCTION_STONE_LOD_PROFILES.default);
  assert.equal(profile.near.mode, 'legacy');
  assert.equal(profile.coarse.mode, 'legacy');
});

test('generator rejects invalid mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stone-lod-'));
  try {
    const path = join(dir, 'bad.yml');
    writeFileSync(path, yaml.dump({
      version: 1,
      defaults: {
        near: {
          mode: 'fancy',
          faceGrid: { columns: 0, rows: 0 },
          bevelRings: 1,
          edgeMidpoints: false,
          cornerFlattening: false,
          reliefAmplitudeScale: 0,
          edgeVariationScale: 0,
        },
        coarse: {
          mode: 'legacy',
          faceGrid: { columns: 0, rows: 0 },
          bevelRings: 1,
          edgeMidpoints: false,
          cornerFlattening: false,
          reliefAmplitudeScale: 0,
          edgeVariationScale: 0,
        },
        transition: {
          hysteresisMetres: 6,
          minimumResidenceMs: 500,
          crossfade: {
            enabled: false,
            durationMs: 220,
            ditherScale: 1,
            maximumConcurrentModules: 4,
          },
        },
      },
      styles: {},
    }));
    const result = runGenerator(['--yaml', path, '--out', join(dir, 'out.js')]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /mode/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generator --check passes for committed output', () => {
  const result = runGenerator(['--check']);
  assert.equal(result.status, 0, result.stderr);
});
