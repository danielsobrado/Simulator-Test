import assert from 'node:assert/strict';
import test from 'node:test';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import {
  getCanonicalWater,
  getWorldWater,
  installTerrainWaterQueries,
} from '../src/editor/water/TerrainWaterQueries.js';
import { WATER_KIND_NONE, WATER_KIND_OCEAN } from '../src/editor/water/WaterConstants.js';

function createTerrainView({ seaLevel = -1.5 } = {}) {
  const generator = new ProceduralWorldGenerator({ seed: 918273, seaLevel });
  let heightOverride = null;
  let tileOverride = null;
  const worldStore = {
    tileSize: 2,
    generator,
    sampleHeight: (cellX, cellZ) => (
      heightOverride ?? generator.sampleWater(cellX, cellZ).bedHeight
    ),
    getTile: (cellX, cellZ) => tileOverride ?? generator.sampleTile(cellX, cellZ),
    setHeight: (_x, _z, value) => {
      heightOverride = value;
    },
    setTile: (_x, _z, value) => {
      tileOverride = value;
    },
  };
  return {
    worldStore,
    floatingOrigin: new FloatingOrigin({ threshold: 64, snapSize: 64 }),
  };
}

test('render-space water queries remain stable across floating-origin rebases', () => {
  const terrainView = createTerrainView();
  const canonical = { x: 130.5, z: -74.25 };
  const beforeRender = terrainView.floatingOrigin.toRender(canonical.x, canonical.z);
  const before = getWorldWater(terrainView, beforeRender.x, beforeRender.z);

  terrainView.floatingOrigin.setOrigin(128, -64);
  const afterRender = terrainView.floatingOrigin.toRender(canonical.x, canonical.z);
  const after = getWorldWater(terrainView, afterRender.x, afterRender.z);

  assert.deepEqual(after, before);
  assert.deepEqual(after, getCanonicalWater(terrainView, canonical.x, canonical.z));
});

test('terrain-view installation exposes canonical and render-space methods', () => {
  const terrainView = installTerrainWaterQueries(createTerrainView());
  terrainView.floatingOrigin.setOrigin(64, 64);
  const render = { x: 12, z: -8 };
  const canonical = terrainView.floatingOrigin.toCanonical(render.x, render.z);

  assert.deepEqual(
    terrainView.getWorldWater(render.x, render.z),
    terrainView.getCanonicalWater(canonical.x, canonical.z),
  );
});

test('terrain water queries consume live tile and height overrides', () => {
  const terrainView = createTerrainView({ seaLevel: 100 });
  terrainView.worldStore.setHeight(0, 0, 25);

  const water = getCanonicalWater(terrainView, 1, -1);
  assert.equal(water.kind, WATER_KIND_OCEAN);
  assert.equal(water.bedHeight, 25);
  assert.equal(water.depth, 75);

  terrainView.worldStore.setTile(0, 0, 4);
  const land = getCanonicalWater(terrainView, 1, -1);
  assert.equal(land.kind, WATER_KIND_NONE);
  assert.equal(land.bedHeight, 25);
});
