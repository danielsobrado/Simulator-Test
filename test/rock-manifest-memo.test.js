import assert from 'node:assert/strict';
import test from 'node:test';
import { RockManifestStore } from '../src/editor/stylized/RockManifestStore.js';
import { StylizedRockView } from '../src/editor/stylized/StylizedRockView.js';

function keyFixture() {
  let joins = 0;
  const tracker = { revision: 0, signature: (x, z, h) => { joins++; return `w${x},${z},${h},${tracker.revision}`; } };
  const view = {
    revisionTracker: tracker, prototypes: [1, 2], clusterField: { signature: 'c' },
    regionalCharacterField: { signature: 'r' }, prototypeBiomeRulesSignature: 'rules',
    pathClearance: { signature: 'p' }, biomeAssetPalette: { revision: 3 }, riverRocks: { signature: 'rivers-1' },
  };
  const key = (x, z) => StylizedRockView.prototype.manifestKey.call(view, x, z);
  return { view, tracker, key, joins: () => joins };
}

test('manifestKey keeps its format, is reused when nothing changed and changes with each input', () => {
  const { view, tracker, key, joins } = keyFixture();
  const first = key(1, -2);
  assert.equal(first, 'w1,-2,1,0|2|c|r|rules|p|3|rivers-1');
  for (let i = 0; i < 50; i++) assert.equal(key(1, -2), first);
  assert.equal(joins(), 1, 'tracker signature is not rebuilt while inputs are identical');
  assert.notEqual(key(-2, 1), first, 'different chunks do not share a memo');
  const mutations = [
    () => tracker.revision++, () => view.prototypes.push(3), () => { view.clusterField = { signature: 'c2' }; },
    () => { view.regionalCharacterField = { signature: 'r2' }; }, () => { view.prototypeBiomeRulesSignature = 'x'; },
    () => { view.pathClearance = { signature: 'p2' }; }, () => view.biomeAssetPalette.revision++,
    () => { view.riverRocks = { signature: 'rivers-2' }; },
  ];
  let previous = key(1, -2);
  for (const mutate of mutations) {
    mutate();
    const next = key(1, -2);
    assert.notEqual(next, previous);
    previous = next;
  }
});

test('manifestKey without a tracker revision counter always rebuilds', () => {
  const { tracker, key, joins } = keyFixture();
  delete tracker.revision;
  key(0, 0); key(0, 0);
  assert.equal(joins(), 2);
});

function haloFixture() {
  const view = {
    prototypes: [1], config: {}, revisionTracker: { revision: 0 }, prototypeRevision: 0,
    manifestBuildBudgetMs: 1, manifestKey: () => 'k', terrainView: {},
  };
  const store = new RockManifestStore(view);
  store.window = { x: 0, z: 0, radius: 5 };
  let reads = 0;
  const entry = (x, z, signature) => {
    const placements = Object.freeze([{ x, z }]);
    const value = { key: 'k', placements, signature, used: 0 };
    Object.defineProperty(value, 'signature', { get() { reads++; return signature; } });
    store.cache.set(`${x}:${z}`, value);
    return value;
  };
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) entry(x, z, `s${x}${z}`);
  return { store, view, entry, reads: () => reads };
}

test('blockerSnapshot keeps its signature, skips re-joining for identical entries and tracks entry changes', () => {
  const { store, view, entry, reads } = haloFixture();
  const first = store.blockerSnapshot(0, 0);
  assert.equal(first.signature, 's-1-1|s0-1|s1-1|s-10|s00|s10|s-11|s01|s11');
  assert.equal(first.placements.length, 9);
  const baseline = reads();
  view.prototypeRevision++; // token changes, entries do not
  const second = store.blockerSnapshot(0, 0);
  assert.equal(second, first, 'same signature reuses the snapshot');
  assert.equal(reads(), baseline, 'signatures are not read again for identical entries');
  entry(1, 1, 'changed');
  view.prototypeRevision++;
  const third = store.blockerSnapshot(0, 0);
  assert.notEqual(third, first);
  assert.equal(third.signature, 's-1-1|s0-1|s1-1|s-10|s00|s10|s-11|s01|changed');
});
