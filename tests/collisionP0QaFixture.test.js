import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionP0QaFixture } from '../src/editor/collision/CollisionP0QaFixture.js';

test('collision P0 fixture is deterministic and complete', () => {
  const options = { stepHeight: 1.1, maxSlopeDegrees: 50, chunkWorldSize: 128 };
  const first = createCollisionP0QaFixture(options);
  const second = createCollisionP0QaFixture(options);
  assert.deepEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.entries), true);

  const ids = new Set(first.entries.map((entry) => entry.id));
  for (const id of [
    'tree',
    'medium-rock',
    'large-walkable-rock',
    'wall-corner-x',
    'wall-corner-z',
    'doorway-left',
    'doorway-right',
    'doorway-header',
    'low-step',
    'high-step',
    'valid-ramp',
    'steep-ramp',
    'chunk-boundary-construction',
  ]) {
    assert.equal(ids.has(id), true, `missing fixture entry ${id}`);
  }
});

test('fixture thresholds straddle step and slope limits', () => {
  const stepHeight = 1.1;
  const maxSlopeDegrees = 50;
  const fixture = createCollisionP0QaFixture({ stepHeight, maxSlopeDegrees, chunkWorldSize: 128 });
  const byId = new Map(fixture.entries.map((entry) => [entry.id, entry]));
  assert.ok(byId.get('low-step').height < stepHeight);
  assert.ok(byId.get('high-step').height > stepHeight);
  assert.ok(byId.get('valid-ramp').slopeDegrees < maxSlopeDegrees);
  assert.ok(byId.get('steep-ramp').slopeDegrees > maxSlopeDegrees);
  assert.equal(byId.get('large-walkable-rock').walkable, true);
  assert.equal(byId.get('medium-rock').walkable, false);
});

test('construction fixture crosses a canonical chunk boundary', () => {
  const chunkWorldSize = 128;
  const fixture = createCollisionP0QaFixture({ chunkWorldSize });
  const construction = fixture.entries.find((entry) => entry.id === 'chunk-boundary-construction');
  assert.ok(construction.minX < chunkWorldSize);
  assert.ok(construction.maxX > chunkWorldSize);
  assert.equal(construction.x, chunkWorldSize);
});
