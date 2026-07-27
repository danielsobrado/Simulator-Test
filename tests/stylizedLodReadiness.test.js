import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChunkLodPlan } from '../src/editor/stylized/lod/StylizedLodRuntime.js';

const thresholds = Object.freeze({
  nearPixels: 32,
  proxyPixels: 8,
  impostorPixels: 2,
  clusterPixels: 0,
  hysteresisRatio: 0.15,
});

const radii = Object.freeze({
  meshRadius: 1,
  proxyRadius: 3,
  impostorRadius: 5,
  clusterRadius: 5,
});

function createPlan({ timestamp, transitionStates, anchor }) {
  return buildChunkLodPlan({
    focus: { chunkX: 0, chunkZ: 0 },
    radius: 0,
    chunkWorldSize: 128,
    floatingOrigin: { getState: () => ({ x: 0, z: 0 }) },
    camera: {
      isOrthographicCamera: true,
      top: 100,
      bottom: -100,
      zoom: 1,
    },
    viewportHeight: 1000,
    objectHeight: 10,
    thresholds,
    radii,
    transitionStates,
    timestamp,
    transitionMs: 320,
    positionForChunk: () => anchor,
  });
}

test('manifest-backed LOD waits to start its fade until the chunk is ready', () => {
  const states = new Map();
  const waiting = createPlan({ timestamp: 0, transitionStates: states, anchor: null });
  assert.equal(waiting.entries[0].ready, false);
  assert.equal(waiting.entries[0].representations[1].band, 'near');
  assert.ok(waiting.entries[0].representations[1].fade > 0);
  assert.ok(waiting.entries[0].representations[1].fade < 1e-6);

  const ready = createPlan({
    timestamp: 1000,
    transitionStates: states,
    anchor: { x: 64, y: 0, z: -64, heightScale: 1 },
  });
  assert.equal(ready.entries[0].ready, true);
  assert.equal(ready.entries[0].representations[1].fade, 0);

  const halfway = createPlan({
    timestamp: 1160,
    transitionStates: states,
    anchor: { x: 64, y: 0, z: -64, heightScale: 1 },
  });
  assert.equal(halfway.entries[0].representations[1].fade, 0.5);
});
