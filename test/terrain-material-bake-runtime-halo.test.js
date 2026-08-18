import assert from 'node:assert/strict';
import test from 'node:test';
import { TerrainMaterialBakeRuntime } from '../src/editor/materials/TerrainMaterialBakeRuntime.js';

const CHUNK_SIZE = 4;

function config() {
  return {
    enabled: true,
    quality: 'balanced',
    qualityTiers: { balanced: { resolution: 4 } },
    build: { rowsPerYield: 2, maxConcurrent: 2, retryDelayMs: 10 },
    classification: { shorelineRadiusCells: 1, wetnessRadiusCells: 1 },
    macro: {},
    cache: { maxEntries: 8, maxBytes: 4096, staleWhileRevalidate: true },
    fallback: { allowStale: true, allowProcedural: true },
  };
}

function page(chunkX, chunkZ) {
  const tilePixels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  const surfaceMaskPixels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  for (let index = 0; index < CHUNK_SIZE * CHUNK_SIZE; index += 1) {
    surfaceMaskPixels[index * 4 + 1] = 255;
    surfaceMaskPixels[index * 4 + 3] = 255;
  }
  return {
    originX: chunkX * CHUNK_SIZE,
    originZ: chunkZ * CHUNK_SIZE,
    tilePixels,
    surfaceMaskPixels,
    heights: new Float32Array((CHUNK_SIZE + 1) ** 2),
  };
}

function slot(slotIndex, chunkX, chunkZ) {
  return {
    slotIndex,
    descriptor: { key: `${chunkX}:${chunkZ}`, chunkX, chunkZ },
    page: page(chunkX, chunkZ),
    mesh: { visible: true },
    forestFloorKey: null,
    forestFloorPixels: new Uint8Array(4),
    forestFloorSize: 2,
  };
}

function tracker() {
  return {
    materialRevisionsFor() {
      return { world: 0, tile: 0, height: 0, water: 0, canopy: 0 };
    },
    touchMaterialField() {},
  };
}

async function settle(runtime) {
  await runtime.cache.whenIdle();
  await new Promise((resolve) => setImmediate(resolve));
}

test('runtime defers a bake until the complete resident water halo is available', async () => {
  const center = slot(0, 0, 0);
  const terrainView = {
    slots: [center],
    chunkSize: CHUNK_SIZE,
    surfaceMaskChunkRadius: 1,
    focusChunk: { chunkX: 0, chunkZ: 0 },
    worldStore: { tileSize: 2 },
    materialBakeRuntime: null,
  };
  let builds = 0;
  const runtime = new TerrainMaterialBakeRuntime({
    terrainView,
    revisionTracker: tracker(),
    config: config(),
    onError: () => {},
    bakePage: async ({ descriptor, source }) => {
      builds += 1;
      return {
        value: { descriptor, source, durationMs: 0 },
        byteLength: 32,
      };
    },
  });

  runtime.update();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 0);
  assert.equal(center.materialBake, null);

  let slotIndex = 1;
  for (let chunkZ = -1; chunkZ <= 1; chunkZ += 1) {
    for (let chunkX = -1; chunkX <= 1; chunkX += 1) {
      if (chunkX === 0 && chunkZ === 0) continue;
      terrainView.slots.push(slot(slotIndex, chunkX, chunkZ));
      slotIndex += 1;
    }
  }
  runtime.update();
  await settle(runtime);

  assert.equal(builds, 1);
  assert.ok(center.materialBake);
  assert.equal(center.materialBake.source.waterHaloRadius, 1);
  assert.equal(center.materialBake.source.waterHaloSize, CHUNK_SIZE + 2);
  runtime.dispose();
});
