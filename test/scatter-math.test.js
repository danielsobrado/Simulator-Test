import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cellSampleRandom01,
  instanceCapacity,
  overlaps,
  scatterRandom01,
} from '../src/editor/stylized/scatterMath.js';
import {
  StylizedSceneAssetCache,
  createStylizedSceneLoader,
} from '../src/editor/stylized/StylizedSceneAssetCache.js';

test('scatter RNG is deterministic and channel-separated', () => {
  assert.equal(scatterRandom01(1, 2, 3, 0), scatterRandom01(1, 2, 3, 0));
  assert.notEqual(scatterRandom01(1, 2, 3, 0), scatterRandom01(1, 2, 3, 1));
  assert.notEqual(
    cellSampleRandom01(1, 2, 3, 4, 0),
    cellSampleRandom01(1, 2, 3, 5, 0),
  );
  assert.ok(scatterRandom01(0, 0, 0, 0) >= 0 && scatterRandom01(0, 0, 0, 0) < 1);
});

test('instanceCapacity uses worst-case prototype pile-up', () => {
  assert.equal(instanceCapacity({ residentRadius: 1, perChunk: 12 }), 9 * 12);
  assert.equal(instanceCapacity({ residentRadius: 0, perChunk: 5 }), 5);
});

test('overlaps honors combined clearance radii', () => {
  const placements = [{ x: 0, z: 0, radius: 2 }];
  assert.equal(overlaps(3, 0, placements, 0.5), false);
  assert.equal(overlaps(2.4, 0, placements, 0.5), true);
});

test('stylized GLTF loader enables meshopt and renderer-aware KTX2 decoding', () => {
  const renderer = {
    isWebGPURenderer: true,
    hasFeature() {
      return false;
    },
  };
  const { loader, ktx2Loader } = createStylizedSceneLoader({
    renderer,
    baseUrl: '/game/',
  });

  assert.ok(loader.meshoptDecoder);
  assert.equal(loader.ktx2Loader, ktx2Loader);
  assert.equal(ktx2Loader.transcoderPath, '');
  ktx2Loader.dispose();
});

test('StylizedSceneAssetCache shares one load and disposes on final release', async () => {
  let loads = 0;
  let disposed = 0;
  const scene = {
    traverse(visitor) {
      visitor({
        isMesh: true,
        geometry: { dispose() { disposed += 1; } },
        material: { dispose() { disposed += 1; } },
      });
    },
  };
  const cache = new StylizedSceneAssetCache({
    baseUrl: '/',
    loader: {
      async loadAsync() {
        loads += 1;
        return { scene };
      },
    },
  });

  const [first, second] = await Promise.all([
    cache.acquire('/assets/grass-scene.glb'),
    cache.acquire('/assets/grass-scene.glb'),
  ]);
  assert.equal(first, scene);
  assert.equal(second, scene);
  assert.equal(loads, 1);

  cache.release('/assets/grass-scene.glb');
  assert.equal(disposed, 0);
  cache.release('/assets/grass-scene.glb');
  assert.equal(disposed, 2);
  assert.equal(cache.entries.size, 0);
});
