import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralMedievalWorkshopParts } from '../src/editor/workshop/ProceduralMedievalWorkshopGenerator.js';

function recipe(overrides = {}) {
  return {
    archetype: 'wall',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'classic',
    towerSide: 'none',
    width: 8,
    depth: 1.5,
    height: 5,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 2,
    weathering: 0.35,
    windows: true,
    ivy: false,
    remesh: false,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

function stoneContainsPoint(parts, point) {
  return parts.some((part) => {
    if (part.material.userData.workshopSlot !== 'stone') return false;
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox.clone().applyMatrix4(part.matrix);
    return bounds.containsPoint(point);
  });
}

test('classic wall stones leave the complete recessed opening width clear', () => {
  const source = recipe();
  const parts = createProceduralMedievalWorkshopParts(source);
  try {
    for (const side of [-1, 1]) {
      const centerX = side * source.width * 0.23;
      const bottom = source.height * 0.43;
      const y = bottom + 0.32;
      for (const x of [centerX, centerX - 0.16, centerX + 0.16]) {
        assert.equal(
          stoneContainsPoint(parts, new THREE.Vector3(x, y, 0)),
          false,
          `Structural masonry blocks the classic opening at x=${x}.`,
        );
      }
    }
  } finally {
    disposeModelParts(parts);
  }
});

test('round tower door stones leave the front passage clear', () => {
  const source = recipe({
    archetype: 'tower',
    width: 6,
    depth: 2,
    height: 7,
  });
  const wallDepth = Math.max(0.5, source.depth * 0.58);
  const radius = Math.max(1, source.width / 2 - wallDepth * 0.22);
  const parts = createProceduralMedievalWorkshopParts(source);
  try {
    assert.equal(
      stoneContainsPoint(parts, new THREE.Vector3(0, 0.8, radius)),
      false,
    );
  } finally {
    disposeModelParts(parts);
  }
});

test('validated medieval remeshing preserves bounded draw parts and source stats', () => {
  const parts = createProceduralMedievalWorkshopParts(recipe({
    archetype: 'gatehouse',
    topStyle: 'terracotta',
    ivy: true,
    remesh: true,
  }));
  try {
    assert.ok(parts.length > 0 && parts.length <= 7);
    assert.equal(parts.stats.drawParts, parts.length);
    assert.ok(parts.stats.stones > 0);
    assert.ok(parts.stats.sourceVertices > 0);
    for (const part of parts) {
      assert.ok(part.geometry.boundingBox);
      assert.ok(part.geometry.boundingSphere);
    }
  } finally {
    disposeModelParts(parts);
  }
});

test('extreme gatehouse dimensions fail before unbounded masonry generation', () => {
  assert.throws(
    () => createProceduralMedievalWorkshopParts(recipe({
      archetype: 'gatehouse',
      width: 16,
      depth: 12,
      height: 14,
      detail: 3,
    })),
    /reduce its width, depth, height, or detail/,
  );
});
