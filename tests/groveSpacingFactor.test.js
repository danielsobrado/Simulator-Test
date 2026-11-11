import assert from 'node:assert/strict';
import test from 'node:test';

import { groveSpacingFactor } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';

test('grove spacing stays in range, varies over a wood and is stable', () => {
  let low = Infinity;
  let high = -Infinity;
  for (let x = 0; x < 2000; x += 37) {
    for (let z = 0; z < 2000; z += 41) {
      const factor = groveSpacingFactor(x, z);
      assert.ok(factor >= 0.55 && factor <= 1.3);
      low = Math.min(low, factor);
      high = Math.max(high, factor);
    }
  }
  assert.ok(low < 0.75 && high > 1.1, `range ${low}..${high}`);
  assert.equal(groveSpacingFactor(123.5, -77), groveSpacingFactor(123.5, -77));
  assert.equal(groveSpacingFactor(undefined, 4), 1);
});
