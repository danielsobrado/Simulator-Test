import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { rebuildTreeLod } from '../src/editor/stylized/TreeLodAssembler.js';
import { TreeImpostorAssetLoader } from '../src/editor/stylized/impostor/TreeImpostorAssets.js';
import { TREE_IMPOSTOR_MANIFEST_VERSION } from '../src/editor/stylized/impostor/TreeImpostorManifest.js';

function createRenderer(capacity = 4) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // Fade, seed and colour variation share one vec3 so the pipeline stays under the
  // 8 vertex buffer limit — see createGeometry in StylizedLodRuntime.
  geometry.setAttribute(
    'instanceDither',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3),
  );
  return new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), capacity);
}

function disposeRenderer(renderer) {
  renderer.geometry.dispose();
  renderer.material.dispose();
  renderer.dispose();
}

function prototype(index) {
  return {
    prototypeIndex: index,
    columns: 8,
    rows: 2,
    tileSize: 128,
    gutter: 4,
    lowElevationDegrees: 12,
    highElevationDegrees: 58,
    width: 8,
    height: 10,
    depth: 5,
    centerY: 5,
    radius: 5,
    albedo: `/assets/impostors/trees/prototype-${index}-albedo.png`,
    normal: `/assets/impostors/trees/prototype-${index}-normal.png`,
  };
}

test('falls back to cross-card geometry while textured impostors are unavailable', () => {
  const near = createRenderer();
  const proxy = createRenderer();
  const fallback = createRenderer();
  const cluster = createRenderer();

  try {
    rebuildTreeLod({
      plan: {
        entries: [{
          chunkX: 0,
          chunkZ: 0,
          chunkDistance: 4,
          representations: [{ band: 'impostor', fade: 1 }],
        }],
      },
      rockSource: null,
      manifestStore: {
        getOrSchedule: () => [{
          prototypeIndex: 0,
          x: 4,
          height: 2,
          z: -6,
          scale: 1,
          rotationY: 0.25,
          priority: 0.5,
        }],
        setActive() {},
      },
      prototypeCount: 1,
      prototypeWidth: 8,
      prototypeHeight: 10,
      impostorAtlases: [],
      impostorBatches: [],
      renderers: [[near]],
      proxyRenderers: [[proxy]],
      fallbackImpostorRenderers: [[fallback]],
      clusterRenderers: [[cluster]],
    });

    // Prototypes without a baked atlas render `fallbackImpostorParts` — the
    // cross-card canopy — so the impostor band never goes empty.
    assert.equal(near.count, 0);
    assert.equal(proxy.count, 0);
    assert.equal(fallback.count, 1);
    assert.equal(cluster.count, 0);
  } finally {
    [near, proxy, fallback, cluster].forEach(disposeRenderer);
  }
});

test('starts every versioned atlas texture request concurrently', async () => {
  const generatedAt = '2026-07-23T15:19:44.972Z';
  const manifest = {
    version: TREE_IMPOSTOR_MANIFEST_VERSION,
    generatedAt,
    sourceSignature: 'tree-impostor-v1-12345678',
    prototypes: [prototype(0), prototype(1)],
  };
  const calls = [];
  const pending = [];
  const loader = {
    loadAsync(url) {
      calls.push(url);
      return new Promise((resolve) => pending.push(resolve));
    },
  };
  const assetLoader = new TreeImpostorAssetLoader({
    baseUrl: '/',
    loader,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => manifest,
    }),
    expectedPrototypeCount: 2,
    expectedSourceSignature: manifest.sourceSignature,
  });

  const loading = assetLoader.load('/assets/impostors/trees/manifest.json');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 4);
  assert.ok(calls.every((url) => url.includes(`v=${encodeURIComponent(generatedAt)}`)));

  for (const resolve of pending) {
    resolve({ dispose() {} });
  }
  const atlases = await loading;
  assert.equal(atlases.length, 2);
});
