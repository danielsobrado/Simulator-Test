import test from 'node:test';
import assert from 'node:assert/strict';
import { landformRelief, landformShoreFade } from '../src/editor/world/TerrainLandforms.js';

test('landforms are deterministic, bounded and vary by seed', () => {
  let min = Infinity;
  let max = -Infinity;
  let differs = false;
  for (let x = -6000; x < 6000; x += 53) {
    for (let z = -6000; z < 6000; z += 59) {
      const relief = landformRelief(x, z, 918273);
      assert.equal(relief, landformRelief(x, z, 918273));
      min = Math.min(min, relief);
      max = Math.max(max, relief);
      differs ||= relief !== landformRelief(x, z, 7);
    }
  }
  assert.ok(differs);
  assert.ok(min > -16 && max < 16, `${min}..${max}`);
  assert.ok(max - min > 12, 'hills reach a walkable, visible relief');
});

test('landform slopes stay walkable and continuous between vertices', () => {
  let steepest = 0;
  for (let x = -3000; x < 3000; x += 7) {
    for (let z = -3000; z < 3000; z += 11) {
      const rise = Math.abs(landformRelief(x + 1, z, 5) - landformRelief(x, z, 5));
      steepest = Math.max(steepest, rise / 2);
    }
  }
  assert.ok(steepest < 0.6, `steepest slope ${steepest}`);
});

test('landforms fade out at the shore', () => {
  assert.equal(landformShoreFade(0), 0);
  assert.equal(landformShoreFade(8), 1);
  assert.ok(landformShoreFade(4) > 0 && landformShoreFade(4) < 1);
});
