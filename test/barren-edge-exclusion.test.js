import assert from 'node:assert/strict';
import test from 'node:test';
import { combineExclusions, createBarrenEdgeExclusion } from '../src/editor/stylized/forest/barrenEdgeExclusion.js';

// Desert (2) west of x = 0, grassland (4) east, open water (0) north of z = 100.
const tileAt = (cellX, cellZ) => (cellZ * 2 >= 100 ? 0 : cellX < 0 ? 2 : 4);

test('trees keep back from barren biomes but not from open water', () => {
  const near = createBarrenEdgeExclusion({ meters: 40, tileIds: [1, 2, 11] }, tileAt, 2);
  assert.equal(near({ x: 30, z: -10 }), true, '30 m from the desert');
  assert.equal(near({ x: 50, z: -10 }), false, '50 m from the desert');
  assert.equal(near({ x: 50, z: -90 }), false, 'beside the water');
  assert.equal(createBarrenEdgeExclusion(undefined, tileAt, 2), null);
  assert.equal(createBarrenEdgeExclusion({ meters: 0, tileIds: [2] }, tileAt, 2), null);
});

test('exclusions combine, and nothing to combine is no exclusion', () => {
  assert.equal(combineExclusions(null, null), null);
  const either = combineExclusions(null, (c) => c.x < 0, (c) => c.z > 0);
  assert.equal(either({ x: 1, z: -1 }), false);
  assert.equal(either({ x: -1, z: -1 }), true);
  assert.equal(either({ x: 1, z: 1 }), true);
});
