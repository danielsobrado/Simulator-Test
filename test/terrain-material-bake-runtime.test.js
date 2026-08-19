import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainMaterialBakeRuntime } from '../src/editor/materials/TerrainMaterialBakeRuntime.js';

function config(overrides = {}) {
  return {
    enabled: true,
    quality: 'balanced',
    qualityTiers: { balanced: { resolution: 4 } },
    build: {
      rowsPerYield: 2,
      maxConcurrent: overrides.maxConcurrent ?? 2,
      retryDelayMs: 10,
    },
    classification: {},
    macro: {},
    cache: { maxEntries: 8, maxBytes: 4096, staleWhileRevalidate: true },
    fallback: { allowStale: true, allowProcedural: true },
  };
}

function page(originX = 0, originZ = 0) {
  const chunkSize = 4;
  const tilePixels = new Uint8Array(chunkSize * chunkSize * 4);
  const surfaceMaskPixels = new Uint8Array(chunkSize * chunkSize * 4);
  for (let index = 0; index < chunkSize * chunkSize; index += 1) {
    tilePixels.set([80, 120, 60, 4], index * 4);
    surfaceMaskPixels.set([0, 255, 0, 255], index * 4);
  }
  return {
    originX,
    originZ,
    tilePixels,
    surfaceMaskPixels,
    heights: new Float32Array((chunkSize + 1) ** 2),
  };
}

function terrainDescriptor(chunkX, chunkZ) {
  return {
    key: `${chunkX}:${chunkZ}`,
    chunkX,
    chunkZ,
  };
}

function terrainSlot(slotIndex, chunkX, chunkZ = 0) {
  return {
    slotIndex,
    descriptor: terrainDescriptor(chunkX, chunkZ),
    page: page(chunkX * 4, chunkZ * 4),
    mesh: { visible: true },
    forestFloorKey: null,
    forestFloorPixels: new Uint8Array(4),
    forestFloorSize: 2,
  };
}

function createRevisionTracker() {
  const revisions = { world: 0, tile: 0, height: 0, water: 0, canopy: 0 };
  return {
    materialRevisionsFor() {
      return { ...revisions };
    },
    touchMaterialField(_chunkX, _chunkZ, field) {
      revisions[field] += 1;
    },
  };
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

async function settle(runtime) {
  await runtime.cache.whenIdle();
  await Promise.resolve();
  await Promise.resolve();
}

test('runtime bakes resident terrain slots and releases leases on reassignment', async () => {
  const slot = terrainSlot(0, 0);
  const terrainView = {
    slots: [slot],
    chunkSize: 4,
    surfaceMaskChunkRadius: 1,
    focusChunk: { chunkX: 0, chunkZ: 0 },
    worldStore: { tileSize: 2 },
    materialBakeRuntime: null,
  };
  let builds = 0;
  const runtime = new TerrainMaterialBakeRuntime({
    terrainView,
    revisionTracker: createRevisionTracker(),
    config: config(),
    onError: () => {},
    bakePage: async ({ descriptor }) => {
      builds += 1;
      return {
        value: { descriptor, durationMs: 1 },
        byteLength: 32,
      };
    },
  });

  runtime.update();
  await settle(runtime);
  assert.equal(builds, 1);
  assert.equal(slot.materialBake.descriptor.chunkX, 0);
  assert.equal(runtime.getStats().activeLeases, 1);

  slot.descriptor = terrainDescriptor(1, 0);
  slot.page = page(4, 0);
  runtime.update();
  assert.equal(slot.materialBake, null);
  await settle(runtime);
  assert.equal(builds, 2);
  assert.equal(slot.materialBake.descriptor.chunkX, 1);
  assert.equal(runtime.getStats().activeLeases, 1);

  runtime.dispose();
  assert.equal(slot.materialBake, null);
  assert.equal(terrainView.materialBakeRuntime, null);
});

test('valid forest-floor changes invalidate canopy material revision and refresh the bake', async () => {
  const slot = terrainSlot(0, 0);
  slot.forestFloorPixels = new Uint8Array([0, 0, 0, 0]);
  const tracker = createRevisionTracker();
  const terrainView = {
    slots: [slot],
    chunkSize: 4,
    surfaceMaskChunkRadius: 1,
    focusChunk: { chunkX: 0, chunkZ: 0 },
    worldStore: { tileSize: 2 },
    materialBakeRuntime: null,
  };
  let builds = 0;
  const runtime = new TerrainMaterialBakeRuntime({
    terrainView,
    revisionTracker: tracker,
    config: config(),
    onError: () => {},
    bakePage: async ({ descriptor, source }) => {
      builds += 1;
      return {
        value: {
          descriptor,
          canopy: source.canopyPixels?.[0] ?? 0,
          durationMs: 1,
        },
        byteLength: 32,
      };
    },
  });

  runtime.update();
  await settle(runtime);
  assert.equal(slot.materialBake.canopy, 0);

  slot.forestFloorPixels[0] = 255;
  slot.forestFloorKey = '0:0:1:forest-a';
  runtime.update();
  await settle(runtime);
  runtime.update();
  await Promise.resolve();
  assert.ok(builds >= 2);
  assert.equal(slot.materialBake.canopy, 255);
  assert.ok(slot.materialBake.descriptor.revisions.canopy > 0);
  runtime.dispose();
});

test('runtime starts no more than the configured number of concurrent bakes', async () => {
  const slots = [terrainSlot(0, 0), terrainSlot(1, 1), terrainSlot(2, 2)];
  const terrainView = {
    slots,
    chunkSize: 4,
    surfaceMaskChunkRadius: 1,
    focusChunk: { chunkX: 0, chunkZ: 0 },
    worldStore: { tileSize: 2 },
    materialBakeRuntime: null,
  };
  const pending = [deferred(), deferred(), deferred()];
  const started = [];
  const runtime = new TerrainMaterialBakeRuntime({
    terrainView,
    revisionTracker: createRevisionTracker(),
    config: config({ maxConcurrent: 2 }),
    onError: () => {},
    bakePage: ({ descriptor }) => {
      started.push(descriptor.chunkX);
      return pending[descriptor.chunkX].promise;
    },
  });

  runtime.update();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1]);
  assert.equal(runtime.getStats().inFlight, 2);

  pending[0].resolve({
    value: { descriptor: runtime.descriptorFor(slots[0]), durationMs: 1 },
    byteLength: 32,
  });
  await Promise.resolve();
  await Promise.resolve();
  runtime.update();
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);

  pending[1].resolve({
    value: { descriptor: runtime.descriptorFor(slots[1]), durationMs: 1 },
    byteLength: 32,
  });
  pending[2].resolve({
    value: { descriptor: runtime.descriptorFor(slots[2]), durationMs: 1 },
    byteLength: 32,
  });
  await settle(runtime);
  runtime.dispose();
});

test('runtime forwards the active stylized palette into the far-color baker', async () => {
  const slot = terrainSlot(0, 0);
  const terrainView = {
    slots: [slot],
    chunkSize: 4,
    surfaceMaskChunkRadius: 0,
    focusChunk: { chunkX: 0, chunkZ: 0 },
    stylizedConfig: {
      color: { bottom: '#4f7c13', brightness: 0.8 },
      dirt: { color: '#ac956c' },
      trees: { forestFloor: { groundCoreColor: '#3b5233' } },
    },
    worldStore: { tileSize: 2 },
    materialBakeRuntime: null,
  };
  let capturedStyle = null;
  const runtime = new TerrainMaterialBakeRuntime({
    terrainView,
    revisionTracker: createRevisionTracker(),
    config: config(),
    onError: () => {},
    bakePage: async ({ descriptor, materialStyle }) => {
      capturedStyle = materialStyle;
      return {
        value: { descriptor, durationMs: 1 },
        byteLength: 32,
      };
    },
  });

  runtime.update();
  await settle(runtime);
  assert.deepEqual(capturedStyle, {
    grassBottomColor: '#4f7c13',
    grassBrightness: 0.8,
    dirtColor: '#ac956c',
    forestColor: '#3b5233',
  });
  runtime.dispose();
});
