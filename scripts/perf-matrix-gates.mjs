export const PERF_MATRIX_MAX_P95_MS = 33.3;
export const PERF_MATRIX_MAX_HITCH_RATE = 0.02;

const REQUIRED_CASES = Object.freeze([
  'standard',
  'dense-forest',
  'high-grass',
  'dense-mixed',
  'construction-ring',
]);

function finite(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
}

function addCaseFailures(entry, failures) {
  const report = entry?.report;
  const label = entry?.id ?? 'unknown';
  if (!entry || entry.execution?.code !== 0 || !report) {
    failures.push(`${label}: runner did not produce a successful report`);
    return;
  }
  if (report.counters?.rendererWebGPUBackend !== 1
    || report.counters?.rendererWebGLBackend !== 0) {
    failures.push(`${label}: renderer was not exclusively WebGPU`);
  }
  if (!finite(report.summary?.frameCount) || report.summary.frameCount <= 0) {
    failures.push(`${label}: no measured frames`);
  }
  if (!finite(report.summary?.dt?.p95Ms)
    || report.summary.dt.p95Ms > PERF_MATRIX_MAX_P95_MS) {
    failures.push(
      `${label}: p95 ${report.summary?.dt?.p95Ms ?? 'missing'} ms exceeds `
      + `${PERF_MATRIX_MAX_P95_MS} ms`,
    );
  }
  if (!finite(report.summary?.hitchRate)
    || report.summary.hitchRate > PERF_MATRIX_MAX_HITCH_RATE) {
    failures.push(
      `${label}: hitch rate ${report.summary?.hitchRate ?? 'missing'} exceeds `
      + PERF_MATRIX_MAX_HITCH_RATE,
    );
  }
  if (report.collision?.gate?.passed !== true) {
    failures.push(`${label}: collision performance gate failed`);
  }
}

function expectMultiplier(entry, baseline, property, multiplier, failures) {
  const actual = entry?.report?.density?.[property];
  const base = baseline?.report?.density?.[property];
  if (!finite(actual) || !finite(base) || actual !== base * multiplier) {
    failures.push(
      `${entry?.id ?? 'unknown'}: ${property} ${actual ?? 'missing'} `
      + `did not equal standard ${base ?? 'missing'} × ${multiplier}`,
    );
  }
}

export function evaluatePerfMatrix(
  { cases = [], water = null } = {},
  { requireCases = true, requireWater = true } = {},
) {
  const failures = [];
  const caseMap = new Map(cases.map((entry) => [entry.id, entry]));

  if (requireCases) {
    for (const id of REQUIRED_CASES) {
      const entry = caseMap.get(id);
      if (!entry) {
        failures.push(`${id}: required matrix case is missing`);
        continue;
      }
      addCaseFailures(entry, failures);
      const expectedProfile = id === 'construction-ring' ? 'standard' : id;
      if (entry.report?.scenario?.densityProfile !== expectedProfile) {
        failures.push(
          `${id}: reported density ${entry.report?.scenario?.densityProfile ?? 'missing'} `
          + `instead of ${expectedProfile}`,
        );
      }
    }

    const standard = caseMap.get('standard');
    const denseForest = caseMap.get('dense-forest');
    const highGrass = caseMap.get('high-grass');
    const denseMixed = caseMap.get('dense-mixed');
    for (const entry of [denseForest, denseMixed]) {
      expectMultiplier(entry, standard, 'treesPerChunk', 2, failures);
      expectMultiplier(entry, standard, 'candidateBudgetPerChunk', 2, failures);
      expectMultiplier(entry, standard, 'maxAcceptedPerChunk', 2, failures);
    }
    for (const entry of [highGrass, denseMixed]) {
      expectMultiplier(entry, standard, 'bladesPerCell', 2, failures);
    }

    const construction = caseMap.get('construction-ring')?.report?.counters;
    if (!finite(construction?.constructionModulesResident)
      || construction.constructionModulesResident < 12) {
      failures.push('construction-ring: fewer than 12 wall modules were resident');
    }
    if (!finite(construction?.constructionStones) || construction.constructionStones <= 0) {
      failures.push('construction-ring: no masonry stones were resident');
    }
  }

  if (requireWater) {
    if (water?.execution?.code !== 0 || !water?.report) {
      failures.push('water acceptance: runner did not produce a successful report');
    } else {
      addCaseFailures({ id: 'water-acceptance', ...water }, failures);
      if (water.acceptance?.pass !== true) {
        failures.push('water acceptance: behavioral gates failed');
      }
    }
  }

  return Object.freeze({
    passed: failures.length === 0,
    maximumP95Ms: PERF_MATRIX_MAX_P95_MS,
    maximumHitchRate: PERF_MATRIX_MAX_HITCH_RATE,
    failures: Object.freeze(failures),
  });
}
