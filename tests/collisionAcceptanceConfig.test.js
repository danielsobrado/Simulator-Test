import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCollisionAcceptanceConfig,
  validateCollisionAcceptanceConfig,
} from '../scripts/lib/collisionAcceptanceConfig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function validConfig() {
  return {
    version: 1,
    repeats: 2,
    baselineCase: 'baseline',
    hitchMs: 33.3,
    timeoutPaddingSeconds: 30,
    viewport: {
      width: 1600,
      height: 900,
      deviceScaleFactor: 1,
    },
    gates: {
      collisionP95Ms: 0.83,
      frameP95RegressionMs: 0.83,
      maxHitches: 0,
      maxReadinessMisses: 0,
      maxFailedChunks: 0,
      maxFinalQueueDepth: 0,
      requireCanonicalSignature: true,
      requireConsistentAdapter: true,
    },
    requiredCoverage: ['open-ground-run'],
    cases: [
      {
        id: 'baseline',
        label: 'Baseline',
        scenario: 'move',
        collisionRequired: false,
        compareFrameToBaseline: false,
        warmupSeconds: 1,
        durationSeconds: 2,
        speed: 'run',
        minimumCounts: {},
        coverage: ['open-ground-run'],
      },
    ],
  };
}

test('repository collision acceptance config is valid and keeps baseline collision disabled', () => {
  const config = loadCollisionAcceptanceConfig(
    path.join(root, 'config', 'collision-acceptance.yaml'),
  );
  const baseline = config.cases.find((entry) => entry.id === config.baselineCase);

  assert.equal(config.version, 1);
  assert.equal(config.repeats, 3);
  assert.equal(config.baselineCase, 'open-ground-baseline');
  assert.deepEqual(config.viewport, { width: 1600, height: 900, deviceScaleFactor: 1 });
  assert.equal(baseline.collisionRequired, false);
  assert.equal(baseline.compareFrameToBaseline, false);
  assert.deepEqual(baseline.minimumCounts, {});
  assert.equal(new Set(config.cases.map((entry) => entry.id)).size, config.cases.length);
});

test('config validation rejects duplicate case IDs', () => {
  const config = validConfig();
  config.cases.push({ ...config.cases[0] });
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /case IDs must be unique/,
  );
});

test('config validation rejects path-like case IDs', () => {
  const config = validConfig();
  config.cases[0].id = '../escape';
  config.baselineCase = '../escape';
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /lowercase letters, digits, and hyphens/,
  );
});

test('config validation rejects a collision-enabled baseline', () => {
  const config = validConfig();
  config.cases[0].collisionRequired = true;
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /baselineCase must not require collision/,
  );
});

test('config validation rejects a baseline compared to itself', () => {
  const config = validConfig();
  config.cases[0].compareFrameToBaseline = true;
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /cannot compare its frame time to itself/,
  );
});

test('comparable cases must match the baseline movement route', () => {
  const config = validConfig();
  config.cases.push({
    ...config.cases[0],
    id: 'collision-route',
    label: 'Collision route',
    scenario: 'collision-p8',
    collisionRequired: true,
    compareFrameToBaseline: true,
    durationSeconds: 3,
  });
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /must match the baseline movement route and duration/,
  );
});

test('config validation rejects unsupported movement speeds', () => {
  const config = validConfig();
  config.cases[0].speed = 'sprint';
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /must be walk or run/,
  );
});

test('config validation rejects unknown minimum-count fields', () => {
  const config = validConfig();
  config.cases[0].minimumCounts = { mysteryQueries: 1 };
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /not a supported collision count/,
  );
});

test('config validation rejects an undersized capture viewport', () => {
  const config = validConfig();
  config.viewport.width = 200;
  assert.throws(
    () => validateCollisionAcceptanceConfig(config),
    /viewport.width/,
  );
});
