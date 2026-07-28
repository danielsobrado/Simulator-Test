import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionCollisionProvider } from '../src/editor/collision/providers/ConstructionCollisionProvider.js';
import { ConstructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { compileConstructionCollision } from '../src/editor/construction/compile/ConstructionCollisionCompiler.js';
import { sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { straightConstruction } from './helpers/constructionCollisionFixtures.js';

function compile(record) {
  return compileConstructionCollision(record, sampleCubicBezierPath(record.path));
}

function createProvider(source, height = () => 0) {
  return new ConstructionCollisionProvider({
    source,
    terrainView: { getCanonicalHeight: height },
    chunkWorldSize: 128,
  });
}

test('construction provider emits stable canonical wall colliders', () => {
  const source = new ConstructionCollisionSource();
  const record = straightConstruction({
    id: 'construction-provider',
    start: [-8, 0],
    end: [8, 0],
  });
  source.setActive(record);
  source.applyPlan(record, compile(record));
  const provider = createProvider(source, (x) => x * 0.1);
  const built = provider.buildChunkData(0, 0);

  assert.equal(built.colliders.length, 1);
  const collider = built.colliders[0];
  assert.ok(collider.sourceId.startsWith(`construction:${record.id}:segment-main`));
  assert.equal(collider.ownerChunkX, 0);
  assert.equal(collider.ownerChunkZ, 0);
  assert.equal(collider.rotationY, 0);
  assert.deepEqual(collider.dimensions.slice(0, 1), [16]);
  assert.ok(Math.abs(collider.aabb.minY + 0.88) < 1e-9);
  assert.ok(Math.abs(collider.aabb.maxY - 4.3) < 1e-9);
  assert.ok(Math.abs(collider.position[1] - 1.71) < 1e-9);
  assert.equal(built.signature, provider.buildChunkData(0, 0).signature);
});

test('construction plan replacement dirties only old and new owner chunks', () => {
  const source = new ConstructionCollisionSource();
  const first = straightConstruction({
    id: 'construction-scope',
    revision: 1,
    start: [2, 0],
    end: [18, 0],
  });
  const second = straightConstruction({
    id: first.id,
    revision: 2,
    start: [132, 0],
    end: [148, 0],
  });
  source.setActive(first);
  source.applyPlan(first, compile(first));
  const provider = createProvider(source);
  for (const chunkX of [0, 1, 2]) provider.buildChunkData(chunkX, 0);
  assert.deepEqual(provider.consumeDirtyOwnerChunks(['0:0', '1:0', '2:0']), []);

  source.setActive(second);
  source.applyPlan(second, compile(second));
  assert.deepEqual(
    provider.consumeDirtyOwnerChunks(['0:0', '1:0', '2:0']),
    ['0:0', '1:0'],
  );
  assert.equal(provider.buildChunkData(0, 0).colliders.length, 0);
  assert.equal(provider.buildChunkData(1, 0).colliders.length, 1);
  assert.deepEqual(provider.consumeDirtyOwnerChunks(['0:0', '1:0', '2:0']), []);
});
