import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runnerSource = readFileSync(
  new URL('../scripts/run-perf-qa.mjs', import.meta.url),
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
