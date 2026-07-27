import assert from 'node:assert/strict';
import test from 'node:test';
import { WaterCellCache } from '../src/editor/water/WaterCellCache.js';

test('water cell cache reuses positive and negative canonical coordinates', () => {
  const cache = new WaterCellCache({ ArrayType: Float64Array, blockSize: 4, cacheLimit: 2 });
  let calls = 0;
  const createValue = (x, z) => {
    calls += 1;
    return x * 10 + z;
  };

  assert.equal(cache.get(-1, -1, createValue), -11);
  assert.equal(cache.get(-1, -1, createValue), -11);
  assert.equal(cache.get(4, 0, createValue), 40);
  assert.equal(calls, 2);
});

test('water cell cache evicts least-recently-used blocks', () => {
  const cache = new WaterCellCache({ ArrayType: Uint8Array, blockSize: 2, cacheLimit: 1 });
  let calls = 0;
  const createValue = () => {
    calls += 1;
    return 1;
  };

  cache.get(0, 0, createValue);
  cache.get(2, 0, createValue);
  cache.get(0, 0, createValue);
  assert.equal(calls, 3);
});
