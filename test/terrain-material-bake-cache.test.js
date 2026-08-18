import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainMaterialBakeCache } from '../src/editor/materials/TerrainMaterialBakeCache.js';
import { createTerrainMaterialBakeDescriptor } from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';

const BASE_REVISIONS = Object.freeze({
  world: 1,
  tile: 2,
  height: 3,
  water: 4,
  canopy: 5,
});

function cacheConfig(overrides = {}) {
  return {
    cache: {
      maxEntries: overrides.maxEntries ?? 8,
      maxBytes: overrides.maxBytes ?? 4096,
      staleWhileRevalidate: overrides.staleWhileRevalidate ?? true,
    },
    fallback: {
      allowStale: overrides.allowStale ?? true,
      allowProcedural: true,
    },
  };
}

function descriptor({ chunkX = 0, chunkZ = 0, quality = 'balanced', revisions = BASE_REVISIONS } = {}) {
  return createTerrainMaterialBakeDescriptor({ chunkX, chunkZ, quality, revisions });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function resource(name) {
  return {
    name,
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
    },
  };
}

test('concurrent acquisitions deduplicate one bake and share the resident value', async () => {
  const pending = deferred();
  const cache = new TerrainMaterialBakeCache({ config: cacheConfig() });
  const requested = descriptor();
  const baked = resource('shared');
  let builds = 0;
  const build = () => {
    builds += 1;
    return pending.promise;
  };

  const firstPromise = cache.acquire(requested, build);
  const secondPromise = cache.acquire(requested, build);
  pending.resolve({ value: baked, byteLength: 128 });

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(builds, 1);
  assert.strictEqual(first.value, baked);
  assert.strictEqual(second.value, baked);
  assert.equal(first.stale, false);
  assert.equal(cache.getStats().inFlightHits, 1);
  assert.equal(cache.getStats().entries, 1);
  first.release();
  second.release();
  cache.dispose();
  assert.equal(baked.disposeCount, 1);
});

test('stale-while-revalidate returns the old bake and promotes the new revision', async () => {
  const cache = new TerrainMaterialBakeCache({ config: cacheConfig() });
  const oldDescriptor = descriptor();
  const oldResource = resource('old');
  const oldLease = await cache.acquire(
    oldDescriptor,
    async () => ({ value: oldResource, byteLength: 128 }),
  );
  oldLease.release();

  const newDescriptor = descriptor({
    revisions: { ...BASE_REVISIONS, water: BASE_REVISIONS.water + 1 },
  });
  const pending = deferred();
  const newResource = resource('new');
  const staleLease = await cache.acquire(newDescriptor, () => pending.promise);

  assert.strictEqual(staleLease.value, oldResource);
  assert.equal(staleLease.stale, true);
  assert.equal(cache.getStats().staleHits, 1);

  pending.resolve({ value: newResource, byteLength: 128 });
  await cache.whenIdle();
  const freshLease = await cache.acquire(
    newDescriptor,
    async () => assert.fail('fresh resident bake should not rebuild'),
  );
  assert.strictEqual(freshLease.value, newResource);
  assert.equal(freshLease.stale, false);

  staleLease.release();
  freshLease.release();
  cache.dispose();
  assert.equal(oldResource.disposeCount, 1);
  assert.equal(newResource.disposeCount, 1);
});

test('failed fresh bake can fall back to a retained stale lease', async () => {
  const cache = new TerrainMaterialBakeCache({
    config: cacheConfig({ staleWhileRevalidate: false }),
  });
  const oldDescriptor = descriptor();
  const oldResource = resource('old');
  const initial = await cache.acquire(
    oldDescriptor,
    async () => ({ value: oldResource, byteLength: 128 }),
  );
  initial.release();

  const newDescriptor = descriptor({
    revisions: { ...BASE_REVISIONS, height: BASE_REVISIONS.height + 1 },
  });
  const fallback = await cache.acquire(newDescriptor, async () => {
    throw new Error('bake failed');
  });

  assert.strictEqual(fallback.value, oldResource);
  assert.equal(fallback.stale, true);
  assert.equal(cache.getStats().buildFailures, 1);
  assert.equal(cache.getStats().staleFallbacks, 1);
  fallback.release();
  cache.dispose();
});

test('LRU eviction respects entry and byte budgets', async () => {
  const cache = new TerrainMaterialBakeCache({
    config: cacheConfig({ maxEntries: 2, maxBytes: 220 }),
  });
  const firstResource = resource('first');
  const secondResource = resource('second');
  const thirdResource = resource('third');

  for (const [chunkX, value] of [[1, firstResource], [2, secondResource], [3, thirdResource]]) {
    const lease = await cache.acquire(
      descriptor({ chunkX }),
      async () => ({ value, byteLength: 100 }),
    );
    lease.release();
  }

  const stats = cache.getStats();
  assert.equal(stats.entries, 2);
  assert.equal(stats.residentBytes, 200);
  assert.equal(stats.evictions, 1);
  assert.equal(firstResource.disposeCount, 1);
  assert.equal(secondResource.disposeCount, 0);
  assert.equal(thirdResource.disposeCount, 0);
  cache.dispose();
});
