import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeProceduralRecipe } from '../src/editor/workshop/ProceduralAssetStore.js';
import {
  MAX_SHINGLES,
  estimateConeShingles,
  estimateSlopeShingles,
  shingledConeGeometries,
  shingledSlopeGeometries,
  shinglesEnabled,
} from '../src/editor/workshop/ProceduralWorkshopShingles.js';

function recipe(overrides = {}) {
  return normalizeProceduralRecipe({
    archetype: 'tower',
    style: 'sandstone',
    topStyle: 'terracotta',
    width: 4,
    depth: 3,
    height: 7,
    detail: 3,
    seed: 1848,
    irregularity: 0.7,
    ...overrides,
  });
}

const CONE = Object.freeze({ radius: 1.8, height: 2.6, baseY: 7, seedOffset: 4100 });
const SLOPE = Object.freeze({
  width: 8, height: 2.4, roofDepth: 5, baseY: 5, side: 1, seedOffset: 4200,
});

function dispose(geometries) {
  geometries.forEach((geometry) => geometry.dispose());
}

test('tile solids are Ultra-only', () => {
  assert.equal(shinglesEnabled(recipe({ detail: 3 })), true);
  for (const detail of [1, 2]) {
    assert.equal(shinglesEnabled(recipe({ detail })), false);
    assert.deepEqual(shingledConeGeometries(recipe({ detail }), CONE), []);
    assert.deepEqual(shingledSlopeGeometries(recipe({ detail }), SLOPE), []);
    assert.equal(estimateConeShingles(recipe({ detail }), CONE), 0);
  }
});

test('cone and slope tiles are finite, coloured, and deterministic', () => {
  const first = shingledConeGeometries(recipe(), CONE);
  const second = shingledConeGeometries(recipe(), CONE);
  const slope = shingledSlopeGeometries(recipe(), SLOPE);
  try {
    assert.ok(first.length > 50);
    assert.equal(first.length, second.length);
    for (let index = 0; index < first.length; index += 1) {
      const a = first[index].getAttribute('position').array;
      const b = second[index].getAttribute('position').array;
      assert.deepEqual(a, b);
    }
    for (const geometry of [...first, ...slope]) {
      const position = geometry.getAttribute('position');
      for (const value of position.array) assert.ok(Number.isFinite(value));
      // The roof material declares vertexColors, so every tile must carry them.
      const color = geometry.getAttribute('color');
      assert.ok(color, 'tile is missing baked vertex colours');
      assert.equal(color.count, position.count);
      for (const value of color.array) assert.ok(value >= 0 && value <= 1);
    }
  } finally {
    dispose(first);
    dispose(second);
    dispose(slope);
  }
});

test('estimates match what generation actually emits', () => {
  const cone = shingledConeGeometries(recipe(), CONE);
  const slope = shingledSlopeGeometries(recipe(), SLOPE);
  try {
    assert.equal(estimateConeShingles(recipe(), CONE), cone.length);
    assert.equal(estimateSlopeShingles(recipe(), SLOPE), slope.length);
  } finally {
    dispose(cone);
    dispose(slope);
  }
});

test('a pyramid keeps its tiles on flat facets, not on a circle', () => {
  const radius = 3 / Math.sqrt(2);
  const sides = 4;
  const tiles = shingledConeGeometries(recipe(), {
    radius, height: 2.2, baseY: 7, sides, rotationY: Math.PI / 4, seedOffset: 4300,
  });
  try {
    assert.ok(tiles.length > 20);
    // Every tile must sit at or inside the circumradius: a facet surface lies at
    // the inradius, so tiles laid on a circle of `radius` would float clear of it.
    const inradius = radius * Math.cos(Math.PI / sides);
    let maxDistance = 0;
    for (const geometry of tiles) {
      const position = geometry.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        maxDistance = Math.max(
          maxDistance,
          Math.hypot(position.getX(index), position.getZ(index)),
        );
      }
    }
    assert.ok(
      maxDistance < radius + 0.35,
      `pyramid tiles reached ${maxDistance}, beyond circumradius ${radius}`,
    );
    assert.ok(maxDistance > inradius * 0.9);
    assert.equal(estimateConeShingles(recipe(), { radius, height: 2.2, sides }), tiles.length);
  } finally {
    dispose(tiles);
  }
});

test('courses overlap so jitter cannot open a hole', () => {
  // Adjacent courses must share slope range: consecutive rows are built from a
  // step shorter than the tile, so their vertical extents have to intersect.
  const tiles = shingledSlopeGeometries(recipe(), SLOPE);
  try {
    const heights = tiles.map((geometry) => {
      geometry.computeBoundingBox();
      return [geometry.boundingBox.min.y, geometry.boundingBox.max.y];
    }).sort((a, b) => a[0] - b[0]);
    let overlaps = 0;
    for (let index = 1; index < heights.length; index += 1) {
      if (heights[index][0] < heights[index - 1][1]) overlaps += 1;
    }
    assert.ok(
      overlaps > heights.length * 0.5,
      `expected substantial course overlap, saw ${overlaps} of ${heights.length}`,
    );
  } finally {
    dispose(tiles);
  }
});

test('the largest legal roof stays inside the tile budget by growing tiles', () => {
  // 04-…md §15: when a region exceeds budget, increase target stone size. The
  // biggest roof the recipe schema permits must fit without throwing.
  const big = recipe({
    width: 16, depth: 12, height: 14, roofScale: 2, roofOverhang: 0.9, seed: 7,
  });
  const params = { radius: 16 / 2 + 0.9, height: 5.4, baseY: 14, seedOffset: 4100 };
  const estimate = estimateConeShingles(big, params);
  assert.ok(estimate > 0);
  assert.ok(estimate <= MAX_SHINGLES, `estimate ${estimate} exceeded ${MAX_SHINGLES}`);
  const tiles = shingledConeGeometries(big, params);
  try {
    assert.equal(tiles.length, estimate);
    assert.ok(tiles.length <= MAX_SHINGLES);
  } finally {
    dispose(tiles);
  }
});

test('small roofs keep real-world tile size', () => {
  // Adaptive sizing must not kick in on ordinary roofs, or every cottage would
  // get oversized tiles.
  const tiles = shingledConeGeometries(recipe(), CONE);
  try {
    let widest = 0;
    const size = new THREE.Vector3();
    for (const geometry of tiles) {
      geometry.computeBoundingBox();
      geometry.boundingBox.getSize(size);
      widest = Math.max(widest, size.x, size.z);
    }
    assert.ok(widest < 0.75, `tiles grew to ${widest} on a small roof`);
  } finally {
    dispose(tiles);
  }
});
