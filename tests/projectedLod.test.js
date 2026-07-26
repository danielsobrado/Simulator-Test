import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampLodToRadii,
  projectedPixelHeight,
  selectProjectedLod,
  updateLodTransition,
} from '../src/editor/stylized/lod/projectedLod.js';

const thresholds = {
  nearPixels: 32,
  proxyPixels: 8,
  impostorPixels: 2,
  clusterPixels: 0.45,
};

test('clusterPixels 0 disables the aggregate canopy band instead of matching everything', () => {
  // `pixels >= 0` is true for every tree, so a naive threshold read would turn the
  // whole world into cluster blobs — the band has to drop out entirely.
  const off = { ...thresholds, clusterPixels: 0 };
  assert.equal(selectProjectedLod({ pixels: 1, ...off }), 'culled');
  assert.equal(selectProjectedLod({ pixels: 0, ...off }), 'culled');
  assert.equal(selectProjectedLod({ pixels: 3, ...off }), 'impostor');
  // Still reachable when configured on.
  assert.equal(selectProjectedLod({ pixels: 1, ...thresholds }), 'cluster');
});

test('collapsing clusterRadius onto impostorRadius culls instead of demoting to cluster', () => {
  const radii = {
    meshRadius: 1, proxyRadius: 3, impostorRadius: 5, clusterRadius: 5,
  };
  // Every path that would otherwise fall through to 'cluster' now culls.
  assert.equal(clampLodToRadii({ band: 'impostor', chunkDistance: 6, ...radii }), 'culled');
  assert.equal(clampLodToRadii({ band: 'near', chunkDistance: 7, ...radii }), 'culled');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 6, ...radii }), 'culled');
  // Inside the impostor range nothing changes.
  assert.equal(clampLodToRadii({ band: 'near', chunkDistance: 4, ...radii }), 'impostor');
});

test('orthographic projected size responds to zoom', () => {
  const camera = { isOrthographicCamera: true, top: 90, bottom: -90, zoom: 1 };
  const normal = projectedPixelHeight({ camera, worldPosition: {}, worldHeight: 10, viewportHeight: 900 });
  camera.zoom = 2;
  const zoomed = projectedPixelHeight({ camera, worldPosition: {}, worldHeight: 10, viewportHeight: 900 });
  assert.equal(normal, 50);
  assert.equal(zoomed, 100);
});

test('perspective projected size falls with distance', () => {
  const camera = {
    isOrthographicCamera: false,
    fov: 60,
    position: { x: 0, y: 0, z: 0 },
  };
  const near = projectedPixelHeight({ camera, worldPosition: { x: 0, y: 0, z: 10 }, worldHeight: 5, viewportHeight: 1000 });
  const far = projectedPixelHeight({ camera, worldPosition: { x: 0, y: 0, z: 100 }, worldHeight: 5, viewportHeight: 1000 });
  assert.ok(near > far * 9.9);
});

test('LOD hysteresis prevents immediate boundary oscillation', () => {
  assert.equal(selectProjectedLod({ pixels: 31, previous: 'near', hysteresisRatio: 0.15, ...thresholds }), 'near');
  assert.equal(selectProjectedLod({ pixels: 26, previous: 'near', hysteresisRatio: 0.15, ...thresholds }), 'proxy');
  assert.equal(selectProjectedLod({ pixels: 2.1, previous: 'proxy', hysteresisRatio: 0.15, ...thresholds }), 'impostor');
});

test('LOD radii cap expensive representations', () => {
  const radii = { meshRadius: 1, proxyRadius: 3, impostorRadius: 5, clusterRadius: 8 };
  assert.equal(clampLodToRadii({ band: 'near', chunkDistance: 2, ...radii }), 'proxy');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 4, ...radii }), 'impostor');
  assert.equal(clampLodToRadii({ band: 'impostor', chunkDistance: 6, ...radii }), 'cluster');
  assert.equal(clampLodToRadii({ band: 'cluster', chunkDistance: 9, ...radii }), 'culled');
});

test('LOD transitions draw both representations until complete', () => {
  const initial = updateLodTransition({ state: null, target: 'near', timestamp: 0, durationMs: 300 });
  const settled = updateLodTransition({ state: initial, target: 'near', timestamp: 400, durationMs: 300 });
  const started = updateLodTransition({ state: settled, target: 'proxy', timestamp: 500, durationMs: 300 });
  const halfway = updateLodTransition({ state: started, target: 'proxy', timestamp: 650, durationMs: 300 });
  assert.equal(halfway.representations.length, 2);
  assert.equal(halfway.representations[0].band, 'near');
  assert.equal(halfway.representations[1].band, 'proxy');
  const done = updateLodTransition({ state: halfway, target: 'proxy', timestamp: 850, durationMs: 300 });
  assert.deepEqual(done.representations, [{ band: 'proxy', fade: 1 }]);
});

test('newly resident LOD bands fade in from culled', () => {
  const state = updateLodTransition({
    state: null,
    target: 'cluster',
    timestamp: 100,
    durationMs: 300,
  });
  assert.equal(state.complete, false);
  assert.deepEqual(state.representations, [
    { band: 'culled', fade: 1 },
    { band: 'cluster', fade: 0 },
  ]);
});
