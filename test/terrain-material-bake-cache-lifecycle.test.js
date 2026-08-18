import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainMaterialBakeCache } from '../src/editor/materials/TerrainMaterialBakeCache.js';
import { createTerrainMaterialBakeDescriptor } from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';

const REVISIONS = Object.freeze({
  world: 1,
  tile: 1,
  height: 1,
  water: 1,
  canopy: 1,
});

function config(overrides = {}) {
  return {
    cache: {
      maxEntries: overrides.maxEntries ?? 1,
      maxBytes: overrides.maxBytes ?? 256,
      staleWhileRevalidate: true,
    },
    fallback: {
      allowStale: true,
      allowProcedural: true,
    },
  };
}

function descriptor(chunkX = 0) {
  return createTerrainMaterialBakeDescriptor({
    chunkX,
    chunkZ: 0,
    quality: 'balanced',
    revisions: REVISIONS,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
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

test('active leases are never evicted to satisfy a cache budget', async () => {
  const cache = new TerrainMaterialBakeCache({ config: config() });
  const firstResource = resource('first');
  const secondResource = resource('second');
  const first = await cache.acquire(
    descriptor(1),
    async () => ({ value: firstResource, byteLength: 128 }),
  );
  const second = await cache.acquire(
    descriptor(2),
    async () => ({ value: secondResource, byteLength: 128 }),
  );

  assert.equal(cache.getStats().entries, 2);
  assert.equal(firstResource.disposeCount, 0);
  assert.equal(secondResource.disposeCount, 0);

  second.release();
  assert.equal(secondResource.disposeCount, 1);
  assert.equal(firstResource.disposeCount, 0);
  assert.equal(cache.getStats().entries, 1);
  first.release();
  cache.dispose();
  assert.equal(firstResource.disposeCount, 1);
});

test('cache disposal defers active resource destruction until lease release', async () => {
  const cache = new TerrainMaterialBakeCache({ config: config() });
  const baked = resource('active');
  const lease = await cache.acquire(
    descriptor(),
    async () => ({ value: baked, byteLength: 128 }),
  );

  cache.dispose();
  assert.equal(baked.disposeCount, 0);
  assert.equal(cache.getStats().entries, 1);

  lease.release();
  assert.equal(baked.disposeCount, 1);
  assert.equal(cache.getStats().entries, 0);
  lease.release();
  assert.equal(baked.disposeCount, 1);
});

test('bake completing after cache disposal is disposed and rejected', async () => {
  const cache = new TerrainMaterialBakeCache({ config: config() });
  const pending = deferred();
  const baked = resource('late');
  const acquisition = cache.acquire(descriptor(), () => pending.promise);

  cache.dispose();
  pending.resolve({ value: baked, byteLength: 128 });

  await assert.rejects(acquisition, /completed after cache disposal/);
  await cache.whenIdle();
  assert.equal(baked.disposeCount, 1);
  assert.equal(cache.getStats().entries, 0);
  assert.equal(cache.getStats().inFlight, 0);
});

test('oversized and malformed bake results are disposed without residency', async () => {
  const cache = new TerrainMaterialBakeCache({ config: config({ maxBytes: 128 }) });
  const oversized = resource('oversized');
  const malformed = resource('malformed');

  await assert.rejects(
    cache.acquire(descriptor(1), async () => ({ value: oversized, byteLength: 129 })),
    /exceeds the cache byte budget/,
  );
  await assert.rejects(
    cache.acquire(descriptor(2), async () => ({ value: malformed, byteLength: 0 })),
    /byteLength must be a positive safe integer/,
  );

  assert.equal(oversized.disposeCount, 1);
  assert.equal(malformed.disposeCount, 1);
  assert.equal(cache.getStats().entries, 0);
  cache.dispose();
});

test('disposed cache rejects future acquisitions', async () => {
  const cache = new TerrainMaterialBakeCache({ config: config() });
  cache.dispose();

  await assert.rejects(
    cache.acquire(descriptor(), async () => ({ value: resource('unused'), byteLength: 128 })),
    /after cache disposal/,
  );
});
