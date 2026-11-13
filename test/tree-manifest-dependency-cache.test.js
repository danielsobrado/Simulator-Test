import assert from 'node:assert/strict';
import test from 'node:test';
import { TreeManifestStore } from '../src/editor/stylized/TreeManifestStore.js';

function fixture() {
  const edits = {};
  const store = Object.assign(Object.create(TreeManifestStore.prototype), {
    terrainView: { worldStore: { forestEdits: edits } }, editDocumentRef: edits,
    editStore: { revision: 0 }, editRevisions: { signature: () => 'edits' },
    contextCache: new Map(), revisionTracker: { revision: 0, signature: () => 'world' },
    objectMap: { revision: 0 }, prototypeCount: 29, config: { trees: { clearRadius: 2 } },
    forestField: { signature: 'forest' }, speciesRegistry: { signature: 'species' },
    pathClearance: { signature: 'paths' }, constructionQueryBounds: () => ({}), constructionBlockers: () => [],
  });
  let calls = 0, ready = false;
  const rocks = { manifestStore: { version: 0, window: {} }, prototypeRevision: 0,
    biomeAssetPalette: { revision: 0 }, blockerSnapshotForChunk() {
      calls++; return ready ? { placements: [], signature: 'rocks' } : null;
    } };
  return { store, rocks, calls: () => calls, ready: () => { ready = true; } };
}

test('waiting contexts are cheap until completion, edits, assets or the dependency window change', () => {
  const { store, rocks, calls, ready } = fixture();
  for (let i=0;i<100;i++) assert.equal(store.context(0,0,rocks),null);
  assert.equal(calls(),1);
  const mutations = [() => rocks.manifestStore.version++, () => store.revisionTracker.revision++,
    () => store.objectMap.revision++, () => rocks.prototypeRevision++, () => rocks.biomeAssetPalette.revision++,
    () => store.editStore.revision++, () => store.prototypeCount++, () => { rocks.manifestStore.window = {}; }];
  for (const [i, mutate] of mutations.entries()) {
    mutate(); assert.equal(store.context(0,0,rocks),null);assert.equal(calls(),i+2);
  }
  ready();rocks.manifestStore.version++;
  const context = store.context(0,0,rocks);
  assert.ok(context);assert.deepEqual(context.blockers,[]);
  assert.equal(store.context(0,0,rocks),context,'a completed context also remains cached');
  assert.equal(calls(),10);
});

test('context input signature is unchanged in format, reused while inputs hold, and tracks each input', () => {
  const { store, rocks, ready } = fixture();
  let worldJoins = 0, editJoins = 0;
  store.revisionTracker.signature = () => { worldJoins++; return `world${store.revisionTracker.revision}`; };
  Object.assign(store.editRevisions, { epoch: 0, clock: 0,
    signature: () => { editJoins++; return `edits${store.editRevisions.clock}`; } });
  ready();
  const first = store.context(0, 0, rocks);
  assert.equal(store.contextCache.get('0:0').inputSignature, 'world0|rocks|0|29|forest|species|paths|edits0');
  // Changing only the rock manifest version misses the fast path but no input moved.
  for (let i = 0; i < 20; i++) { rocks.manifestStore.version++; assert.equal(store.context(0, 0, rocks), first); }
  assert.equal(worldJoins, 1);
  assert.equal(editJoins, 1);
  store.revisionTracker.revision++; rocks.manifestStore.version++;
  assert.notEqual(store.context(0, 0, rocks).signature, first.signature);
  assert.equal(worldJoins, 2);
  store.editRevisions.clock++; rocks.manifestStore.version++;
  store.context(0, 0, rocks);
  assert.equal(editJoins, 2);
  assert.equal(store.contextCache.get('0:0').inputSignature, 'world1|rocks|0|29|forest|species|paths|edits1');
  store.forestField = { signature: 'forest2' }; rocks.manifestStore.version++;
  store.context(0, 0, rocks);
  assert.equal(store.contextCache.get('0:0').inputSignature, 'world1|rocks|0|29|forest2|species|paths|edits1');
});

test('blocked rock contexts do not repeatedly request a prepared halo; ready contexts still require it', () => {
  const { store, rocks, ready } = fixture();
  let requests = 0;
  store.terrainView.preparedPlacement = { ensureChunk() { requests++; return false; } };
  for(let i=0;i<100;i++) assert.equal(store.build(0,0,rocks),null);
  assert.equal(requests,0);
  ready();rocks.manifestStore.version++;
  assert.equal(store.build(0,0,rocks),null);
  assert.equal(requests,1,'generation must wait for its canonical prepared fields');
});
