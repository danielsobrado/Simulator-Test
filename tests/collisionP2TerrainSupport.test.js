import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainCollisionProvider } from '../src/editor/collision/providers/TerrainCollisionProvider.js';

test('flat terrain returns an upward walkable normal', () => {
  const provider = new TerrainCollisionProvider({ getHeight: () => 12, sampleDistance: 0.5 });
  const support = provider.sample(3, -7, 0.35);
  assert.equal(support.height, 12);
  assert.deepEqual(support.normal, { x: 0, y: 1, z: 0 });
});

test('movement up an excessive slope loses only the uphill component', () => {
  const provider = new TerrainCollisionProvider({
    getHeight: (x) => x * 2,
    sampleDistance: 0.5,
  });
  const maximumSlopeCosine = Math.cos(50 * Math.PI / 180);
  const uphill = provider.constrainMovement({
    startX: 0,
    startZ: 0,
    endX: 1,
    endZ: 1,
    radius: 0.35,
    maximumSlopeCosine,
  });
  assert.equal(uphill.constrained, true);
  assert.ok(Math.abs(uphill.x) < 1e-8);
  assert.ok(Math.abs(uphill.z - 1) < 1e-8);

  const downhill = provider.constrainMovement({
    startX: 1,
    startZ: 0,
    endX: 0,
    endZ: 0,
    radius: 0.35,
    maximumSlopeCosine,
  });
  assert.equal(downhill.constrained, false);
  assert.equal(downhill.x, 0);
});

test('valid terrain slopes preserve direction and distance', () => {
  const provider = new TerrainCollisionProvider({
    getHeight: (x) => x * 0.25,
    sampleDistance: 0.5,
  });
  const result = provider.constrainMovement({
    startX: 0,
    startZ: 0,
    endX: 2,
    endZ: 3,
    radius: 0.35,
    maximumSlopeCosine: Math.cos(50 * Math.PI / 180),
  });
  assert.equal(result.constrained, false);
  assert.equal(result.x, 2);
  assert.equal(result.z, 3);
});
