import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCollisionAcceptanceConfig,
  validateCollisionAcceptanceConfig,
} from '../scripts/lib/collisionAcceptanceConfig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_RELEASE_COVERAGE = Object.freeze([
  'open-ground-run',
  'dense-forest-run',
  'scree-field-traversal',
  'walkable-rock-climb-loop',
  'dense-object-town',
  'long-curved-wall-traversal',
  'repeated-collision-chunk-crossing',
  'controlled-collision-frame-ab',
  'floating-origin-rebase-during-movement',
  'construction-edit-rebuild-nearby',
  'collision-unload-reload-cycle',
  'long-soak-10m',
]);

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
        warmupSeconds: 1,
        durationSeconds: 2,
        speed: 'run',
        minimumCounts: {},
        minimumProviderComponents: {},
        coverage: ['open-ground-run'],
      },
    ],
  };
}

test('repository collision acceptance config is valid and keeps release coverage explicit', () => {
  const config = loadCollisionAcceptanceConfig(
    path.join(root, 'config', 'collision-acceptance.yaml'),
  );
  const baseline = config.cases.find((entry) => entry.id === config.baselineCase);
  const tree = config.cases.find((entry) => entry.id === 'production-tree-trunk');
  const blockingRock = config.cases.find((entry) => entry.id === 'production-blocking-rock');
  const walkableRock = config.cases.find((entry) => entry.id === 'walkable-rock-bvh');
  const object = config.cases.find((entry) => entry.id === 'placed-object-doorway');
  const construction = config.cases.find((entry) => entry.id === 'construction-wall');

  assert.equal(config.version, 1);
  assert.equal(config.repeats, 3);
  assert.equal(config.baselineCase, 'open-ground-baseline');
  assert.deepEqual(config.viewport, { width: 1600, height: 900, deviceScaleFactor: 1 });
  assert.equal(baseline.collisionRequired, false);
  assert.deepEqual(baseline.minimumCounts, {});
  assert.deepEqual(baseline.minimumProviderComponents, {});
  assert.deepEqual(tree.minimumProviderComponents, { trees: { colliders: 1 } });
  assert.deepEqual(blockingRock.minimumProviderComponents, { rocks: { blocking: 1 } });
  assert.deepEqual(walkableRock.minimumProviderComponents, { rocks: { walkable: 1 } });
  assert.deepEqual(object.minimumProviderComponents, { objects: { colliders: 1 } });
  assert.deepEqual(construction.minimumProviderComponents, { constructions: { colliders: 1 } });
  assert.equal(new Set(config.cases.map((entry) => entry.id)).size, config.cases.length);
  assert.deepEqual(config.requiredCoverage, REQUIRED_RELEASE_COVERAGE);
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

test('config validation rejects unknown provider components and metrics', () => {
  const unknownComponent = validConfig();
  unknownComponent.cases[0].minimumProviderComponents = { wildlife: { colliders: 1 } };
  assert.throws(
    () => validateCollisionAcceptanceConfig(unknownComponent),
    /not a supported collision provider component/,
  );

  const unknownMetric = validConfig();
  unknownMetric.cases[0].minimumProviderComponents = { trees: { leaves: 1 } };
  assert.throws(
    () => validateCollisionAcceptanceConfig(unknownMetric),
    /not a supported provider metric/,
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
