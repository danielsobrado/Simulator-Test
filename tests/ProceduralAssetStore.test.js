import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProceduralAssetRecord,
  normalizeProceduralRecipe,
  ProceduralAssetStore,
} from '../src/editor/workshop/ProceduralAssetStore.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const recipe = {
  archetype: 'gatehouse',
  style: 'granite',
  topStyle: 'terracotta',
  finish: 'masonry',
  shape: 'classic',
  towerSide: 'left',
  width: 8,
  depth: 2,
  height: 5,
  roofScale: 1,
  roofOverhang: 0.35,
  seed: 1848,
  detail: 2,
  weathering: 0.35,
  windows: true,
  ivy: true,
  remesh: true,
  albedo: true,
  surfaceTextures: {
    sources: {},
    slots: {},
  },
  componentTransforms: {},
  openingAttachments: {},
};

function importedSurfaceTextures() {
  return {
    sources: {
      'albedo-shared': {
        name: 'medieval-stone.png',
        dataUrl: PNG_DATA_URL,
      },
      'albedo-unused': {
        name: 'unused.png',
        dataUrl: PNG_DATA_URL,
      },
    },
    slots: {
      walls: {
        sourceId: 'albedo-shared',
        mapping: 'repeat',
        repeat: 2.5,
        rotation: 90,
        tint: '#f4e3c2',
      },
      wood: {
        sourceId: 'albedo-shared',
        mapping: 'mirror',
        repeat: 1.5,
        rotation: 0,
        tint: '#84552f',
      },
    },
  };
}

test('procedural asset recipes are normalized and bounded', () => {
  const normalized = normalizeProceduralRecipe(recipe);
  assert.deepEqual(normalized, recipe);
  assert.throws(
    () => normalizeProceduralRecipe({ ...recipe, width: 100 }),
    /Width must be between/,
  );
  assert.throws(
    () => normalizeProceduralRecipe({ ...recipe, archetype: 'castle' }),
    /Unknown workshop archetype/,
  );
  assert.throws(
    () => normalizeProceduralRecipe({ ...recipe, topStyle: 'onion-dome' }),
    /Unknown workshop top style/,
  );
});

test('older workshop recipes receive compatible quality, texture, and component defaults', () => {
  const normalized = normalizeProceduralRecipe({
    archetype: 'tower',
    style: 'granite',
    width: 6,
    depth: 2,
    height: 7,
    seed: 5,
    detail: 2,
    remesh: true,
    albedo: true,
  });
  assert.equal(normalized.topStyle, 'battlements');
  assert.equal(normalized.finish, 'masonry');
  assert.equal(normalized.shape, 'classic');
  assert.equal(normalized.towerSide, 'left');
  assert.equal(normalized.roofScale, 1);
  assert.equal(normalized.roofOverhang, 0.35);
  assert.equal(normalized.weathering, 0.35);
  assert.equal(normalized.windows, true);
  assert.equal(normalized.ivy, false);
  assert.deepEqual(normalized.surfaceTextures, { sources: {}, slots: {} });
  assert.deepEqual(normalized.componentTransforms, {});
  assert.deepEqual(normalized.openingAttachments, {});
});

test('component transforms are normalized, sparse, and bounded', () => {
  const normalized = normalizeProceduralRecipe({
    ...recipe,
    componentTransforms: {
      'structure-main': {
        position: [1, 0.5, -2],
        rotation: [0, Math.PI / 2, 0],
        scale: [1.25, 1.5, 0.8],
      },
      'door-1': {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
  });
  assert.deepEqual(Object.keys(normalized.componentTransforms), ['structure-main']);
  assert.deepEqual(normalized.componentTransforms['structure-main'].position, [1, 0.5, -2]);
  assert.ok(Object.isFrozen(normalized.componentTransforms['structure-main']));
  assert.throws(
    () => normalizeProceduralRecipe({
      ...recipe,
      componentTransforms: {
        '../door': { scale: [1, 1, 1] },
      },
    }),
    /Invalid workshop component id/,
  );
  assert.throws(
    () => normalizeProceduralRecipe({
      ...recipe,
      componentTransforms: {
        'door-1': { scale: [0, 1, 1] },
      },
    }),
    /Component scale values must be between/,
  );
});

test('imported albedo is normalized, shared across areas, and strips unused sources', () => {
  const normalized = normalizeProceduralRecipe({
    ...recipe,
    surfaceTextures: importedSurfaceTextures(),
  });
  assert.deepEqual(Object.keys(normalized.surfaceTextures.sources), ['albedo-shared']);
  assert.equal(normalized.surfaceTextures.slots.walls.rotation, 90);
  assert.equal(normalized.surfaceTextures.slots.wood.mapping, 'mirror');
  assert.equal(
    normalized.surfaceTextures.slots.walls.sourceId,
    normalized.surfaceTextures.slots.wood.sourceId,
  );
  assert.ok(Object.isFrozen(normalized.surfaceTextures));
  assert.ok(Object.isFrozen(normalized.surfaceTextures.sources['albedo-shared']));
});

test('imported albedo rejects unsafe formats, corrupt payloads, and missing sources', () => {
  assert.throws(
    () => normalizeProceduralRecipe({
      ...recipe,
      surfaceTextures: {
        sources: {
          'albedo-svg': {
            name: 'unsafe.svg',
            dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
          },
        },
        slots: {},
      },
    }),
    /PNG, JPEG, or WebP/,
  );
  assert.throws(
    () => normalizeProceduralRecipe({
      ...recipe,
      surfaceTextures: {
        sources: {
          'albedo-corrupt': {
            name: 'corrupt.png',
            dataUrl: 'data:image/png;base64,AAAAAAAAAAAAAAAA',
          },
        },
        slots: {},
      },
    }),
    /does not match its declared format/,
  );
  assert.throws(
    () => normalizeProceduralRecipe({
      ...recipe,
      surfaceTextures: {
        sources: {},
        slots: {
          roof: {
            sourceId: 'albedo-missing',
            mapping: 'repeat',
            repeat: 2,
            rotation: 0,
            tint: '#ffffff',
          },
        },
      },
    }),
    /missing albedo source/,
  );
});

test('procedural object keys are stable and collision safe', () => {
  const first = createProceduralAssetRecord({ label: 'Granite Gatehouse', recipe });
  const repeat = createProceduralAssetRecord({ label: 'Granite Gatehouse', recipe });
  const collision = createProceduralAssetRecord(
    { label: 'Granite Gatehouse', recipe },
    new Set([first.key]),
  );
  assert.equal(first.key, repeat.key);
  assert.equal(collision.key, `${first.key}-2`);
});

test('procedural asset documents preserve images and semantic component edits', () => {
  const source = new ProceduralAssetStore();
  const record = source.add({
    label: 'Textured Gatehouse',
    recipe: {
      ...recipe,
      surfaceTextures: importedSurfaceTextures(),
      componentTransforms: {
        'door-1': {
          position: [0.75, 0, 0],
          rotation: [0, 0.2, 0],
          scale: [1.2, 1.4, 1],
        },
      },
      openingAttachments: {
        'door-1': {
          sourceId: 'door-1',
          hostId: 'structure-left',
          position: [0.5, 0],
          scale: [1.2, 1.4],
        },
      },
    },
  });
  const document = source.toDocument();
  assert.equal(document[0].version, 3);
  assert.equal(document[0].key, record.key);
  assert.equal('geometry' in document[0], false);
  assert.equal(
    document[0].recipe.surfaceTextures.sources['albedo-shared'].dataUrl,
    PNG_DATA_URL,
  );
  assert.deepEqual(document[0].recipe.componentTransforms['door-1'].position, [0.75, 0, 0]);
  assert.deepEqual(document[0].recipe.openingAttachments['door-1'].position, [0.5, 0]);

  const target = new ProceduralAssetStore();
  target.replaceAll(document);
  assert.deepEqual(target.toDocument(), document);
  assert.ok(Object.isFrozen(target.list()[0].recipe));
});

test('version-one and version-two workshop records migrate to version three', () => {
  const oldRecord = createProceduralAssetRecord({ label: 'Legacy Tower', recipe });
  for (const version of [1, 2]) {
    const store = new ProceduralAssetStore();
    store.replaceAll([{ ...oldRecord, version }]);
    const [migrated] = store.toDocument();
    assert.equal(migrated.version, 3);
    assert.deepEqual(migrated.recipe.surfaceTextures, { sources: {}, slots: {} });
    assert.deepEqual(migrated.recipe.componentTransforms, {});
    assert.deepEqual(migrated.recipe.openingAttachments, {});
  }
});
