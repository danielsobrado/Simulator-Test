import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bakeTerrainMaterialPage,
  captureTerrainMaterialBakeSource,
} from '../src/editor/materials/TerrainMaterialBakeCpu.js';
import { createTerrainMaterialBakeDescriptor } from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';

function bakeConfig(resolution = 4) {
  return {
    qualityTiers: { balanced: { resolution } },
    build: { rowsPerYield: 2 },
    classification: {
      rockSlopeStart: 0.18,
      rockSlopeFull: 0.62,
      snowLine: 26,
      snowFade: 8,
      snowSlopeMax: 0.55,
      shorelineRadiusCells: 4,
      wetnessRadiusCells: 2,
    },
    macro: {
      scaleMeters: 120,
      strength: 0.14,
      seedOffset: 2401,
      heightShadeScale: 0.018,
      minHeightShade: 0.78,
      maxHeightShade: 1.18,
      wetDarkening: 0.18,
    },
  };
}

function descriptor() {
  return createTerrainMaterialBakeDescriptor({
    chunkX: 0,
    chunkZ: 0,
    quality: 'balanced',
    revisions: { world: 0, tile: 0, height: 0, water: 0, canopy: 0 },
  });
}

function page(chunkSize = 4) {
  const tilePixels = new Uint8Array(chunkSize * chunkSize * 4);
  const surfaceMaskPixels = new Uint8Array(chunkSize * chunkSize * 4);
  for (let index = 0; index < chunkSize * chunkSize; index += 1) {
    tilePixels.set([90, 140, 70, 4], index * 4);
    surfaceMaskPixels.set([0, 255, 0, 255], index * 4);
  }
  surfaceMaskPixels[2] = 255;
  const heights = new Float32Array((chunkSize + 1) ** 2);
  for (let z = 0; z <= chunkSize; z += 1) {
    for (let x = 0; x <= chunkSize; x += 1) {
      heights[z * (chunkSize + 1) + x] = x * 0.25;
    }
  }
  return {
    originX: 0,
    originZ: 0,
    tilePixels,
    surfaceMaskPixels,
    heights,
  };
}

test('CPU terrain bake emits the seven packed channels at the configured byte budget', async () => {
  const source = captureTerrainMaterialBakeSource({
    page: page(),
    canopyPixels: new Uint8Array([64, 128, 192, 255]),
    canopySize: 2,
  });
  const result = await bakeTerrainMaterialPage({
    source,
    descriptor: descriptor(),
    config: bakeConfig(),
    chunkSize: 4,
    tileSize: 2,
    yieldControl: async () => {},
  });

  assert.equal(result.byteLength, 4 * 4 * 22);
  assert.equal(result.value.resolution, 4);
  assert.ok(result.value.channels.macroTint instanceof Uint8Array);
  assert.ok(result.value.channels.terrainShape instanceof Uint16Array);
  assert.ok(result.value.channels.materialWeights instanceof Uint8Array);
  assert.ok(result.value.channels.wetnessShoreline instanceof Uint8Array);
  assert.ok(result.value.channels.farColor instanceof Uint8Array);
  assert.ok(result.value.channels.farNormal instanceof Int8Array);
  assert.ok(result.value.channels.canopyWater instanceof Uint8Array);

  const weights = result.value.channels.materialWeights;
  for (let index = 0; index < 16; index += 1) {
    const offset = index * 4;
    assert.equal(
      weights[offset] + weights[offset + 1] + weights[offset + 2] + weights[offset + 3],
      255,
    );
  }
  assert.equal(result.value.channels.canopyWater[1], 255);
  assert.ok(result.value.channels.wetnessShoreline[0] > 0);
});

test('CPU terrain bake is deterministic for identical world-space source data', async () => {
  const source = captureTerrainMaterialBakeSource({ page: page() });
  const options = {
    source,
    descriptor: descriptor(),
    config: bakeConfig(),
    chunkSize: 4,
    tileSize: 2,
    yieldControl: async () => {},
  };
  const first = await bakeTerrainMaterialPage(options);
  const second = await bakeTerrainMaterialPage(options);

  for (const name of Object.keys(first.value.channels)) {
    assert.deepEqual(first.value.channels[name], second.value.channels[name], name);
  }
});

test('terrain bake source is snapshotted before asynchronous work mutates the live page', () => {
  const live = page();
  const source = captureTerrainMaterialBakeSource({ page: live });
  live.tilePixels[0] = 255;
  live.surfaceMaskPixels[1] = 0;
  live.heights[0] = 99;

  assert.equal(source.tilePixels[0], 90);
  assert.equal(source.surfaceMaskPixels[1], 255);
  assert.equal(source.heights[0], 0);
});
