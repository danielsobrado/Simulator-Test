import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { buildProceduralFacadeIvy } from '../src/editor/workshop/ProceduralWorkshopIvy.js';

function recipe(overrides = {}) {
  return {
    seed: 1848,
    detail: 2,
    ivy: true,
    ...overrides,
  };
}

function signature(geometries) {
  return geometries.map((geometry) => {
    geometry.computeBoundingBox();
    return [
      geometry.getAttribute('position').count,
      ...geometry.boundingBox.min.toArray().map((value) => value.toFixed(4)),
      ...geometry.boundingBox.max.toArray().map((value) => value.toFixed(4)),
    ].join(':');
  }).join('|');
}

test('procedural façade ivy is deterministic, branched, and bounded', () => {
  const input = {
    width: 8,
    height: 6,
    frontZ: 1.2,
    centerX: 0,
    seedOffset: 60,
  };
  const first = buildProceduralFacadeIvy(recipe(), input);
  const second = buildProceduralFacadeIvy(recipe(), input);
  try {
    assert.equal(signature(first), signature(second));
    assert.ok(first.length >= 40 && first.length <= 100);
    const bounds = new THREE.Box3();
    first.forEach((geometry) => {
      const position = geometry.getAttribute('position');
      assert.ok(position.count >= 12);
      for (const value of position.array) assert.ok(Number.isFinite(value));
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
    });
    assert.ok(bounds.min.y >= -0.2);
    assert.ok(bounds.max.y <= input.height);
    assert.ok(bounds.min.z >= input.frontZ - 0.1);
    assert.ok(bounds.max.z <= input.frontZ + 0.35);
  } finally {
    first.forEach((geometry) => geometry.dispose());
    second.forEach((geometry) => geometry.dispose());
  }
});

test('ivy detail controls bounded density and the toggle fails closed', () => {
  const input = {
    width: 6,
    height: 5,
    frontZ: 1,
    seedOffset: 12,
  };
  const draft = buildProceduralFacadeIvy(recipe({ detail: 1 }), input);
  const ultra = buildProceduralFacadeIvy(recipe({ detail: 3 }), input);
  try {
    assert.ok(ultra.length > draft.length);
    assert.deepEqual(buildProceduralFacadeIvy(recipe({ ivy: false }), input), []);
  } finally {
    draft.forEach((geometry) => geometry.dispose());
    ultra.forEach((geometry) => geometry.dispose());
  }
});

test('ivy stems choose one consistent side when routing around an opening', () => {
  const opening = {
    centerX: 2,
    bottom: 0,
    width: 1.2,
    springHeight: 3,
    radius: 0.6,
  };
  const geometries = buildProceduralFacadeIvy(recipe(), {
    width: 6,
    height: 5,
    frontZ: 1,
    seedOffset: 12,
    preferredSide: 1,
    openings: [opening],
  });
  try {
    const openingRight = opening.centerX + opening.width / 2;
    const stems = geometries.filter((geometry) => (
      geometry.getAttribute('position').count > 12
    ));
    assert.ok(stems.length > 0);
    for (const stem of stems) {
      const position = stem.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        const y = position.getY(index);
        if (y >= opening.bottom && y <= opening.springHeight + opening.radius) {
          assert.ok(position.getX(index) > openingRight);
        }
      }
    }
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
});
