import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshBasicNodeMaterial, Scene } from 'three/webgpu';
import { MeadowBandBatch } from '../src/editor/stylized/meadow/MeadowBandBatch.js';
import { MeadowGrassBatches } from '../src/editor/stylized/meadow/MeadowGrassBatches.js';
import { meadowPageUpdatePlan } from '../src/editor/stylized/meadow/MeadowPageUpdatePlan.js';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

// Expected values below were recorded from the plan and page code before the
// allocation-free unchanged path existed. Ranges are [start, count, offset].
const ATTRIBUTES = ['instancePosition', 'instanceRotation', 'instanceData', 'instanceTile'];
const runs = ranges => ranges.map(({ start, count, offset }) => [start, count, offset]);
const names = tiles => [...tiles].map(tile => tile.name);
const planOf = plan => ({ present: names(plan.present).sort(), order: names(plan.order),
  writes: plan.writes.map(w => [w.tile.name, w.count, w.source, runs(w.ranges), runs(w.sourceRanges), w.metadata]),
  count: plan.count, bytes: plan.bytes, repackBytes: plan.repackBytes });

function fixture(t) {
  const template = createMeadowTemplate({ detail: 2, count: 64, tileSize: 8 });
  const material = new MeshBasicNodeMaterial();
  const page = new MeadowBandBatch({ scene: new Scene(), template, material, name: 'plan' });
  t.after(() => { page.dispose(); template.dispose(); material.dispose(); });
  const tile = (name, count, renderX) => ({ name, buildId: 1, renderX, renderZ: 0, output: { count,
    position: new Float32Array(count * 4), rotation: new Float32Array(count * 2), data: new Float32Array(count * 4) } });
  return { page, tile, a: tile('a', 10, 0), u: tile('u', 30, 8), c: tile('c', 4, 16) };
}

function stateOf(page) {
  const state = { order: names(page.order),
    slots: [...page.slots].map(([tile, slot]) => [tile.name, runs(slot.ranges), slot.count, slot.source, slot.renderX]),
    instanceCount: page.geometry.instanceCount,
    uploads: ATTRIBUTES.map(name => page.geometry.getAttribute(name).updateRanges.map(r => [r.start, r.count])),
    repackBytes: PerfCounters.get('meadowRepackBytes'), uploadedBytes: PerfCounters.get('meadowAttributeBytesUploaded') };
  for (const name of ATTRIBUTES) page.geometry.getAttribute(name).clearUpdateRanges();
  return state;
}

const none = [[], [], [], []];
// An unchanged page now plans no writes. The recorded plan listed one write per
// tile with its current runs, no source runs and no metadata, which update applied
// as no-ops; the recorded page state after each step is what proves equivalence.
const STEPS = [
  ['two new tiles', f => [f.a, f.u],
    { present: ['a', 'u'], order: ['a', 'u'], writes: [['a', 10, 1, [[0, 10, 0]], [[0, 10, 0]], true],
      ['u', 30, 1, [[10, 30, 0]], [[10, 30, 0]], true]], count: 40, bytes: 2240, repackBytes: 0 },
    { order: ['a', 'u'], slots: [['a', [[0, 10, 0]], 10, 1, 0], ['u', [[10, 30, 0]], 30, 1, 8]], instanceCount: 40,
      uploads: [[[0, 160]], [[0, 80]], [[0, 160]], [[0, 160]]], repackBytes: 0, uploadedBytes: 2240 }],
  ['unchanged', f => [f.a, f.u],
    { present: ['a', 'u'], order: ['a', 'u'], writes: [], count: 40, bytes: 0, repackBytes: 0 },
    { order: ['a', 'u'], slots: [['a', [[0, 10, 0]], 10, 1, 0], ['u', [[10, 30, 0]], 30, 1, 8]], instanceCount: 40,
      uploads: none, repackBytes: 0, uploadedBytes: 0 }],
  ['unchanged, reordered input', f => [f.u, f.a],
    { present: ['a', 'u'], order: ['a', 'u'], writes: [], count: 40, bytes: 0, repackBytes: 0 },
    { order: ['a', 'u'], slots: [['a', [[0, 10, 0]], 10, 1, 0], ['u', [[10, 30, 0]], 30, 1, 8]], instanceCount: 40,
      uploads: none, repackBytes: 0, uploadedBytes: 0 }],
  ['rebuilt and grown tile', f => { f.a.buildId = 2; f.a.output = f.tile('a', 15, 0).output; return [f.a, f.u]; },
    { present: ['a', 'u'], order: ['u', 'a'], writes: [['u', 30, 1, [[10, 30, 0]], [], false],
      ['a', 15, 2, [[0, 10, 0], [40, 5, 10]], [[0, 10, 0], [40, 5, 10]], true]], count: 45, bytes: 840, repackBytes: 0 },
    { order: ['u', 'a'], slots: [['a', [[0, 10, 0], [40, 5, 10]], 15, 2, 0], ['u', [[10, 30, 0]], 30, 1, 8]],
      instanceCount: 45, uploads: [[[0, 40], [160, 20]], [[0, 20], [80, 10]], [[0, 40], [160, 20]], [[0, 40], [160, 20]]],
      repackBytes: 0, uploadedBytes: 840 }],
  // The rebuild left `order` unlike the slot order, so this full rebuild restores it.
  ['unchanged after a rebuild reordered the page', f => [f.a, f.u],
    { present: ['a', 'u'], order: ['a', 'u'], writes: [['a', 15, 2, [[0, 10, 0], [40, 5, 10]], [], false],
      ['u', 30, 1, [[10, 30, 0]], [], false]], count: 45, bytes: 0, repackBytes: 0 },
    { order: ['a', 'u'], slots: [['a', [[0, 10, 0], [40, 5, 10]], 15, 2, 0], ['u', [[10, 30, 0]], 30, 1, 8]],
      instanceCount: 45, uploads: none, repackBytes: 0, uploadedBytes: 0 }],
  ['retired tile', f => [f.a],
    { present: ['a'], order: ['a'], writes: [['a', 15, 2, [[0, 10, 0], [10, 5, 10]], [[10, 5, 10]], false]],
      count: 15, bytes: 280, repackBytes: 280 },
    { order: ['a'], slots: [['a', [[0, 10, 0], [10, 5, 10]], 15, 2, 0]], instanceCount: 15,
      uploads: [[[40, 20]], [[20, 10]], [[40, 20]], [[40, 20]]], repackBytes: 280, uploadedBytes: 280 }],
  // The moved run continues the resident one, so the full rebuild merges them.
  ['unchanged after a tail move', f => [f.a],
    { present: ['a'], order: ['a'], writes: [['a', 15, 2, [[0, 15, 0]], [], false]], count: 15, bytes: 0, repackBytes: 0 },
    { order: ['a'], slots: [['a', [[0, 15, 0]], 15, 2, 0]], instanceCount: 15, uploads: none, repackBytes: 0, uploadedBytes: 0 }],
  ['one tile added', f => [f.a, f.c],
    { present: ['a', 'c'], order: ['a', 'c'], writes: [['a', 15, 2, [[0, 15, 0]], [], false],
      ['c', 4, 1, [[15, 4, 0]], [[15, 4, 0]], true]], count: 19, bytes: 224, repackBytes: 0 },
    { order: ['a', 'c'], slots: [['a', [[0, 15, 0]], 15, 2, 0], ['c', [[15, 4, 0]], 4, 1, 16]], instanceCount: 19,
      uploads: [[[60, 16]], [[30, 8]], [[60, 16]], [[60, 16]]], repackBytes: 0, uploadedBytes: 224 }],
  ['moved origin', f => { f.c.renderX = 24; return [f.a, f.c]; },
    { present: ['a', 'c'], order: ['a', 'c'], writes: [['a', 15, 2, [[0, 15, 0]], [], false],
      ['c', 4, 1, [[15, 4, 0]], [], true]], count: 19, bytes: 64, repackBytes: 0 },
    { order: ['a', 'c'], slots: [['a', [[0, 15, 0]], 15, 2, 0], ['c', [[15, 4, 0]], 4, 1, 24]], instanceCount: 19,
      uploads: [[], [], [], [[60, 16]]], repackBytes: 0, uploadedBytes: 64 }],
  ['all retired', () => [],
    { present: [], order: [], writes: [], count: 0, bytes: 0, repackBytes: 0 },
    { order: [], slots: [], instanceCount: 0, uploads: none, repackBytes: 0, uploadedBytes: 0 }],
];

test('page plans and commits match the recorded ranges, bytes and counters', t => {
  const f = fixture(t);
  for (const [label, members, plan, state] of STEPS) {
    const tiles = members(f);
    assert.deepEqual(planOf(meadowPageUpdatePlan(f.page, tiles)), plan, label);
    PerfCounters.reset();
    f.page.update(tiles);
    assert.deepEqual(stateOf(f.page), state, label);
  }
});

test('consecutive plans for different inputs share no state', t => {
  const f = fixture(t);
  f.page.update([f.a, f.u]);
  const slots = structuredClone([...f.page.slots.values()]);
  const unchanged = planOf(meadowPageUpdatePlan(f.page, [f.a, f.u]));
  assert.deepEqual(planOf(meadowPageUpdatePlan(f.page, [f.u])), { present: ['u'], order: ['u'],
    writes: [['u', 30, 1, [[10, 20, 0], [0, 10, 20]], [[0, 10, 20]], false]], count: 30, bytes: 560, repackBytes: 560 });
  assert.deepEqual(planOf(meadowPageUpdatePlan(f.page, [f.a, f.u, f.c])), { present: ['a', 'c', 'u'], order: ['a', 'u', 'c'],
    writes: [['a', 10, 1, [[0, 10, 0]], [], false], ['u', 30, 1, [[10, 30, 0]], [], false],
      ['c', 4, 1, [[40, 4, 0]], [[40, 4, 0]], true]], count: 44, bytes: 224, repackBytes: 0 });
  assert.deepEqual(planOf(meadowPageUpdatePlan(f.page, [f.a, f.u])), unchanged);
  assert.deepEqual([...f.page.slots.values()], slots, 'planning never edits the page');
});

test('band retirement rebuilds its member set only from a changed member list', t => {
  const template = createMeadowTemplate({ detail: 2, count: 64, tileSize: 8 });
  const material = new MeshBasicNodeMaterial();
  const batches = new MeadowGrassBatches({ scene: new Scene(), templates: { low: template }, material, name: 'retire' });
  t.after(() => { batches.dispose(); template.dispose(); material.dispose(); });
  const { a, u } = fixture(t), band = batches.batches.get('low');
  const commit = tiles => { batches.begin(); for (const tile of tiles) batches.add('low', tile); batches.commit(); };
  const members = () => [names(band.present), names(band.slots.keys()), band.pages[0].memberCount];
  commit([a, u]);
  commit([a, u]);
  assert.deepEqual(members(), [['a', 'u'], ['a', 'u'], 2]);
  band.retireTiles([u, a]);
  assert.deepEqual(members(), [['u', 'a'], ['a', 'u'], 2]);
  band.retireTiles([a, a]);
  assert.deepEqual(members(), [['a'], ['a'], 1], 'a repeated tile still retires the missing one');
});
