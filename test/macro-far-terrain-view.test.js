import assert from 'node:assert/strict';
import test from 'node:test';
import { MacroFarTerrainView } from '../src/editor/world/MacroFarTerrainView.js';
import { Scene } from 'three/webgpu';

function createHarness(originRef, fieldRef) {
  const view = Object.create(MacroFarTerrainView.prototype);
  view.enabled = true;
  view.generator = {};
  view.preparation = { plans: { release() {} } };
  view.ensureGenerator = () => view.generator;
  view.mesh = { visible: false };
  view.floatingOrigin = { getState: () => originRef.current };
  view.forestFieldProvider = () => fieldRef.current;
  view.builtOriginX = null;
  view.builtOriginZ = null;
  view.builtForestSignature = null;
  view.pendingHeights = new Float32Array(1);
  view.pendingTileIds = new Int32Array(1);
  view.pendingForest = new Float32Array(1);
  view.advanceCount = 0;
  view.advanceJob = () => {
    view.advanceCount += 1;
    return false;
  };
  return view;
}

test('MacroFarTerrainView restarts an active rebuild when the floating origin changes', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const staleJob = view.job;

  originRef.current = { x: 256, z: -128 };
  view.update();

  assert.notStrictEqual(view.job, staleJob);
  assert.equal(view.job.originX, 256);
  assert.equal(view.job.originZ, -128);
  assert.strictEqual(view.job.field, fieldRef.current);
  assert.equal(view.job.forestSignature, 'forest-a');
  assert.equal(view.advanceCount, 1);
});

test('MacroFarTerrainView restarts an active rebuild when the forest field changes', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const staleJob = view.job;
  const nextField = { signature: 'forest-b' };

  fieldRef.current = nextField;
  view.update();

  assert.notStrictEqual(view.job, staleJob);
  assert.strictEqual(view.job.field, nextField);
  assert.equal(view.job.forestSignature, 'forest-b');
  assert.equal(view.advanceCount, 1);
});

test('MacroFarTerrainView continues a current active rebuild without restarting it', () => {
  const originRef = { current: { x: 0, z: 0 } };
  const fieldRef = { current: { signature: 'forest-a' } };
  const view = createHarness(originRef, fieldRef);
  view.startJob(0, 0, fieldRef.current);
  const currentJob = view.job;

  view.update();

  assert.strictEqual(view.job, currentJob);
  assert.equal(view.advanceCount, 1);
});

test('the far ring reads the forest from its own tile, height and slope', () => {
  // Every fine-terrain query here was a trip through the water-terrain model, five
  // per sample; a ring rebuild over forest spent most of its time on them.
  const calls = [];
  const field = {
    signature: 'forest-a',
    sampleCoarse: (x, z, terrain) => {
      calls.push(terrain);
      return { patchCoverage: 1, suitability: terrain.tileId === 6 ? 1 : 0 };
    },
    sample: () => { throw new Error('the far ring must not take the fine, cached sample'); },
  };
  const view = Object.create(MacroFarTerrainView.prototype);
  Object.assign(view, {
    angularResolution: 8,
    radialResolution: 2,
    radii: new Float32Array([100, 200]),
    worldStore: { tileSize: 2 },
    preparation: { plans: { release() {} } },
    heightBias: 0,
    pendingPositions: new Float32Array(2 * 8 * 3),
    pendingColors: new Float32Array(2 * 8 * 3),
    pendingHeights: new Float32Array(16),
    pendingTileIds: new Int32Array(16),
    pendingForest: new Float32Array(16),
    pendingSnow: new Float32Array(16),
    pendingIce: new Float32Array(16),
    pendingNormals: new Float32Array(16 * 3),
    generator: { sampleMacroColumn: (cellX) => ({ height: cellX > 0 ? 40 : 10, tileId: cellX > 0 ? 6 : 4 }) },
    colorForTile: () => ({ r: 0.5, g: 0.5, b: 0.5 }),
    rockSlopeStart: 10, rockSlopeFull: 20, screeColor: { r: 0, g: 0, b: 0 }, rockColor: { r: 0, g: 0, b: 0 },
    snowLine: 1e6, snowFade: 1, snowBiomeCover: [], snowColor: { r: 1, g: 1, b: 1 }, snowSlopeMax: 1,
  });
  for (let ring = 0; ring < 2; ring += 1) {
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = spoke / 8 * Math.PI * 2;
      const offset = (ring * 8 + spoke) * 3;
      view.pendingPositions[offset] = Math.cos(angle) * view.radii[ring];
      view.pendingPositions[offset + 2] = Math.sin(angle) * view.radii[ring];
    }
  }
  view.startJob(0, 0, field);
  for (let ring = 0; ring < 2; ring += 1) view.sampleRing(view.job, ring);
  assert.equal(calls.length, 0, 'the forest is read once the ring slopes exist, not while sampling');
  for (let ring = 0; ring < 2; ring += 1) view.shadeRing(view.job, ring);

  assert.equal(calls.length, 16);
  for (const [index, terrain] of calls.entries()) {
    assert.equal(terrain.tileId, view.job.tileIds[index]);
    assert.equal(terrain.elevation, view.job.heights[index]);
    assert.ok(Number.isFinite(terrain.slope));
  }
  // Wooded samples darken and lift by their canopy; the rest keep their height.
  const east = 0;
  assert.ok(view.job.forest[east] > 0);
  assert.ok(view.pendingPositions[east * 3 + 1] > view.job.heights[east]);
  const west = 4;
  assert.equal(view.job.forest[west], 0);
  assert.equal(view.pendingPositions[west * 3 + 1], view.job.heights[west]);
});


test('MacroFarTerrainView yields between rings while guaranteeing progress', () => {
  const view = Object.create(MacroFarTerrainView.prototype);
  Object.assign(view, {
    radialResolution: 4,
    angularResolution: 8,
    rowsPerFrame: 4,
    worldStore: {},
    job: { sampleRing: 0, shadeRing: 0 },
    sampleRing: (_job, ring) => { view.lastSampled = ring; },
    shadeRing: () => {},
  });

  let checks = 0;
  const done = view.advanceJob(() => ++checks >= 1);

  assert.equal(done, false);
  assert.equal(view.job.sampleRing, 1);
  assert.equal(view.lastSampled, 0);
});

test('large far-terrain rings yield every sixteen samples and preserve exact complete buffers', () => {
  let samples = 0, shades = 0;
  const create = () => {
    const view = new MacroFarTerrainView({ scene: new Scene(), worldStore: { tileSize: 2 },
      floatingOrigin: { getState: () => ({ x: 0, z: 0 }) }, config: {
        world: { farTerrain: { radialResolution: 4, angularResolution: 64, rebuildRowsPerFrame: 4 } },
      } });
    view.generator = { sampleMacroColumn: (x, z) => { samples++; return { height: Math.sin(x) * 30 + z % 3, tileId: 4 }; },
      getTileDefinition: () => ({ color: '#558844' }) };
    view.startJob(1024, 2048, { signature: 'exact', sampleCoarse: () => { shades++; return { patchCoverage: 0.7, suitability: 0.6 }; } });
    return view;
  };
  const reference = create(), sliced = create();
  try {
    for (let ring = 0; ring < 4; ring++) reference.sampleRing(reference.job, ring);
    for (let ring = 0; ring < 4; ring++) reference.shadeRing(reference.job, ring);
    let turns = 0;
    while (sliced.job.sampleRing < 4 || sliced.job.shadeRing < 4) {
      const beforeSamples = samples, beforeShades = shades;
      sliced.advanceJob(() => true);
      assert.ok(samples - beforeSamples <= 16);
      assert.ok(shades - beforeShades <= 16);
      assert.equal(sliced.mesh.visible, false);
      assert.ok(++turns < 1000);
    }
    assert.equal(sliced.advanceJob(() => false), true);
    assert.deepEqual(sliced.positions, reference.pendingPositions);
    assert.deepEqual(sliced.colors, reference.pendingColors);
    assert.equal(sliced.mesh.visible, true);
  } finally { reference.dispose(); sliced.dispose(); }
});

test('snow-country tiles go bare as thawed earth, not their map colour', () => {
  const view = Object.create(MacroFarTerrainView.prototype);
  view.colorCache = new Map();
  view.generator = { getTileDefinition: () => ({ color: '#96784b' }) };
  view.snowBiomeCover = { 9: 0.1, 10: 0.95 };
  view.snowBareColor = { r: 0.04, g: 0.03, b: 0.02 };
  const tundra = view.colorForTile(10), taiga = view.colorForTile(9);
  assert.ok(tundra.r < 0.06 && tundra.r > 0.04);
  assert.ok(taiga.r > 0.2, 'partial-cover biomes keep their own ground');
});
