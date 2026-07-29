import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runnerSource = readFileSync(
  new URL('../scripts/run-perf-qa.mjs', import.meta.url),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const matrixSource = readFileSync(
  new URL('../scripts/run-perf-matrix.mjs', import.meta.url),
  'utf8',
);
const waterRunnerSource = readFileSync(
  new URL('../scripts/run-water-acceptance-qa.mjs', import.meta.url),
  'utf8',
);

test('performance runner tolerates a transient harness API gap while polling', () => {
  assert.match(
    runnerSource,
    /waitForFunction\(\(\) => window\.__perfQa\?\.status === 'done'/,
  );
  assert.doesNotMatch(
    runnerSource,
    /waitForFunction\(\(\) => window\.__perfQa\.status === 'done'/,
  );
});

test('performance runner can capture an optional sampled CPU profile', () => {
  assert.match(runnerSource, /readArg\('cpu-profile'\)/);
  assert.match(runnerSource, /cdp\.send\('Profiler\.setSamplingInterval'/);
  assert.match(runnerSource, /cdp\.send\('Profiler\.start'\)/);
  assert.match(runnerSource, /cdp\.send\('Profiler\.stop'\)/);
  assert.match(runnerSource, /cpuProfile:/);
});

test('performance report parser accepts an explicit report path', () => {
  assert.equal(
    packageJson.scripts['qa:perf:parse'],
    'node scripts/parse-perf-qa.mjs',
  );
});

test('performance runner forwards vegetation density profiles', () => {
  assert.match(runnerSource, /const density = readArg\('density'\)/);
  assert.match(runnerSource, /setOptionalQuery\(query, 'density', density\)/);
});

test('performance matrix covers vegetation, construction, and water', () => {
  assert.equal(
    packageJson.scripts['qa:perf:matrix'],
    'node scripts/run-perf-matrix.mjs',
  );
  for (const required of [
    "'dense-forest'",
    "'high-grass'",
    "'dense-mixed'",
    "'construction-ring'",
    'run-water-acceptance-qa.mjs',
  ]) {
    assert.match(matrixSource, new RegExp(required));
  }
});

test('water runner drives phases through the harness key API', () => {
  assert.match(waterRunnerSource, /window\.__perfQa\?\.setKeys/);
  assert.doesNotMatch(waterRunnerSource, /page\.keyboard\.(down|up)/);
});
