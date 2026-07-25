import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralMedievalParts } from '../src/editor/workshop/ProceduralMedievalGenerator.js';

const recipe = {
  archetype: 'wall',
  style: 'limestone',
  topStyle: 'battlements',
  finish: 'masonry',
  shape: 'classic',
  towerSide: 'left',
  width: 6,
  depth: 1.5,
  height: 4,
  roofScale: 1,
  roofOverhang: 0.35,
  seed: 77,
  detail: 2,
  weathering: 0.35,
  windows: false,
  ivy: false,
  remesh: true,
  albedo: true,
};

function positionSignature(parts) {
  let hash = 2166136261;
  for (const part of parts) {
    for (const value of part.geometry.getAttribute('position').array) {
      const quantized = Math.round(value * 10000);
      hash ^= quantized;
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}

test('procedural masonry is deterministic and remeshed', () => {
  const first = createProceduralMedievalParts(recipe);
  const second = createProceduralMedievalParts(recipe);
  try {
    assert.equal(first.length, 2);
    assert.equal(first.stats.drawParts, 2);
    assert.ok(first.stats.stones > 20);
    assert.equal(positionSignature(first), positionSignature(second));
    assert.ok(first[0].geometry.boundingBox);
    assert.ok(first[0].geometry.boundingSphere);
  } finally {
    disposeModelParts(first);
    disposeModelParts(second);
  }
});

test('workshop materials expose deterministic PBR detail and projected UVs', () => {
  const parts = createProceduralMedievalParts({ ...recipe, remesh: true });
  try {
    const stone = parts.find((part) => part.material.userData.workshopSlot === 'stone');
    assert.ok(stone.material.normalMap);
    assert.ok(stone.material.roughnessMap);
    assert.equal(stone.material.normalMap.colorSpace, '');
    assert.equal(stone.material.roughness, 1);
    const uv = stone.geometry.getAttribute('uv');
    assert.ok(uv);
    assert.ok(Array.from(uv.array).every(Number.isFinite));
    assert.ok(Array.from(uv.array).some((value) => Math.abs(value) > 0.01));
  } finally {
    disposeModelParts(parts);
  }
});

test('albedo baking creates a reusable sRGB data texture', () => {
  const parts = createProceduralMedievalParts(recipe);
  try {
    const texture = parts[0].material.map;
    assert.ok(texture?.isDataTexture);
    assert.equal(texture.image.width, 256);
    assert.equal(texture.image.height, 256);
    assert.equal(texture.image.data.length, 256 * 256 * 4);
  } finally {
    disposeModelParts(parts);
  }
});

test('semantic gatehouse details remain bounded after remeshing', () => {
  const parts = createProceduralMedievalParts({
    ...recipe,
    archetype: 'gatehouse',
    topStyle: 'terracotta',
    windows: true,
    ivy: true,
  });
  try {
    assert.ok(parts.stats.stones > 200);
    assert.ok(parts.stats.features > 20);
    assert.ok(parts.length <= 7);
    assert.equal(parts.stats.drawParts, parts.length);
    assert.ok(parts[0].geometry.getAttribute('color'));
    for (const part of parts) {
      assert.ok(part.geometry.boundingBox);
      assert.ok(part.geometry.boundingSphere);
      for (const value of part.geometry.getAttribute('position').array) {
        assert.ok(Number.isFinite(value));
      }
    }
  } finally {
    disposeModelParts(parts);
  }
});

test('square keep towers generate openings, battlements, and mortar backing deterministically', () => {
  const towerRecipe = {
    ...recipe,
    archetype: 'square-tower',
    width: 6,
    depth: 2,
    height: 7,
    windows: true,
    ivy: true,
  };
  const first = createProceduralMedievalParts(towerRecipe);
  const second = createProceduralMedievalParts(towerRecipe);
  try {
    assert.ok(first.stats.stones > 300);
    assert.ok(first.stats.features > 30);
    assert.ok(first.length <= 7);
    assert.equal(positionSignature(first), positionSignature(second));
  } finally {
    disposeModelParts(first);
    disposeModelParts(second);
  }
});

test('tower houses combine plaster, stepped gables, adjustable roofs, and a tower deterministically', () => {
  const manorRecipe = {
    ...recipe,
    archetype: 'manor',
    finish: 'ochre',
    shape: 'stepped',
    towerSide: 'left',
    topStyle: 'slate',
    width: 8,
    depth: 2.5,
    height: 5.5,
    roofScale: 1.35,
    roofOverhang: 0.5,
    windows: true,
    ivy: true,
  };
  const first = createProceduralMedievalParts(manorRecipe);
  const second = createProceduralMedievalParts(manorRecipe);
  try {
    assert.ok(first.stats.stones > 30);
    assert.ok(first.stats.features > 40);
    assert.ok(first.length <= 7);
    assert.equal(positionSignature(first), positionSignature(second));
    const roofPart = first.find((part) => part.material.bumpScale === 0.095);
    assert.ok(roofPart?.material.map?.isDataTexture);
    assert.ok(roofPart.material.bumpMap?.isDataTexture);
  } finally {
    disposeModelParts(first);
    disposeModelParts(second);
  }
});
