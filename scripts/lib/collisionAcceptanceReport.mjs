function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function maximum(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 ? Math.max(...finite) : null;
}

function adapterIdentity(adapter) {
  if (!adapter || typeof adapter !== 'object') return null;
  return [adapter.vendor, adapter.architecture, adapter.description]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join('|');
}

function check(id, passed, actual, target = null) {
  return Object.freeze({ id, passed: Boolean(passed), actual, target });
}

function count(report, name) {
  const value = report?.collision?.counts?.[name];
  return Number.isFinite(value) ? value : null;
}

function runChecks(config, caseConfig, run) {
  const report = run.report ?? null;
  const collision = report?.collision ?? null;
  const checks = [
    check('report-present', report !== null, report !== null, true),
    check(
      'scenario-match',
      report?.scenario?.id === caseConfig.scenario,
      report?.scenario?.id ?? null,
      caseConfig.scenario,
    ),
    check(
      'collision-mode',
      caseConfig.collisionRequired
        ? collision?.enabled === true
        : collision?.enabled !== true,
      collision?.enabled ?? null,
      caseConfig.collisionRequired,
    ),
    check(
      'hitches',
      Number.isFinite(report?.summary?.hitchCount)
        && report.summary.hitchCount <= config.gates.maxHitches,
      report?.summary?.hitchCount ?? null,
      config.gates.maxHitches,
    ),
  ];

  if (caseConfig.collisionRequired) {
    checks.push(
      check('collision-gate', collision?.gate?.passed === true, collision?.gate?.passed ?? null, true),
      check('readiness', collision?.readiness?.ready === true, collision?.readiness?.ready ?? null, true),
      check(
        'failure-free',
        collision?.readiness?.failure == null,
        collision?.readiness?.failure?.message ?? null,
        null,
      ),
      check(
        'collision-p95',
        Number.isFinite(collision?.timingsMs?.total?.p95Ms)
          && collision.timingsMs.total.p95Ms <= config.gates.collisionP95Ms,
        collision?.timingsMs?.total?.p95Ms ?? null,
        config.gates.collisionP95Ms,
      ),
      check(
        'readiness-misses',
        count(report, 'readinessMisses') !== null
          && count(report, 'readinessMisses') <= config.gates.maxReadinessMisses,
        count(report, 'readinessMisses'),
        config.gates.maxReadinessMisses,
      ),
      check(
        'failed-chunks',
        count(report, 'failedChunks') !== null
          && count(report, 'failedChunks') <= config.gates.maxFailedChunks,
        count(report, 'failedChunks'),
        config.gates.maxFailedChunks,
      ),
      check(
        'final-queue-depth',
        count(report, 'finalQueueDepth') !== null
          && count(report, 'finalQueueDepth') <= config.gates.maxFinalQueueDepth,
        count(report, 'finalQueueDepth'),
        config.gates.maxFinalQueueDepth,
      ),
    );
    if (config.gates.requireCanonicalSignature) {
      checks.push(check(
        'canonical-signature',
        typeof collision?.canonicalSignature === 'string' && collision.canonicalSignature.length > 0,
        collision?.canonicalSignature ?? null,
        'non-empty',
      ));
    }
  }

  if (run.error) checks.push(check('runner-error', false, run.error, null));
  return Object.freeze(checks);
}

function summariseRun(config, caseConfig, run) {
  const checks = runChecks(config, caseConfig, run);
  const report = run.report ?? null;
  return Object.freeze({
    repeat: run.repeat,
    reportPath: run.reportPath ?? null,
    error: run.error ?? null,
    passed: checks.every((entry) => entry.passed),
    checks,
    scenario: report?.scenario?.id ?? null,
    adapter: report?.adapter ?? null,
    adapterIdentity: adapterIdentity(report?.adapter),
    frameP95Ms: round(report?.summary?.dt?.p95Ms),
    frameP99Ms: round(report?.summary?.dt?.p99Ms),
    collisionP95Ms: round(report?.collision?.timingsMs?.total?.p95Ms),
    hitchCount: report?.summary?.hitchCount ?? null,
    readinessMisses: count(report, 'readinessMisses'),
    failedChunks: count(report, 'failedChunks'),
    finalQueueDepth: count(report, 'finalQueueDepth'),
    canonicalSignature: report?.collision?.canonicalSignature ?? null,
  });
}

function configuredCoverage(config) {
  const coverage = new Set();
  for (const caseConfig of config.cases) {
    for (const item of caseConfig.coverage) coverage.add(item);
  }
  return coverage;
}

function aggregateAdapters(caseSummaries) {
  const identities = new Set();
  for (const caseSummary of caseSummaries) {
    for (const run of caseSummary.runs) {
      if (run.adapterIdentity) identities.add(run.adapterIdentity);
    }
  }
  return Object.freeze({
    identities: Object.freeze([...identities].sort()),
    consistent: identities.size <= 1,
  });
}

export function buildCollisionAcceptanceReport({
  config,
  runs,
  generatedAt = new Date().toISOString(),
  source = null,
}) {
  const runsByCase = new Map(config.cases.map((entry) => [entry.id, []]));
  for (const run of runs ?? []) {
    if (!runsByCase.has(run.caseId)) continue;
    runsByCase.get(run.caseId).push(run);
  }

  const baselineConfig = config.cases.find((entry) => entry.id === config.baselineCase);
  const baselineRuns = runsByCase.get(config.baselineCase)
    .map((run) => summariseRun(config, baselineConfig, run));
  const baselineFrameP95Ms = median(baselineRuns.map((run) => run.frameP95Ms));

  const cases = config.cases.map((caseConfig) => {
    const caseRuns = runsByCase.get(caseConfig.id)
      .sort((left, right) => left.repeat - right.repeat)
      .map((run) => summariseRun(config, caseConfig, run));
    const frameP95Ms = median(caseRuns.map((run) => run.frameP95Ms));
    const regressionMs = frameP95Ms === null || baselineFrameP95Ms === null
      ? null
      : frameP95Ms - baselineFrameP95Ms;
    const regressionPassed = caseConfig.id === config.baselineCase
      || (regressionMs !== null && regressionMs <= config.gates.frameP95RegressionMs);
    const checks = Object.freeze([
      check('repeat-count', caseRuns.length === config.repeats, caseRuns.length, config.repeats),
      check('all-runs', caseRuns.length > 0 && caseRuns.every((run) => run.passed),
        caseRuns.filter((run) => run.passed).length, caseRuns.length),
      check(
        'frame-p95-regression',
        regressionPassed,
        round(regressionMs),
        config.gates.frameP95RegressionMs,
      ),
    ]);
    return Object.freeze({
      id: caseConfig.id,
      label: caseConfig.label,
      scenario: caseConfig.scenario,
      collisionRequired: caseConfig.collisionRequired,
      coverage: caseConfig.coverage,
      passed: checks.every((entry) => entry.passed),
      checks,
      runs: Object.freeze(caseRuns),
      frameP95MedianMs: round(frameP95Ms),
      frameP95RegressionMs: round(regressionMs),
      collisionP95MaxMs: round(maximum(caseRuns.map((run) => run.collisionP95Ms))),
      hitchCountMax: maximum(caseRuns.map((run) => run.hitchCount)),
      readinessMissesMax: maximum(caseRuns.map((run) => run.readinessMisses)),
      failedChunksMax: maximum(caseRuns.map((run) => run.failedChunks)),
      finalQueueDepthMax: maximum(caseRuns.map((run) => run.finalQueueDepth)),
    });
  });

  const adapters = aggregateAdapters(cases);
  const adapterPassed = !config.gates.requireConsistentAdapter || adapters.consistent;
  const executionPassed = cases.every((entry) => entry.passed) && adapterPassed;
  const coverage = configuredCoverage(config);
  const missingCoverage = config.requiredCoverage.filter((entry) => !coverage.has(entry));
  const releasePassed = executionPassed && missingCoverage.length === 0;

  return Object.freeze({
    version: 1,
    kind: 'simcity-dnd-collision-acceptance',
    generatedAt,
    source,
    config: Object.freeze({
      version: config.version,
      repeats: config.repeats,
      baselineCase: config.baselineCase,
      hitchMs: config.hitchMs,
      gates: config.gates,
    }),
    baseline: Object.freeze({
      caseId: config.baselineCase,
      frameP95MedianMs: round(baselineFrameP95Ms),
    }),
    adapters,
    coverage: Object.freeze({
      required: config.requiredCoverage,
      configured: Object.freeze([...coverage].sort()),
      missing: Object.freeze(missingCoverage),
      complete: missingCoverage.length === 0,
    }),
    gates: Object.freeze({
      execution: Object.freeze({ passed: executionPassed }),
      release: Object.freeze({ passed: releasePassed }),
    }),
    cases: Object.freeze(cases),
  });
}

function markdownCell(value) {
  if (value == null) return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderCollisionAcceptanceMarkdown(report) {
  const lines = [
    '# Collision acceptance report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Execution gate: **${report.gates.execution.passed ? 'PASS' : 'FAIL'}**`,
    '',
    `Release gate: **${report.gates.release.passed ? 'PASS' : 'FAIL'}**`,
    '',
    `Baseline frame p95: ${markdownCell(report.baseline.frameP95MedianMs)} ms`,
    '',
    '| Case | Runs | Result | Frame p95 | Regression | Collision p95 max | Hitches max |',
    '|---|---:|---|---:|---:|---:|---:|',
  ];

  for (const caseSummary of report.cases) {
    lines.push(
      `| ${markdownCell(caseSummary.label)}`
      + ` | ${caseSummary.runs.length}`
      + ` | ${caseSummary.passed ? 'PASS' : 'FAIL'}`
      + ` | ${markdownCell(caseSummary.frameP95MedianMs)}`
      + ` | ${markdownCell(caseSummary.frameP95RegressionMs)}`
      + ` | ${markdownCell(caseSummary.collisionP95MaxMs)}`
      + ` | ${markdownCell(caseSummary.hitchCountMax)} |`,
    );
  }

  lines.push('', '## Coverage', '');
  if (report.coverage.missing.length === 0) {
    lines.push('All required P8 acceptance scenarios are configured.');
  } else {
    lines.push('Missing required scenarios:');
    for (const item of report.coverage.missing) lines.push(`- ${item}`);
  }

  lines.push('', '## Failed checks', '');
  const failures = [];
  for (const caseSummary of report.cases) {
    for (const entry of caseSummary.checks) {
      if (!entry.passed) failures.push(`${caseSummary.id}: ${entry.id}`);
    }
    for (const run of caseSummary.runs) {
      for (const entry of run.checks) {
        if (!entry.passed) failures.push(`${caseSummary.id} run ${run.repeat}: ${entry.id}`);
      }
    }
  }
  if (!report.adapters.consistent) failures.push('hardware adapters differ across runs');
  if (failures.length === 0) lines.push('None.');
  else for (const failure of failures) lines.push(`- ${failure}`);

  return `${lines.join('\n')}\n`;
}
