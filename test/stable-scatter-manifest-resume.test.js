import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStableChunkManifest,
  createStableChunkManifestBuilder,
  placementSignature,
} from '../src/editor/stylized/StableScatterManifest.js';

function manifestOptions() {
  return {
    kind: 'resume-test',
    chunkX: 2,
    chunkZ: -1,
    chunkSize: 16,
    tileSize: 2,
    perChunk: 18,
    tileIds: new Set([1, 2]),
    tileAt: (cellX, cellZ) => ((cellX * 3 + cellZ * 5) & 3) === 0 ? 3 : 1,
    heightAt: (x, z) => Math.sin(x * 0.03) + Math.cos(z * 0.04),
    prototypeCount: 4,
    prototypeIndexForRoll: (roll) => Math.min(3, Math.floor(roll * 4)),
    minScale: 0.7,
    maxScale: 1.4,
    radiusForScale: (scale) => 0.8 * scale,
    blockers: [{ x: 70, z: 28, radius: 1.2 }],
    maxAccepted: 9,
    candidateEvaluator: (candidate) => (
      candidate.priority < 0.82
        ? { regionBand: Math.floor((candidate.x + candidate.z) / 32) }
        : null
    ),
  };
}

test('stable scatter keeps the placement IDs and signature recorded before numeric buckets', () => {
  const manifest = buildStableChunkManifest(manifestOptions());
  assert.deepEqual(manifest.map(placement => placement.stableId), [
    'resume-test:2:-1:0',
    'resume-test:2:-1:1',
    'resume-test:2:-1:4',
    'resume-test:2:-1:5',
    'resume-test:2:-1:7',
    'resume-test:2:-1:9',
    'resume-test:2:-1:10',
    'resume-test:2:-1:12',
    'resume-test:2:-1:15',
  ]);
  assert.equal(placementSignature(manifest), '9:0236005c');
});

test('numeric scatter buckets reject a span outside the safe coordinate range', () => {
  assert.throws(() => buildStableChunkManifest({
    ...manifestOptions(),
    radiusForScale: () => 1e-12,
  }), RangeError);
});

test('whole-cell rebasing preserves small scatter at imported world coordinates', () => {
  const manifest = buildStableChunkManifest({
    ...manifestOptions(),
    chunkX: 73939,
    chunkZ: 74206,
    radiusForScale: scale => scale * 0.08,
  });
  assert.deepEqual(manifest.map(placement => placement.stableId), [
    'resume-test:73939:74206:1',
    'resume-test:73939:74206:3',
    'resume-test:73939:74206:4',
    'resume-test:73939:74206:6',
    'resume-test:73939:74206:8',
    'resume-test:73939:74206:10',
    'resume-test:73939:74206:13',
    'resume-test:73939:74206:14',
    'resume-test:73939:74206:16',
  ]);
  assert.equal(placementSignature(manifest), '9:4947de17');
});

test('resumable stable scatter is identical to synchronous generation', () => {
  const expected = buildStableChunkManifest(manifestOptions());
  const builder = createStableChunkManifestBuilder(manifestOptions());
  let actual = null;
  let slices = 0;

  while (actual === null) {
    let checks = 0;
    actual = builder.step({ shouldYield: () => ++checks >= 6 });
    slices += 1;
    assert.ok(slices < 1000, 'resumable scatter must make forward progress');
  }

  assert.ok(slices > 1, 'test must exercise more than one resumable slice');
  assert.deepEqual(actual, expected);
  assert.equal(builder.done, true);
  assert.strictEqual(builder.step(), actual);
});

test('invalid prototype count completes without resumable work', () => {
  const builder = createStableChunkManifestBuilder({
    ...manifestOptions(),
    prototypeCount: 0,
  });

  assert.equal(builder.done, true);
  assert.deepEqual(builder.step(), []);
});
