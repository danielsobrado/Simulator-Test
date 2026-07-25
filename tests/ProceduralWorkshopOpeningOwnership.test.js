import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';

function recipe(overrides = {}) {
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
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

function slotBounds(parts, slot) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const part of parts) {
    if (part.material.userData.workshopSlot !== slot) continue;
    part.geometry.computeBoundingBox();
    const partBounds = part.geometry.boundingBox.clone();
    partBounds.applyMatrix4(part.matrix);
    bounds.union(partBounds);
  }
  return bounds;
}

test('classic opening components own inserts but not structural arch stones', () => {
  const parts = createProceduralWorkshopComponentParts(recipe(), { preserveComponents: true });
  try {
    const doorParts = parts.filter((part) => part.component?.kind === 'door');
    assert.ok(doorParts.length > 0);
    assert.ok(doorParts.some((part) => (
      ['wood', 'metal'].includes(part.material.userData.workshopSlot)
    )));
    assert.ok(doorParts.every((part) => part.material.userData.workshopSlot !== 'stone'));
  } finally {
    disposeModelParts(parts);
  }
});

test('moving a classic door insert does not move structural masonry', () => {
  const base = createProceduralWorkshopComponentParts(recipe());
  const edited = createProceduralWorkshopComponentParts(recipe({
    componentTransforms: {
      'door-1': {
        position: [2, 0.5, 0.75],
        rotation: [0, Math.PI / 4, 0],
        scale: [1.25, 1.1, 1],
      },
    },
  }));
  try {
    const baseStone = slotBounds(base, 'stone');
    const editedStone = slotBounds(edited, 'stone');
    assert.deepEqual(editedStone.min.toArray(), baseStone.min.toArray());
    assert.deepEqual(editedStone.max.toArray(), baseStone.max.toArray());
  } finally {
    disposeModelParts(base);
    disposeModelParts(edited);
  }
});
