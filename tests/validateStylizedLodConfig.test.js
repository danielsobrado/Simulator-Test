import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStylizedLodConfig } from '../src/config/validateStylizedLodConfig.js';

function config() {
  return {
    stylizedSurface: {
      enabled: true,
      grass: {
        outerRingDensity: 0.45,
        bladesPerClump: 8,
        influenceTextureSize: 32,
      },
      flowers: { outerRingDensity: 0.5 },
      streaming: {
        grassCellsPerBuildSlice: 64,
        inactiveReleaseFrames: 30,
        treeManifestBuildsPerFrame: 4,
        manifestBuildBudgetMs: 3,
      },
      groundCover: {
        enabled: true,
        startDistance: 150,
        endDistance: 620,
        direction: [1, 0],
        frequency: 2.8,
        noiseScale: 0.08,
        noiseWarp: 3.2,
        strandThreshold: 0.72,
        strength: 0.36,
        tipColor: '#ffffff',
        tipStrength: 0.28,
      },
      lod: {
        enabled: true,
        tree: {
          meshRadius: 1,
          proxyRadius: 3,
          impostorRadius: 5,
          clusterRadius: 8,
          nearPixels: 32,
          proxyPixels: 8,
          impostorPixels: 2,
          clusterPixels: 0.45,
          hysteresisRatio: 0.15,
          transitionMs: 320,
        },
        rock: {
          meshRadius: 1,
          proxyRadius: 3,
          nearPixels: 16,
          proxyPixels: 1.5,
          impostorPixels: 0.5,
          clusterPixels: 0.25,
          hysteresisRatio: 0.15,
          transitionMs: 240,
        },
        impostor: {
          enabled: true,
          runtimeBake: true,
          manifest: '/assets/impostors/trees/manifest.json',
          columns: 8,
          rows: 2,
          tileSize: 128,
          gutter: 4,
          lowElevationDegrees: 12,
          highElevationDegrees: 58,
        },
        gpuCulling: { enabled: true },
      },
    },
  };
}

test('validates complete vegetation LOD configuration', () => {
  const value = config();
  assert.equal(validateStylizedLodConfig(value), value);
});

test('rejects inverted tree radii', () => {
  const value = config();
  value.stylizedSurface.lod.tree.impostorRadius = 2;
  assert.throws(() => validateStylizedLodConfig(value), /tree LOD radii must ascend/);
});

test('rejects oversized influence textures', () => {
  const value = config();
  value.stylizedSurface.grass.influenceTextureSize = 256;
  assert.throws(() => validateStylizedLodConfig(value), /must not exceed 128/);
});

test('rejects invalid impostor atlas dimensions', () => {
  const value = config();
  value.stylizedSurface.lod.impostor.tileSize = 16;
  assert.throws(() => validateStylizedLodConfig(value), /tileSize must be from 32 to 512/);
});


test('rejects invalid tree manifest budgets', () => {
  const value = config();
  value.stylizedSurface.streaming.treeManifestBuildsPerFrame = 0;
  assert.throws(() => validateStylizedLodConfig(value), /treeManifestBuildsPerFrame/);
});


test('validates prepared placement cache bounds', () => {
  const value = config();
  value.stylizedSurface.preparedPlacementCache = { maxEntries: 625, maxMiB: 192 };
  assert.equal(validateStylizedLodConfig(value), value);

  value.stylizedSurface.preparedPlacementCache.maxEntries = 0;
  assert.throws(() => validateStylizedLodConfig(value), /preparedPlacementCache\.maxEntries/);

  value.stylizedSurface.preparedPlacementCache.maxEntries = 625;
  value.stylizedSurface.preparedPlacementCache.maxMiB = 0;
  assert.throws(() => validateStylizedLodConfig(value), /preparedPlacementCache\.maxMiB/);
});

test('ground detail layers gate on a known regional character channel', () => {
  const value = config();
  value.stylizedSurface.tropicalKit = {
    enabled: true, residentRadius: 1, perChunk: 256, minScale: 0.8, maxScale: 1.25, radius: 0.6,
    heightOffset: 0, colorVariation: 0.12, castShadow: false, tileIds: [7], regionalChannel: 'forest',
  };
  assert.equal(validateStylizedLodConfig(value), value);
  value.stylizedSurface.tropicalKit.regionalChannel = 'jungle';
  assert.throws(() => validateStylizedLodConfig(value), /tropicalKit\.regionalChannel/);
});
