import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bakeTerrainMaterialPage,
  captureTerrainMaterialBakeSource,
} from '../src/editor/materials/TerrainMaterialBakeCpu.js';
import { createTerrainMaterialBakeDescriptor } from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';

const CHUNK_SIZE = 4;

function config() {
  return {
    qualityTiers: { balanced: { resolution: CHUNK_SIZE } },
    build: { rowsPerYield: CHUNK_SIZE },
    classification: {
      rockSlopeStart: 0.18,
      rockSlopeFull: 0.62,
      snowLine: 26,
      snowFade: 8,
      snowSlopeMax: 0.55,
      shorelineRadiusCells: 2,
      wetnessRadiusCells: 1,
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

function dryPage() {
  const tilePixels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  const surfaceMaskPixels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  for (let index = 0; index < CHUNK_SIZE * CHUNK_SIZE; index += 1) {
    tilePixels.set([90, 140, 70, 4], index * 4);
    surfaceMaskPixels.set([0, 255, 0, 255], index * 4);
  }
  return {
    originX: 0,
    originZ: 0,
    tilePixels,
    surfaceMaskPixels,
    heights: new Float32Array((CHUNK_SIZE + 1) ** 2),
  };
}

async function bake(source) {
  return bakeTerrainMaterialPage({
    source,
    descriptor: descriptor(),
    config: config(),
    chunkSize: CHUNK_SIZE,
    tileSize: 2,
    worldSeed: 7,
    yieldControl: async () => {},
  });
}

test('water in a neighbouring chunk contributes shoreline influence at the chunk edge', async () => {
  const page = dryPage();
  const localOnly = await bake(captureTerrainMaterialBakeSource({ page }));

  const radius = 2;
  const haloSize = CHUNK_SIZE + radius * 2;
  const halo = new Uint8Array(haloSize ** 2);
  halo[radius * haloSize + radius - 1] = 255;
  const withHalo = await bake(captureTerrainMaterialBakeSource({
    page,
    waterHaloPixels: halo,
    waterHaloSize: haloSize,
    waterHaloRadius: radius,
  }));

  const localShoreline = localOnly.value.channels.wetnessShoreline[1];
  const haloShoreline = withHalo.value.channels.wetnessShoreline[1];
  assert.equal(localShoreline, 0);
  assert.ok(haloShoreline > 0);
});
