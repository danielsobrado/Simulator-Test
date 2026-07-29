import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePerfMatrix } from '../scripts/perf-matrix-gates.mjs';

function report(id, densityProfile, {
  treesPerChunk = 24,
  candidateBudgetPerChunk = 64,
  maxAcceptedPerChunk = 32,
  bladesPerCell = 576,
  constructionModulesResident = 0,
  constructionStones = 0,
  p95Ms = 12,
  hitchRate = 0.005,
  webgpu = 1,
  webgl = 0,
} = {}) {
  return {
    scenario: { id: id === 'construction-ring' ? id : 'diagonal', densityProfile },
    summary: { frameCount: 100, hitchRate, dt: { p95Ms } },
    collision: { gate: { passed: true } },
    counters: {
      rendererWebGPUBackend: webgpu,
      rendererWebGLBackend: webgl,
      constructionModulesResident,
      constructionStones,
    },
    density: {
      treesPerChunk,
      candidateBudgetPerChunk,
      maxAcceptedPerChunk,
      bladesPerCell,
    },
  };
}

function passingMatrix() {
  return {
    cases: [
      { id: 'standard', execution: { code: 0 }, report: report('standard', 'standard') },
      {
        id: 'dense-forest',
        execution: { code: 0 },
        report: report('dense-forest', 'dense-forest', {
          treesPerChunk: 48,
          candidateBudgetPerChunk: 128,
          maxAcceptedPerChunk: 64,
        }),
      },
      {
        id: 'high-grass',
        execution: { code: 0 },
        report: report('high-grass', 'high-grass', { bladesPerCell: 1152 }),
      },
      {
        id: 'dense-mixed',
        execution: { code: 0 },
        report: report('dense-mixed', 'dense-mixed', {
          treesPerChunk: 48,
          candidateBudgetPerChunk: 128,
          maxAcceptedPerChunk: 64,
          bladesPerCell: 1152,
        }),
      },
      {
        id: 'construction-ring',
        execution: { code: 0 },
        report: report('construction-ring', 'standard', {
          constructionModulesResident: 96,
          constructionStones: 551,
        }),
      },
    ],
    water: {
      execution: { code: 0 },
      report: report('water-acceptance', 'standard'),
      acceptance: { pass: true },
    },
  };
}

test('performance matrix gate proves workload activation and portable frame budgets', () => {
  const result = evaluatePerfMatrix(passingMatrix());
  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
});

test('performance matrix gate rejects inactive density, construction, water, and WebGPU cases', () => {
  const matrix = passingMatrix();
  matrix.cases.find(({ id }) => id === 'dense-forest').report.density.treesPerChunk = 24;
  matrix.cases.find(({ id }) => id === 'high-grass').report.summary.dt.p95Ms = 40;
  const construction = matrix.cases.find(({ id }) => id === 'construction-ring').report;
  construction.counters.constructionModulesResident = 0;
  construction.counters.rendererWebGPUBackend = 0;
  construction.counters.rendererWebGLBackend = 1;
  matrix.cases.find(({ id }) => id === 'dense-mixed').report.summary.hitchRate = null;
  matrix.water.acceptance.pass = false;

  const result = evaluatePerfMatrix(matrix);

  assert.equal(result.passed, false);
  assert.ok(result.failures.some((failure) => failure.includes('dense-forest')));
  assert.ok(result.failures.some((failure) => failure.includes('high-grass')));
  assert.ok(result.failures.some((failure) => failure.includes('construction-ring')));
  assert.ok(result.failures.some((failure) => failure.includes('water acceptance')));
});
