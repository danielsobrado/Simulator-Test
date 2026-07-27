import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/editor/ObjectView.js', import.meta.url),
  'utf8',
);

test('ObjectView delegates placement and foundation matrices to the shared resolver', () => {
  assert.match(source, /new ObjectPlacementResolver/);
  assert.match(source, /return this\.placementResolver\.resolve\(object\)/);
  assert.match(source, /return this\.placementResolver\.createObjectMatrix/);
  assert.match(source, /return this\.placementResolver\.createFoundationMatrix/);
});
