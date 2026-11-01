import assert from 'node:assert/strict';
import test from 'node:test';
import { WaterDistanceField } from '../src/editor/water/WaterDistanceField.js';
import { CANDIDATE_PENDING, createStableChunkManifestBuilder } from '../src/editor/stylized/StableScatterManifest.js';

const isWaterCell = (x, z) => x < 10 + (z % 3);

test('a prepared block resumes across yields and matches a direct build', () => {
  const direct = new WaterDistanceField({ isWaterCell, maxDistanceCells: 8 });
  const sliced = new WaterDistanceField({ isWaterCell, maxDistanceCells: 8 });
  let polls = 0, attempts = 0;
  const shouldYield = () => (polls += 1) % 5 === 0;
  for (; !sliced.prepare(3, 3, shouldYield); attempts += 1) assert.ok(attempts < 1000);
  assert.ok(attempts > 2, 'the block took several frames');
  for (let z = 0; z < 64; z += 7) for (let x = 0; x < 64; x += 7) {
    assert.equal(sliced.sample(x, z), direct.sample(x, z));
  }
});

test('a sample finishes a block a yielded preparation left behind', () => {
  const direct = new WaterDistanceField({ isWaterCell, maxDistanceCells: 8 });
  const field = new WaterDistanceField({ isWaterCell, maxDistanceCells: 8 });
  let polls = 0;
  assert.equal(field.prepare(0, 0, () => (polls += 1) > 3), false);
  assert.equal(field.sample(20, 20), direct.sample(20, 20));
  assert.equal(field.pendingBlocks.size, 0);
});

test('a pending candidate is retried without changing the manifest', () => {
  const build = (evaluator, shouldYield) => {
    const builder = createStableChunkManifestBuilder({
      kind: 'test', chunkX: 0, chunkZ: 0, chunkSize: 8, tileSize: 2, perChunk: 12, tileIds: [1],
      tileAt: () => 1, heightAt: () => 0, prototypeCount: 1, minScale: 1, maxScale: 1,
      radiusForScale: () => 0.5, candidateEvaluator: evaluator,
    });
    let manifest = null;
    for (let turn = 0; manifest === null; turn += 1) {
      assert.ok(turn < 1000);
      manifest = builder.step({ shouldYield });
    }
    return manifest;
  };
  const expected = build(() => true, null);
  const pendingOnce = new Set();
  const actual = build((candidate, shouldYield) => {
    if (shouldYield && !pendingOnce.has(candidate.stableId)) {
      pendingOnce.add(candidate.stableId);
      return CANDIDATE_PENDING;
    }
    return true;
  }, () => false);
  assert.ok(pendingOnce.size > 0);
  assert.deepEqual(actual, expected);
});

test('a block whose build throws can be built again', () => {
  let fail = true;
  const field = new WaterDistanceField({
    isWaterCell: () => {
      if (fail) throw new Error('interrupted');
      return false;
    },
    blockSize: 4,
    maxDistanceCells: 2,
  });
  assert.throws(() => field.sample(0, 0), /interrupted/);
  fail = false;
  assert.equal(field.sample(0, 0), 0);
});
