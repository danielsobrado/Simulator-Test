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
    // Leaves are placed in clumps of 3-6 rather than singly (2026-07-25), so the
    // part count per strand is several times what it was.
    assert.ok(
      first.length >= 120 && first.length <= 400,
      `unexpected ivy density: ${first.length}`,
    );
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

function ivyStems(geometries) {
  // A leaf is exactly 12 vertices; a vine cylinder is more.
  return geometries.filter((geometry) => geometry.getAttribute('position').count > 12);
}

test('ivy stems never grow across an opening', () => {
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
    const left = opening.centerX - opening.width / 2;
    const right = opening.centerX + opening.width / 2;
    const top = opening.springHeight + opening.radius;
    const stems = ivyStems(geometries);
    assert.ok(stems.length > 0);
    for (const stem of stems) {
      const position = stem.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        const x = position.getX(index);
        const y = position.getY(index);
        const insideOpening = y >= opening.bottom && y <= top && x > left && x < right;
        assert.ok(!insideOpening, `stem entered the opening at ${x}, ${y}`);
      }
    }
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
});

test('an explicit preferred side keeps every ivy strand on that side', () => {
  const input = {
    width: 6,
    height: 5,
    frontZ: 1,
    seedOffset: 12,
  };
  for (const preferredSide of [-1, 1]) {
    const geometries = buildProceduralFacadeIvy(recipe({ detail: 3 }), {
      ...input,
      preferredSide,
    });
    try {
      const stems = ivyStems(geometries);
      assert.ok(stems.length > 0);
      let total = 0;
      let count = 0;
      for (const stem of stems) {
        const position = stem.getAttribute('position');
        for (let index = 0; index < position.count; index += 1) {
          total += position.getX(index);
          count += 1;
        }
      }
      // Callers use `preferredSide` to steer ivy away from an attached tower, so
      // the trailing eaves strand has to honour it as well as the climbing ones.
      assert.ok(
        Math.sign(total / count) === preferredSide,
        `preferredSide ${preferredSide} produced mean x ${total / count}`,
      );
    } finally {
      geometries.forEach((geometry) => geometry.dispose());
    }
  }
});

test('ivy on a round host wraps the tower instead of leaving its surface', () => {
  const radius = 1.9;
  const geometries = buildProceduralFacadeIvy(recipe({ detail: 3 }), {
    width: Math.PI * 2 * radius,
    height: 7,
    surfaceType: 'round',
    radius,
    seedOffset: 170,
  });
  try {
    assert.ok(geometries.length > 0);
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        const distance = Math.hypot(position.getX(index), position.getZ(index));
        // Everything hugs the cylinder: never inside the wall, never floating off.
        assert.ok(
          distance > radius - 0.05 && distance < radius + 0.45,
          `radial distance ${distance} left the tower surface at radius ${radius}`,
        );
      }
    }
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
});
