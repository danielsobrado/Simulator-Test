import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, MeshBasicMaterial } from 'three/webgpu';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import { createCompaction } from '../src/editor/stylized/meadow/meadowGrassCompaction.js';
import { compactionPrefix } from '../src/editor/stylized/meadow/MeadowCompactionPrefix.js';
import { MeadowTileLayer } from '../src/editor/stylized/meadow/MeadowTileLayer.js';

function assertOutput(actual, expected) {
  assert.equal(actual.count, expected.count);
  for (const [name, width] of [['position', 4], ['rotation', 2], ['data', 4]]) {
    assert.deepEqual(actual[name].slice(0, actual.count * width), expected[name].slice(0, expected.count * width));
  }
}

test('expanding and truncating a prepared meadow preserves exact survivors and samples only new ranks', () => {
  let samples = 0;
  const sample = (x, z, rank, ground) => {
    samples++;
    Object.assign(ground, { height: x * 0.2 + z * 0.3, strength: 0.8, shape: 2, path: 0.2 });
    return rank % 3 !== 0;
  };
  const low = createMeadowTemplate({ detail: 2, count: 100, tileSize: 8 });
  const high = createMeadowTemplate({ detail: 5, count: 400, tileSize: 8 });
  const options = { centerX: 16000004, centerZ: -7999996, sample };
  const small = createCompaction({ ...options, template: low }); small.advance();
  assert.equal(samples, 100);
  const large = createCompaction({ ...options, template: high, previous: { capacity: 100, output: small.output } });
  while (!large.done) large.advance(17);
  assert.equal(samples, 400);
  const expected = createCompaction({ ...options, template: high }); expected.advance();
  assertOutput(large.output, expected.output);
  assertOutput(compactionPrefix(large.output, 100), small.output);
  low.dispose(); high.dispose();
});

test('band changes reuse ground until its revision changes, preserving complete publications', () => {
  let band = 'high', revision = 0, samples = 0;
  const templates = {
    high: createMeadowTemplate({ detail: 5, count: 100, tileSize: 8 }),
    low: createMeadowTemplate({ detail: 2, count: 40, tileSize: 8 }),
  };
  const material = new MeshBasicMaterial();
  const layer = new MeadowTileLayer({ scene: new Scene(), name: 'test', tileSize: 8,
    templates, material, reach: 0, selectBand: nearest => nearest === 0 ? band : null,
    ground: { revisionAt: () => revision, forTile: () => ({ revision,
      sample: (_x, _z, rank, ground) => { samples++; ground.height = revision; return rank % 2 === 0; } }) } });
  const update = () => layer.update({ x: 4, z: 4 }, { x: 0, z: 0 }, Infinity);
  update(); const initial = [...layer.tiles.values()][0].output;
  assert.equal(samples, 100);
  band = 'low'; update();
  assert.equal(samples, 100);
  assert.equal([...layer.tiles.values()][0].output.count, 20);
  band = 'high'; update();
  assert.equal(samples, 100);
  assertOutput([...layer.tiles.values()][0].output, initial);
  revision++; update();
  assert.equal(samples, 200);
  assert.equal([...layer.tiles.values()][0].output.position[1], 1);
  assert.equal(layer.getState().building, 0);
  layer.dispose(); material.dispose();
});

test('unfinished promotions retain rejected ranks and exact output through repeated LOD changes', t => {
  const templates = Object.fromEntries([['low', 512], ['medium', 2048], ['high', 4096]]
    .map(([band, count]) => [band, createMeadowTemplate({ detail: 3, count, tileSize: 8 })]));
  let samples = 0;
  const sample = (x, z, rank, out) => {
    samples++;
    Object.assign(out, { height: x * 0.2 + z * 0.3, strength: 0.8, shape: 2, path: 0.2 });
    return rank % 3 !== 0;
  };
  const material = new MeshBasicMaterial();
  const layer = new MeadowTileLayer({ scene: new Scene(), name: 'promotion', tileSize: 8,
    templates, material, reach: 0, selectBand: () => 'high',
    ground: { revisionAt: () => 1, forTile: () => ({ revision: 1, sample }) } });
  t.after(() => { layer.dispose(); material.dispose(); Object.values(templates).forEach(g => g.dispose()); });
  const compaction = createCompaction({ template: templates.low, centerX: 4, centerZ: 4, sample });
  compaction.advance(257);
  const tile = { centerX: 4, centerZ: 4, renderX: 4, renderZ: 4, band: 'medium',
    preparationBand: 'medium', preparationCapacity: 2048, revision: 1,
    job: { band: 'low', revision: 1, compaction } };
  layer.tiles.set('0:0', tile);
  layer.rebuildStaleTiles();
  assert.equal(tile.job.compaction, compaction);
  assert.equal(compaction.processedCount, 257);
  compaction.advance(311);
  Object.assign(tile, { band: 'high', preparationBand: 'high', preparationCapacity: 4096 });
  layer.rebuildStaleTiles();
  layer.time = 1;
  layer.buildTiles(layer.staleTiles, Infinity);
  assert.equal(samples, 4096, 'each rank is sampled once, including rejected ranks');
  const expected = createCompaction({ template: templates.high, centerX: 4, centerZ: 4, sample });
  expected.advance();
  assertOutput(tile.output, expected.output);
  assert.equal(tile.output.minHeight, expected.output.minHeight);
  assert.equal(tile.output.maxHeight, expected.output.maxHeight);
});

test('a ground revision discards partial results before a promoted build publishes', t => {
  const low = createMeadowTemplate({ detail: 2, count: 512, tileSize: 8 });
  const high = createMeadowTemplate({ detail: 3, count: 2048, tileSize: 8 });
  let height = 1;
  const sample = (_x, _z, _rank, out) => {
    Object.assign(out, { height, strength: 1, shape: 0, path: 0 }); return true;
  };
  const material = new MeshBasicMaterial();
  const layer = new MeadowTileLayer({ scene: new Scene(), name: 'revision', tileSize: 8,
    templates: { low, high }, material, reach: 0, selectBand: () => 'high',
    ground: { revisionAt: () => 2, forTile: () => ({ revision: 2, sample }) } });
  t.after(() => { layer.dispose(); material.dispose(); low.dispose(); high.dispose(); });
  const compaction = createCompaction({ template: low, centerX: 4, centerZ: 4, sample });
  compaction.advance(257);
  height = 7;
  const tile = { centerX: 4, centerZ: 4, renderX: 4, renderZ: 4, band: 'high',
    preparationBand: 'high', preparationCapacity: 2048, revision: 2,
    job: { band: 'low', revision: 1, compaction } };
  layer.tiles.set('0:0', tile);
  layer.rebuildStaleTiles();
  assert.equal(tile.job, null);
  layer.time = 1;
  layer.buildTiles(layer.staleTiles, Infinity);
  for (let i = 0; i < tile.output.count; i++) assert.equal(tile.output.position[i * 4 + 1], 7);
});

test('a compaction done from its previous prefix alone publishes the prepared prefix, not a null output', t => {
  const templates = {
    high: createMeadowTemplate({ detail: 5, count: 100, tileSize: 8 }),
    low: createMeadowTemplate({ detail: 2, count: 40, tileSize: 8 }),
  };
  const sample = (_x, _z, rank, out) => { Object.assign(out, { height: 1, strength: 1, shape: 0, path: 0 }); return rank % 2 === 0; };
  const material = new MeshBasicMaterial();
  const layer = new MeadowTileLayer({ scene: new Scene(), name: 'prefix-only', tileSize: 8,
    templates, material, reach: 0, selectBand: () => 'low',
    ground: { revisionAt: () => 2, forTile: () => ({ revision: 2, sample }) } });
  t.after(() => { layer.dispose(); material.dispose(); Object.values(templates).forEach(g => g.dispose()); });
  const prepared = createCompaction({ template: templates.high, centerX: 4, centerZ: 4, sample });
  prepared.advance();
  let cancelled = false;
  // A worker compaction whose previous prefix already covers the band: done, no output of its own.
  const compaction = { done: true, output: null, progress: 1, asynchronous: false, advance() {}, cancel() { cancelled = true; } };
  const tile = { centerX: 4, centerZ: 4, renderX: 4, renderZ: 4, band: 'low', preparationBand: 'low',
    preparationCapacity: 40, revision: 1, output: null,
    prepared: { output: prepared.output, capacity: 100, band: 'high', revision: 2 },
    job: { band: 'low', revision: 2, compaction } };
  layer.tiles.set('0:0', tile);
  layer.buildTiles([tile], Infinity);
  assert.equal(cancelled, true);
  assert.equal(tile.job, null);
  assert.equal(tile.prepared.output, prepared.output, 'the prepared buffers stay where they were');
  assertOutput(tile.output, compactionPrefix(prepared.output, 40));
});
