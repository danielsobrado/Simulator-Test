import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCollisionAcceptanceConfig } from '../scripts/lib/collisionAcceptanceConfig.mjs';
import {
  buildCollisionAcceptanceReport,
  renderCollisionAcceptanceMarkdown,
} from '../scripts/lib/collisionAcceptanceReport.mjs';

const ADAPTER = Object.freeze({
  ok: true,
  vendor: 'test-vendor',
  architecture: 'test-gpu',
  description: 'Test GPU',
  fallback: false,
});

function config({
  requiredCoverage = ['baseline', 'collision'],
  compareCollisionToBaseline = true,
} = {}) {
  return validateCollisionAcceptanceConfig({
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
    requiredCoverage,
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
        coverage: ['baseline'],
      },
      {
        id: 'collision',
        label: 'Collision',
        scenario: 'collision-p8',
        collisionRequired: true,
        compareFrameToBaseline: compareCollisionToBaseline,
        warmupSeconds: 1,
        durationSeconds: 2,
        speed: 'run',
        minimumCounts: {
          broadphaseQueries: 1,
          candidates: 1,
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
  collisionP95Ms = 0,
  adapter = ADAPTER,
  debugEnabled = false,
  hitches = 0,
  broadphaseQueries = 10,
  candidates = 20,
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
      timingsMs: { total: { p95Ms: collisionP95Ms } },
      counts: {
        broadphaseQueries,
        candidates,
        readinessMisses,
        failedChunks,
        finalQueueDepth,
      },
      readiness: { ready, failure },
      canonicalSignature: collisionEnabled ? 'abc123' : null,
      gate: {
        passed: !collisionEnabled || (
          collisionP95Ms <= 0.83
          && ready
          && failure === null
        ),
      },
    },
  };
}

function passingRuns(options = {}) {
  return [
    {
      caseId: 'baseline',
      repeat: 1,
      reportPath: 'baseline-1.json',
      report: perfReport({
        scenario: 'move',
        collisionEnabled: false,
        frameP95Ms: 5,
        ...options.baseline,
      }),
    },
    {
      caseId: 'baseline',
      repeat: 2,
      reportPath: 'baseline-2.json',
      report: perfReport({
        scenario: 'move',
        collisionEnabled: false,
        frameP95Ms: 5.2,
        ...options.baseline,
      }),
    },
    {
      caseId: 'collision',
      repeat: 1,
      reportPath: 'collision-1.json',
      report: perfReport({
        scenario: 'collision-p8',
        collisionEnabled: true,
        frameP95Ms: 5.4,
        collisionP95Ms: 0.5,
        ...options.collision,
      }),
    },
    {
      caseId: 'collision',
      repeat: 2,
      reportPath: 'collision-2.json',
      report: perfReport({
        scenario: 'collision-p8',
        collisionEnabled: true,
        frameP95Ms: 5.5,
        collisionP95Ms: 0.6,
        ...options.collision,
      }),
    },
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
  assert.equal(report.baseline.frameP95MedianMs, 5.1);
  assert.equal(report.cases.find((entry) => entry.id === 'collision').collisionP95MaxMs, 0.6);
  assert.match(renderCollisionAcceptanceMarkdown(report), /Release gate: \*\*PASS\*\*/);
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

test('frame regression and inconsistent hardware fail execution', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns({
      collision: {
        frameP95Ms: 7,
        adapter: { ...ADAPTER, architecture: 'other-gpu' },
      },
    }),
  });

  assert.equal(report.adapters.consistent, false);
  assert.equal(report.gates.execution.passed, false);
  assert.equal(report.gates.release.passed, false);
  assert.equal(
    report.cases.find((entry) => entry.id === 'collision').checks
      .find((entry) => entry.id === 'frame-p95-regression').passed,
    false,
  );
});

test('comparable captures fail when collision debug rendering is enabled', () => {
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

test('non-comparable fixtures do not use the open-ground frame or debug gate', () => {
  const report = buildCollisionAcceptanceReport({
    config: config({ compareCollisionToBaseline: false }),
    runs: passingRuns({ collision: { frameP95Ms: 20, debugEnabled: true } }),
  });
  const collisionCase = report.cases.find((entry) => entry.id === 'collision');

  assert.equal(collisionCase.frameP95RegressionMs, null);
  assert.equal(
    collisionCase.checks.some((entry) => entry.id === 'frame-p95-regression'),
    false,
  );
  assert.equal(
    collisionCase.runs[0].checks.some((entry) => entry.id === 'production-debug-disabled'),
    false,
  );
  assert.equal(report.gates.execution.passed, true);
});

test('missing hardware evidence and zero query work fail the run', () => {
  const report = buildCollisionAcceptanceReport({
    config: config(),
    runs: passingRuns({
      collision: {
        adapter: null,
        broadphaseQueries: 0,
        candidates: 0,
      },
    }),
  });
  const run = report.cases.find((entry) => entry.id === 'collision').runs[0];

  assert.equal(run.passed, false);
  assert.equal(
    run.checks.find((entry) => entry.id === 'hardware-adapter').passed,
    false,
  );
  assert.equal(
    run.checks.find((entry) => entry.id === 'minimum-count:candidates').passed,
    false,
  );
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
