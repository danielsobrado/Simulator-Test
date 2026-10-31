import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { MeadowGrassBatches } from '../src/editor/stylized/meadow/MeadowGrassBatches.js';
import { MeadowPublicationBudget } from '../src/editor/stylized/meadow/MeadowPublicationBudget.js';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

function fixture(t) {
  const template = createMeadowTemplate({ detail: 2, count: 4096, tileSize: 8 });
  const material = new MeshBasicNodeMaterial();
  const batches = new MeadowGrassBatches({ scene: new Scene(), templates: { low: template }, material,
    name: 'retirement', boundsPadding: 1 });
  const tiles = Array.from({ length: 48 }, (_, i) => ({ buildId: 1, builtBand: 'low', renderX: i * 8, renderZ: 0,
    output: { count: 1024 + i % 5 * 128, position: new Float32Array(4096 * 4).fill(i),
      rotation: new Float32Array(4096 * 2), data: new Float32Array(4096 * 4), minHeight: 0, maxHeight: i } }));
  const commit = (members, budget) => { batches.begin(); for (const tile of members) batches.add('low', tile); return batches.commit(budget); };
  commit(tiles);
  t.after(() => { batches.dispose(); material.dispose(); template.dispose(); });
  return { batches, tiles, commit, pages: batches.batches.get('low').pages };
}

test('variable-count retirement repacks share one allowance and preserve complete resident data', t => {
  const f = fixture(t), survivors = f.tiles.filter((_, i) => i % 16 !== 1);
  const limit = 96 * 1024, budget = new MeadowPublicationBudget(limit);
  PerfCounters.reset();
  f.commit(survivors, budget);
  assert.ok(f.batches.pending > 0, 'other page rewrites wait instead of bursting in one frame');
  assert.ok(budget.used > 0);
  assert.equal(PerfCounters.get('meadowRepackBytes'), budget.used);
  const first = budget.used;
  f.commit(survivors, budget);
  assert.equal(budget.used, first, 'a repeated preparation pass cannot renew the frame allowance');
  let frames = 1;
  while (f.batches.pending) {
    budget.reset(limit); f.commit(survivors, budget); frames++;
    assert.ok(frames < 10);
    // At most one page exceeds the limit; all pages retain their original capacity.
    assert.ok(budget.used <= Math.max(limit, 65536 * 56));
  }
  assert.ok(frames > 1);
  assert.equal(f.pages.reduce((n, page) => n + page.geometry.instanceCount, 0),
    survivors.reduce((n, tile) => n + tile.output.count, 0));
  for (const tile of survivors) {
    assert.ok(f.batches.isPublished(tile));
    const page = f.batches.batches.get('low').slots.get(tile), slot = page.slots.get(tile);
    const positions = page.geometry.getAttribute('instancePosition').array;
    assert.equal(slot.ranges.reduce((n, range) => n + range.count, 0), tile.output.count);
    for (const { start, count, offset } of slot.ranges) {
      assert.deepEqual(positions.subarray(start * 4, (start + count) * 4),
        tile.output.position.subarray(offset * 4, (offset + count) * 4));
    }
  }
});

test('retiring a tile from a variable-count page moves at most its own stems', t => {
  const f = fixture(t), page = f.pages[0];
  const retired = page.order[0], survivors = f.tiles.filter(tile => tile !== retired);
  PerfCounters.reset();
  f.commit(survivors);
  assert.ok(PerfCounters.get('meadowRepackBytes') <= retired.output.count * 56);
  const runs = page.order.flatMap(tile => page.slots.get(tile).ranges).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const { start, count } of runs) { assert.equal(start, cursor); cursor += count; }
  assert.equal(cursor, page.geometry.instanceCount, 'no hole enters the draw');
  const origins = page.geometry.getAttribute('instanceTile').array;
  for (const tile of page.order) for (const { start, count } of page.slots.get(tile).ranges) {
    for (let i = start; i < start + count; i += 1) assert.equal(origins[i * 4], tile.renderX);
  }
});

test('a resized tile leaves the other tiles in place', t => {
  const f = fixture(t), page = f.pages[0], tile = page.order[0];
  const resident = page.order.slice(1).map(other => [other, structuredClone(page.slots.get(other).ranges)]);
  tile.output = { ...tile.output, count: tile.output.count + 64 };
  tile.buildId += 1;
  PerfCounters.reset();
  f.commit(f.tiles);
  assert.equal(PerfCounters.get('meadowRepackBytes'), 0);
  for (const [other, ranges] of resident) assert.deepEqual(page.slots.get(other).ranges, ranges);
  assert.equal(page.slots.get(tile).ranges.reduce((n, range) => n + range.count, 0), tile.output.count);
});

test('origin maintenance is charged before optional work and keeps deferred pages spatially correct', t => {
  const f = fixture(t), budget = new MeadowPublicationBudget(1024);
  const versions = f.pages.map(p => p.geometry.getAttribute('instancePosition').version);
  const before = f.pages.map(p => ({ x: p.geometry.getAttribute('instanceTile').array[0],
    boundX: p.geometry.boundingBox.min.x }));
  f.batches.rebase(-4096, 4096, budget);
  assert.ok(budget.used > budget.limit);
  assert.equal(budget.take(56), false, 'mandatory work leaves no optional publication allowance');
  f.pages.forEach((page, i) => {
    assert.equal(page.geometry.getAttribute('instancePosition').version, versions[i]);
    assert.equal(page.geometry.getAttribute('instanceTile').array[0], before[i].x - 4096);
    assert.equal(page.geometry.boundingBox.min.x, before[i].boundX - 4096);
  });
});

test('random tile churn keeps every drawn stem owned, in place and carrying its tile origin', t => {
  const f = fixture(t), band = f.batches.batches.get('low');
  let seed = 7;
  const roll = limit => { seed = (seed * 48271) % 2147483647; return seed % limit; };
  for (let round = 0; round < 200; round += 1) {
    const members = f.tiles.filter(() => roll(4) > 0);
    const tile = members[roll(members.length)];
    tile.output = { ...tile.output, count: 256 + roll(1800) };
    tile.buildId += 1;
    f.commit(members);
    for (const page of f.pages) {
      const runs = [...page.slots.values()].flatMap(slot => slot.ranges).sort((a, b) => a.start - b.start);
      let cursor = 0;
      for (const { start, count } of runs) { assert.equal(start, cursor); cursor += count; }
      assert.equal(cursor, page.geometry.instanceCount);
      const positions = page.geometry.getAttribute('instancePosition').array;
      const origins = page.geometry.getAttribute('instanceTile').array;
      for (const [owner, slot] of page.slots) for (const { start, count, offset } of slot.ranges) {
        assert.equal(origins[start * 4], owner.renderX);
        assert.equal(origins[(start + count - 1) * 4], owner.renderX);
        assert.equal(positions[start * 4], owner.output.position[offset * 4]);
      }
    }
    assert.equal(band.slots.size, members.length);
  }
});
