import assert from 'node:assert/strict';
import test from 'node:test';
import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import {
  cellToChunk,
  chunkKey,
  floorDiv,
  positiveModulo,
} from '../src/editor/world/WorldCoordinates.js';

function createStore(overrides = {}) {
  return new InfiniteWorldStore({
    chunkSize: 4,
    tileSize: 2,
    cacheLimit: 3,
    generator: new ProceduralWorldGenerator({ seed: 42 }),
    ...overrides,
  });
}

test('negative world coordinates map to deterministic chunks', () => {
  assert.equal(floorDiv(-1, 4), -1);
  assert.equal(positiveModulo(-1, 4), 3);
  assert.deepEqual(cellToChunk(-1, -5, 4), {
    chunkX: -1,
    chunkZ: -2,
    localX: 3,
    localZ: 3,
  });
  assert.equal(chunkKey(-12, 9), '-12:9');
});

test('neighboring chunks share canonical edge heights', () => {
  const store = createStore();
  const left = store.getChunk(0, 0);
  const right = store.getChunk(1, 0);
  const vertexSize = store.chunkSize + 1;
  for (let z = 0; z <= store.chunkSize; z += 1) {
    assert.equal(
      left.heights[z * vertexSize + store.chunkSize],
      right.heights[z * vertexSize],
    );
  }

  store.setHeight(4, 2, 17.5);
  assert.equal(left.heights[2 * vertexSize + 4], 17.5);
  assert.equal(right.heights[2 * vertexSize], 17.5);
});

test('clean generated pages are bounded by the LRU cache', () => {
  const store = createStore();
  store.getChunk(0, 0);
  store.getChunk(1, 0);
  store.getChunk(2, 0);
  store.getChunk(3, 0);
  assert.equal(store.getStats().cacheSize, 3);
});

test('sparse overrides survive eviction and document round trip', () => {
  const store = createStore({ cacheLimit: 1 });
  store.setTile(-7, 12, 9);
  store.setHeight(-6, 13, 23.25);
  store.getChunk(-2, 3);
  store.getChunk(9, 9);
  assert.equal(store.getTile(-7, 12), 9);
  assert.equal(store.getHeight(-6, 13), 23.25);

  const document = store.toDocument();
  const restored = createStore();
  restored.loadDocument(document);
  assert.equal(restored.getTile(-7, 12), 9);
  assert.equal(restored.getHeight(-6, 13), 23.25);
  assert.equal(restored.toDocument().chunks.length, document.chunks.length);
});

test('older dense native documents are rejected', () => {
  const store = createStore();
  assert.throws(
    () => store.loadDocument({
      version: 5,
      width: 2,
      height: 2,
      tileSize: 2,
      tiles: [3, 4, 5, 6],
      heightfield: {
        width: 2,
        height: 2,
        values: [[4, 7]],
      },
    }),
    /older dense map format/,
  );
});

test('painting and sculpting patches undo across chunk borders', () => {
  const store = createStore();
  const tileBefore = store.getTile(3, 0);
  const tilePatch = store.paintSquare(4, 0, 3, 3);
  assert.equal(store.getTile(3, 0), 3);
  assert.equal(store.getTile(5, 0), 3);
  store.applyTilePatch(tilePatch, 'undo');
  assert.equal(store.getTile(3, 0), tileBefore);

  const heightBefore = store.getHeight(4, 0);
  const heightPatch = store.sculpt({
    centerX: 4,
    centerZ: 0,
    brushSize: 3,
    operation: 'raise',
    strength: 2,
    smoothFactor: 0.5,
    minHeight: -100,
    maxHeight: 100,
  });
  assert.ok(store.getHeight(4, 0) > heightBefore);
  store.applyHeightPatch(heightPatch, 'undo');
  assert.equal(store.getHeight(4, 0), heightBefore);
});

test('cube sculpting includes footprint corners that sphere sculpting excludes', () => {
  const sphereStore = createStore();
  const cubeStore = createStore();
  const cornerX = -1;
  const cornerZ = -1;
  const sphereBefore = sphereStore.getHeight(cornerX, cornerZ);
  const cubeBefore = cubeStore.getHeight(cornerX, cornerZ);
  const options = {
    centerX: 0,
    centerZ: 0,
    brushSize: 3,
    operation: 'raise',
    strength: 2,
    smoothFactor: 0.5,
    minHeight: -100,
    maxHeight: 100,
  };

  sphereStore.sculpt({ ...options, shape: 'sphere' });
  cubeStore.sculpt({ ...options, shape: 'cube' });

  assert.equal(sphereStore.getHeight(cornerX, cornerZ), sphereBefore);
  assert.ok(cubeStore.getHeight(cornerX, cornerZ) > cubeBefore);
});
