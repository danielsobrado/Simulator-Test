import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildStableChunkManifest,
  placementSignature,
} from '../src/editor/stylized/StableScatterManifest.js';

function options(chunkX, chunkZ, blockers = []) {
  return {
    kind: 'tree',
    chunkX,
    chunkZ,
    chunkSize: 8,
    tileSize: 2,
    perChunk: 12,
    tileIds: [1],
    tileAt: () => 1,
    heightAt: (x, z) => x * 0.01 + z * 0.02,
    prototypeCount: 3,
    minScale: 0.8,
    maxScale: 1.2,
    radiusForScale: () => 2.5,
    blockers,
  };
}

test('stable manifests are repeatable', () => {
  const first = buildStableChunkManifest(options(0, 0));
  const second = buildStableChunkManifest(options(0, 0));
  assert.deepEqual(first, second);
  assert.equal(placementSignature(first), placementSignature(second));
});

test('scatter layers can use independent deterministic candidate positions', () => {
  const shared = {
    ...options(0, 0),
    radiusForScale: () => 0,
  };
  const trees = buildStableChunkManifest({
    ...shared,
    kind: 'tree',
  });
  const bushes = buildStableChunkManifest({
    ...shared,
    kind: 'bush',
    randomChannelOffset: 64,
  });
  const repeatedBushes = buildStableChunkManifest({
    ...shared,
    kind: 'bush',
    randomChannelOffset: 64,
  });

  assert.equal(trees.length, shared.perChunk);
  assert.equal(bushes.length, shared.perChunk);
  assert.deepEqual(bushes, repeatedBushes);
  assert.ok(trees.every((tree, index) => (
    tree.x !== bushes[index].x || tree.z !== bushes[index].z
  )));
});

test('scatter random channel offsets reject invalid values', () => {
  assert.throws(
    () => buildStableChunkManifest({
      ...options(0, 0),
      randomChannelOffset: -1,
    }),
    /randomChannelOffset/,
  );
});

test('shared-boundary acceptance does not depend on focus traversal', () => {
  const left = buildStableChunkManifest(options(0, 0));
  const right = buildStableChunkManifest(options(1, 0));
  const repeatedRight = buildStableChunkManifest(options(1, 0));
  const repeatedLeft = buildStableChunkManifest(options(0, 0));
  assert.deepEqual(left, repeatedLeft);
  assert.deepEqual(right, repeatedRight);
});

test('stable blockers remove overlapping candidates', () => {
  const baseline = buildStableChunkManifest(options(0, 0));
  assert.ok(baseline.length > 0);
  const blocked = buildStableChunkManifest(options(0, 0, [{
    x: baseline[0].x,
    z: baseline[0].z,
    radius: baseline[0].radius,
  }]));
  assert.ok(!blocked.some((candidate) => candidate.stableId === baseline[0].stableId));
});

test('stable manifests support deterministic weighted prototype selection', () => {
  const manifest = buildStableChunkManifest({
    ...options(0, 0),
    prototypeIndexForRoll: () => 2,
  });

  assert.ok(manifest.length > 0);
  assert.ok(manifest.every((candidate) => candidate.prototypeIndex === 2));
  assert.throws(
    () => buildStableChunkManifest({
      ...options(0, 0),
      prototypeIndexForRoll: () => 3,
    }),
    /available prototype index/,
  );
});

test('prototype selection receives the candidate biome tile ID', () => {
  const seenTileIds = new Set();
  const manifest = buildStableChunkManifest({
    ...options(0, 0),
    tileIds: [7],
    tileAt: () => 7,
    prototypeIndexForRoll: (_roll, tileId) => {
      seenTileIds.add(tileId);
      return 1;
    },
  });

  assert.ok(manifest.length > 0);
  assert.deepEqual([...seenTileIds], [7]);
  assert.ok(manifest.every((candidate) => candidate.prototypeIndex === 1));
});
