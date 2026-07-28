import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConstructionMaterialStore,
  constructionRegionId,
  libraryRetentionRegionId,
} from '../src/editor/construction/ConstructionMaterialStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
  + 'AAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function record(id, materials = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id,
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [5, 0], [10, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

/** A store carrying one custom preset backed by an imported image. */
function storeWithCustomPreset() {
  const store = new ConstructionMaterialStore();
  const sourceId = 'albedo-test';
  store.commit({
    ...store.toDocument(),
    materialLibrary: {
      presets: {
        ...store.toDocument().materialLibrary.presets,
        'custom-stone': {
          id: 'custom-stone',
          label: 'Custom stone',
          family: 'stone',
          baseColor: '#8a8172',
          tint: '#ffffff',
          roughness: 0.9,
          metalness: 0,
          normalStrength: 1,
          heightStrength: 0.1,
          weathering: 0.2,
          mapping: 'projected',
          repeat: 1,
          rotation: 0,
          alignment: 'world',
          sources: { albedo: sourceId },
        },
      },
      sources: {
        ...store.toDocument().materialLibrary.sources,
        [sourceId]: { id: sourceId, kind: 'albedo', name: 'test.png', dataUrl: PIXEL_PNG },
      },
    },
    materialAreaOverrides: { 'seed:stone': 'custom-stone' },
  });
  return store;
}

test('a preset referenced only by a construction record survives normalize', () => {
  const store = storeWithCustomPreset();
  assert.ok(store.getPreset('custom-stone'), 'setup should have created the preset');

  // Nothing in the material document itself references it any more — only the
  // wall record does, and the record is not part of that document.
  const walls = [record('construction-1', { stone: 'custom-stone' })];
  store.gc(walls);

  assert.ok(
    store.getPreset('custom-stone'),
    'the GC collected a preset that a wall is still using',
  );
  assert.equal(
    store.document.materialAreaOverrides[constructionRegionId('construction-1', 'stone')],
    'custom-stone',
  );
  // And its imported image came along.
  assert.equal(Object.keys(store.document.materialLibrary.sources).length, 1);
});

test('a library-only preset survives save GC without a wall reference', () => {
  const store = storeWithCustomPreset();
  store.gc([record('construction-1')]);
  assert.ok(
    store.getPreset('custom-stone'),
    'an imported preset waiting to be painted must survive world save',
  );
  assert.equal(
    store.document.materialAreaOverrides[libraryRetentionRegionId('custom-stone')],
    'custom-stone',
  );
  assert.equal(Object.keys(store.document.materialLibrary.sources).length, 1);
});

test('removing a preset from the library drops it and its sources on the next normalize', () => {
  const store = storeWithCustomPreset();
  const before = store.toDocument();
  store.commit({
    ...before,
    materialLibrary: { presets: {}, sources: before.materialLibrary.sources },
    materialAreaOverrides: {},
  });
  assert.equal(store.getPreset('custom-stone'), null);
  assert.deepEqual(store.document.materialLibrary.sources, {});
});

test('the projection survives a full save and reload', () => {
  const store = storeWithCustomPreset();
  const walls = [record('construction-1', { stone: 'custom-stone' })];
  store.gc(walls);
  const saved = store.toDocument();

  const reloaded = new ConstructionMaterialStore();
  reloaded.loadDocument(saved);
  assert.ok(reloaded.getPreset('custom-stone'));
  assert.deepEqual(reloaded.toDocument(), saved, 'the round trip must be exact');
});

test('gc ignores a record naming a preset that does not exist', () => {
  const store = storeWithCustomPreset();
  // A record can outlive its preset — a save edited by hand, or a preset
  // removed in another session. It must not throw on the next save.
  store.gc([record('construction-1', { stone: 'ghost-preset' })]);
  assert.equal(
    store.document.materialAreaOverrides[constructionRegionId('construction-1', 'stone')],
    undefined,
  );
});

test('region ids are valid material region keys', () => {
  assert.equal(constructionRegionId('construction-12', 'stone'), 'construction-12:stone');
  assert.match(constructionRegionId('construction-12', 'stone'), /^[a-z0-9][a-z0-9:-]{0,159}$/);
  assert.match(libraryRetentionRegionId('custom-stone'), /^[a-z0-9][a-z0-9:-]{0,159}$/);
});

test('library edits use their own bounded history, not world history', () => {
  const store = new ConstructionMaterialStore();
  const before = store.toDocument();
  const changed = store.commit({
    ...before,
    materialDefaults: { ...before.materialDefaults, stone: 'granite-masonry' },
  });
  assert.equal(changed, true);
  assert.notDeepEqual(store.toDocument(), before);

  assert.equal(store.undo(), true);
  assert.deepEqual(store.toDocument(), before);
  assert.equal(store.redo(), true);
  assert.notDeepEqual(store.toDocument(), before);

  // Committing an identical document is a no-op rather than a history entry.
  assert.equal(store.commit(store.toDocument()), false);
});

test('undo and redo report honestly when there is nothing to do', () => {
  const store = new ConstructionMaterialStore();
  assert.equal(store.undo(), false);
  assert.equal(store.redo(), false);
});

test('the source budget is reported so a user hitting the cap knows why', () => {
  const store = storeWithCustomPreset();
  const budget = store.sourceBudget();
  assert.equal(budget.count, 1);
  assert.ok(budget.used > 0);
  assert.equal(budget.limit, 2_400_000);
  assert.equal(budget.maxCount, 16);
});
