import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProceduralAssetRecord,
  normalizeProceduralRecipe,
} from '../src/editor/workshop/ProceduralAssetStore.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function transform(position) {
  return {
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

function slot(sourceId, repeat) {
  return {
    sourceId,
    mapping: 'repeat',
    repeat,
    rotation: 0,
    tint: '#ffffff',
  };
}

function recipe({ reverse = false } = {}) {
  const sources = reverse
    ? {
      'albedo-z': { name: 'Z', dataUrl: PNG_DATA_URL },
      'albedo-a': { name: 'A', dataUrl: PNG_DATA_URL },
    }
    : {
      'albedo-a': { name: 'A', dataUrl: PNG_DATA_URL },
      'albedo-z': { name: 'Z', dataUrl: PNG_DATA_URL },
    };
  const slots = reverse
    ? {
      wood: slot('albedo-z', 2),
      walls: slot('albedo-a', 1),
    }
    : {
      walls: slot('albedo-a', 1),
      wood: slot('albedo-z', 2),
    };
  const componentTransforms = reverse
    ? {
      'structure-right': transform([2, 0, 0]),
      'structure-main': transform([1, 0, 0]),
    }
    : {
      'structure-main': transform([1, 0, 0]),
      'structure-right': transform([2, 0, 0]),
    };

  return {
    archetype: 'gatehouse',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'classic',
    towerSide: 'none',
    width: 8,
    depth: 2,
    height: 5,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 2,
    weathering: 0.35,
    windows: true,
    ivy: false,
    remesh: true,
    albedo: true,
    surfaceTextures: { sources, slots },
    componentTransforms,
  };
}

test('recipe normalization is independent of object insertion order', () => {
  const forward = normalizeProceduralRecipe(recipe());
  const reverse = normalizeProceduralRecipe(recipe({ reverse: true }));

  assert.deepEqual(reverse, forward);
  assert.deepEqual(Object.keys(forward.componentTransforms), [
    'structure-main',
    'structure-right',
  ]);
  assert.deepEqual(Object.keys(forward.surfaceTextures.sources), [
    'albedo-a',
    'albedo-z',
  ]);
  assert.deepEqual(Object.keys(forward.surfaceTextures.slots), ['walls', 'wood']);
});

test('semantically identical recipes produce the same procedural object key', () => {
  const forward = createProceduralAssetRecord({
    label: 'Canonical gatehouse',
    recipe: recipe(),
  });
  const reverse = createProceduralAssetRecord({
    label: 'Canonical gatehouse',
    recipe: recipe({ reverse: true }),
  });

  assert.equal(reverse.key, forward.key);
});
