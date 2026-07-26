import assert from 'node:assert/strict';
import test from 'node:test';
import { RegionalCharacterField } from '../src/editor/stylized/RegionalCharacterField.js';

test('regional character is deterministic and continuous across streamed chunk borders', () => {
  const left = new RegionalCharacterField({ seed: 42 });
  const right = new RegionalCharacterField({ seed: 42 });
  assert.deepEqual(left.sample(127.99, -64), right.sample(127.99, -64));
  const before = left.sample(127.99, -64);
  const after = left.sample(128.01, -64);
  for (const key of ['meadow', 'forest', 'scrub', 'rocky']) {
    assert.ok(Math.abs(before[key] - after[key]) < 0.01, `${key} jumped at the boundary`);
  }
});

test('regional character creates broad areas with distinct dominant looks', () => {
  const field = new RegionalCharacterField({
    seed: 911,
    config: { regionSize: 420, contrast: 2.4, minimumInfluence: 0.28 },
  });
  const dominant = new Set();
  for (let z = -1600; z <= 1600; z += 160) {
    for (let x = -1600; x <= 1600; x += 160) {
      const sample = field.sample(x, z);
      dominant.add(Object.entries(sample).sort((left, right) => right[1] - left[1])[0][0]);
      for (const value of Object.values(sample)) {
        assert.ok(value >= 0.28 && value <= 1);
      }
    }
  }
  assert.deepEqual([...dominant].sort(), ['forest', 'meadow', 'rocky', 'scrub']);
});

test('disabled regional placement leaves every scatter layer unchanged', () => {
  const field = new RegionalCharacterField({ config: { enabled: false } });
  assert.deepEqual(field.sample(999, -222), {
    meadow: 1,
    forest: 1,
    scrub: 1,
    rocky: 1,
  });
});
