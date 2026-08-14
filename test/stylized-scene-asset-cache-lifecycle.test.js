import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedSceneAssetCache } from '../src/editor/stylized/StylizedSceneAssetCache.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function disposableScene() {
  const texture = {
    isTexture: true,
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
    },
  };
  const geometry = {
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
    },
  };
  const material = {
    map: texture,
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
    },
  };
  const scene = {
    traverse(callback) {
      callback({ isMesh: true, geometry, material });
    },
  };
  return { scene, geometry, material, texture };
}

function createCache(pending) {
  return new StylizedSceneAssetCache({
    loader: {
      loadAsync: () => pending.promise,
    },
  });
}

test('pending scene released before load completion is disposed when it arrives', async () => {
  const pending = deferred();
  const cache = createCache(pending);
  const acquisition = cache.acquire('trees.glb');
  const asset = disposableScene();

  cache.release('trees.glb');
  assert.equal(cache.entries.has('trees.glb'), true);
  pending.resolve({ scene: asset.scene });

  await assert.rejects(acquisition, /released before loading completed/);
  assert.equal(cache.entries.has('trees.glb'), false);
  assert.equal(asset.geometry.disposeCount, 1);
  assert.equal(asset.material.disposeCount, 1);
  assert.equal(asset.texture.disposeCount, 1);
});

test('pending scene that resolves after cache disposal is disposed', async () => {
  const pending = deferred();
  const cache = createCache(pending);
  const acquisition = cache.acquire('trees.glb');
  const asset = disposableScene();

  cache.dispose();
  pending.resolve({ scene: asset.scene });

  await assert.rejects(acquisition, /released before loading completed/);
  assert.equal(cache.entries.size, 0);
  assert.equal(asset.geometry.disposeCount, 1);
  assert.equal(asset.material.disposeCount, 1);
  assert.equal(asset.texture.disposeCount, 1);
});

test('loaded scene is disposed exactly once on final release', async () => {
  const pending = deferred();
  const cache = createCache(pending);
  const asset = disposableScene();
  const acquisition = cache.acquire('trees.glb');

  pending.resolve({ scene: asset.scene });
  assert.strictEqual(await acquisition, asset.scene);
  cache.release('trees.glb');
  cache.dispose();

  assert.equal(asset.geometry.disposeCount, 1);
  assert.equal(asset.material.disposeCount, 1);
  assert.equal(asset.texture.disposeCount, 1);
});

test('disposed scene cache rejects new acquisitions', async () => {
  const cache = createCache(deferred());
  cache.dispose();

  await assert.rejects(cache.acquire('trees.glb'), /after cache disposal/);
});
