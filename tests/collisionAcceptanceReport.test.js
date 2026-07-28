import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCollisionAcceptanceConfig } from '../scripts/lib/collisionAcceptanceConfig.mjs';
import {
  buildCollisionAcceptanceReport,
  renderCollisionAcceptanceMarkdown,
} from '../scripts/lib/collisionAcceptanceReport.mjs';

const VIEWPORT = Object.freeze({
  width: 1600,
  height: 900,
  deviceScaleFactor: 1,
});
const WEBGPU_BACKEND = Object.freeze({ webgpu: true, webgl2: false, reason: null });
const ADAPTER = Object.freeze({
  ok: true,
  vendor: 'test-vendor',
  architecture: 'test-gpu',
  description: 'Test GPU',
  fallback: false,
});

function config({
  requiredCoverage = ['baseline', 'collision'],
  collisionP95Ms = 0.83,
} = {}) {
  return validateCollisionAcceptanceConfig({
    version: 1,
    repeats: 2,
    baselineCase: 'baseline',
    hitchMs: 33.3,
    timeoutPaddingSeconds: 30,
    viewport: VIEWPORT,
    gates: {
      collisionP95Ms,
      maxHitches: 0,
      maxReadinessMisses: 0,
      maxFailedChunks: 0,
      maxFinalQueueDepth: 0,
      requireCanonicalSignature: true,
      requireConsistentAdapter: true,
    },
    requiredCoverage,
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
        coverage: ['baseline'],
      },
      {
        id: 'collision',
        label: 'Collision',
        scenario: 'collision-p8',
        collisionRequired: true,
        warmupSeconds: 1,
        durationSeconds: 2,
        speed: 'run',
        minimumCounts: {
          broadphaseQueries: 1,
          candidates: 1,
        },
        minimumProviderComponents: {
          trees: { colliders: 1 },
        },
        coverage: ['collision'],
      },
    ],
  });
}

function perfReport({
  scenario,
  collisionEnabled,
  frameP95Ms,
  screenshotPath,
  collisionP95Ms = 0,
  collisionSamples = 120,
  canonicalSignature = collisionEnabled ? 'abc123' : null,
  adapter = ADAPTER,
  rendererBackend = WEBGPU_BACKEND,
  viewport = VIEWPORT,
  debugEnabled = false,
  hitches = 0,
  broadphaseQueries = 10,
  candidates = 20,
  treeColliders = 3,
  readinessMisses = 0,
  failedChunks = 0,
  finalQueueDepth = 0,
  ready = true,
  failure = null,
}) {
  return {
    scenario: { id: scenario },
    summary: {
      hitchCount: hitches,
      dt: { p95Ms: frameP95Ms, p99Ms: frameP95Ms },
    },
    adapter,
    capture: {
      viewport,
      rendererBackend,
      screenshot: screenshotPath,
    },
    config: {
      collision: {
        debug: {
          colliders: debugEnabled,
          broadphase: debugEnabled,
          contacts: false,
          support: false,
        },
      },
    },
    collision: {
      enabled: collisionEnabled,
      timingsMs: {
        total: {
          samples: collisionSamples,
          p95Ms: collisionP95Ms,
        },
      },
      counts: {
        broadphaseQueries,
        candidates,
        readinessMisses,
        failedChunks,
        finalQueueDepth,
      },
      readiness: {
        ready,
        failure,
      },
      provider: {
        components: {
          trees: { colliders: treeColliders },
        },
      },
      canonicalSignature,
      gate: {
        passed: !collisionEnabled || (
          collisionSamples > 0
          && collisionP95Ms <= 0.83
          && ready
          && failure === null
        ),
      },
    },
  };
}

function runEntry(caseId, repeat, reportOptions) {
  const reportPath = `${caseId}-${repeat}.json`;
  const screenshotPath = `${caseId}-${repeat}.png`;
  return {
    caseId,
    repeat,
    reportPath,
    screenshotPath,
    report: perfReport({ ...reportOptions, screenshotPath }),
  };
}

function passingRuns(options = {}) {
  return [
    runEntry('baseline', 1, {
      scenario: 'move',
      collisionEnabled: false,
      frameP95Ms: 5,
      ...options.baseline,
    }),
    runEntry('baseline', 2, {
      scenario: 'move',
      collisionEnabled: false,
      frameP95Ms: 5.2,
      ...options.baseline,
    }),
    runEntry('collision', 1, {
      scenario: 'collision-p8',
      collisionEnabled: true,
      frameP95Ms: 5.4,
      collisionP95Ms: 0.5,
      ...options.collision,
    }),
    runEntry('collision', 2, {
      scenario: 'collision-p8',
      collisionEnabled: true,
      frameP95Ms: 5.5,
      collisionP95Ms: 0.6,
      ...options.collision,
    }),
  ];
}

test('aggregate passes execution and release gates with complete evidence', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns(),
    generatedAt: '2026-07-28T00:00:00.000Z',
  });

  assert.equal(report.gates.execution.passed, true);
  assert.equal(report.gates.release.passed, true);
  assert.equal(report.coverage.complete, true);
  assert.equal(report.adapters.consistent, true);
  assert.deepEqual(report.config.viewport, VIEWPORT);
  assert.equal(report.baseline.frameP95MedianMs, 5.1);
  assert.equal(report.cases.find((entry) => entry.id === 'collision').collisionP95MaxMs, 0.6);
  assert.match(renderCollisionAcceptanceMarkdown(report), /Release gate: \*\*PASS\*\*/);
  assert.match(renderCollisionAcceptanceMarkdown(report), /collision-1\.png/);
});

test('missing plan coverage blocks release but not executable case evidence', () => {
  const report = buildCollisionAcceptanceReport({
    config: config({ requiredCoverage: ['baseline', 'collision', 'rebase'] }),
    runs: passingRuns(),
  });

  assert.equal(report.gates.execution.passed, true);
  assert.equal(report.gates.release.passed, false);
  assert.deepEqual(report.coverage.missing, ['rebase']);
});

test('inconsistent hardware fails execution', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns({
      collision: {
        adapter: { ...ADAPTER, architecture: 'other-gpu' },
      },
    }),
  });

  assert.equal(report.adapters.consistent, false);
  assert.equal(report.gates.execution.passed, false);
  assert.equal(report.gates.release.passed, false);
});

test('debug rendering fails production acceptance', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns({ collision: { debugEnabled: true } }),
  });
  const run = report.cases.find((entry) => entry.id === 'collision').runs[0];

  assert.equal(run.passed, false);
  assert.equal(
    run.checks.find((entry) => entry.id === 'production-debug-disabled').passed,
    false,
  );
  assert.equal(report.gates.execution.passed, false);
});

test('YAML threshold is authoritative over the in-app provisional gate', () => {
  const runs = passingRuns({ collision: { collisionP95Ms: 1 } });
  assert.equal(runs[2].report.collision.gate.passed, false);

  const report = buildCollisionAcceptanceReport({
    config: config({ collisionP95Ms: 1.1 }),
    runs,
  });
  const collisionRun = report.cases.find((entry) => entry.id === 'collision').runs[0];

  assert.equal(
    collisionRun.checks.find((entry) => entry.id === 'collision-p95').passed,
    true,
  );
  assert.equal(report.gates.execution.passed, true);
});

test('missing samples fail even when measured p95 is zero', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns({ collision: { collisionSamples: 0, collisionP95Ms: 0 } }),
  });
  const run = report.cases.find((entry) => entry.id === 'collision').runs[0];

  assert.equal(
    run.checks.find((entry) => entry.id === 'collision-samples').passed,
    false,
  );
  assert.equal(report.gates.execution.passed, false);
});

test('canonical signatures must be stable across repeats', () => {
  const runs = passingRuns();
  runs[3].report.collision.canonicalSignature = 'different-signature';
  const report = buildCollisionAcceptanceReport({ config: config(), runs });
  const collisionCase = report.cases.find((entry) => entry.id === 'collision');

  assert.equal(
    collisionCase.checks.find((entry) => entry.id === 'canonical-signature-stable').passed,
    false,
  );
  assert.equal(report.gates.execution.passed, false);
});

test('missing renderer, hardware, capture, query, and provider evidence fail the run', () => {
  const runs = passingRuns({
    collision: {
      adapter: { ok: true, vendor: '', architecture: '', description: '', fallback: false },
      rendererBackend: { webgpu: false, webgl2: true, reason: null },
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
      broadphaseQueries: 0,
      candidates: 0,
      treeColliders: 0,
    },
  });
  runs[2].report.capture.screenshot = null;
  const report = buildCollisionAcceptanceReport({ config: config(), runs });
  const run = report.cases.find((entry) => entry.id === 'collision').runs[0];

  assert.equal(run.passed, false);
  for (const id of [
    'hardware-adapter',
    'renderer-backend',
    'capture-viewport',
    'capture-screenshot',
    'minimum-count:candidates',
    'minimum-provider:trees.colliders',
  ]) {
    assert.equal(run.checks.find((entry) => entry.id === id).passed, false);
  }
  assert.equal(report.gates.execution.passed, false);
});

test('readiness misses and incomplete repeats fail the collision case', () => {
  const runs = passingRuns({ collision: { readinessMisses: 1 } });
  runs.pop();
  const report = buildCollisionAcceptanceReport({ config: config(), runs });
  const collisionCase = report.cases.find((entry) => entry.id === 'collision');

  assert.equal(collisionCase.passed, false);
  assert.equal(report.gates.execution.passed, false);
  assert.equal(
    collisionCase.checks.find((entry) => entry.id === 'repeat-count').passed,
    false,
  );
  assert.equal(
    collisionCase.runs[0].checks.find((entry) => entry.id === 'readiness-misses').passed,
    false,
  );
});
