import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../scripts/run-water-acceptance-qa.mjs', import.meta.url),
  'utf8',
);

test('water acceptance runner requires hardware WebGPU by default', () => {
  assert.match(source, /Hardware WebGPU adapter required/);
  assert.match(source, /--allow-software/);
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
