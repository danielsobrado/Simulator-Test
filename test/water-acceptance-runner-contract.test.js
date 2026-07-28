import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/run-water-acceptance-qa.mjs', import.meta.url),
  'utf8',
);

test('water acceptance runner requires hardware WebGPU by default', () => {
  assert.match(source, /Hardware WebGPU adapter required/);
  // The flag name without its dashes: `hasFlag` prepends them, so the literal
  // `--allow-software` never appears in the source even though that is the
  // switch the runner accepts.
  assert.match(source, /hasFlag\('allow-software'\)/);
  assert.match(source, /performanceAuthoritative/);
});

test('water acceptance runner drives enter, dive, surface and exit phases', () => {
  assert.match(source, /phaseId: 'enter-water'/);
  assert.match(source, /phaseId: 'dive'/);
  assert.match(source, /phaseId: 'surface'/);
  assert.match(source, /phaseId: 'exit-water'/);
  assert.match(source, /ControlLeft/);
  assert.match(source, /Space/);
  assert.match(source, /KeyS/);
});

test('water acceptance runner writes a gated report', () => {
  assert.match(source, /water-acceptance-latest\.json/);
  assert.match(source, /tracker\.buildResult/);
  assert.match(source, /if \(!acceptance\.pass\) process\.exitCode = 1/);
});
