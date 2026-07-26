import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeFootprintLoop,
  signedPolygonArea,
  unionRectangleFootprints,
} from '../src/editor/workshop/ProceduralWorkshopFootprint.js';

function rectangle(id, position, dimensions = [2, 2], rotation = 0) {
  return { id, kind: 'rectangle', position, dimensions, rotation };
}

test('rectangle union handles overlap, full-edge sharing, containment, and disjoint groups', () => {
  const overlap = unionRectangleFootprints([
    rectangle('a', [0, 0], [4, 2]),
    rectangle('b', [1, 1], [2, 4]),
  ]);
  assert.equal(overlap.length, 1);
  assert.ok([6, 8].includes(overlap[0].polygon.length));
  assert.deepEqual(overlap[0].primitiveIds, ['a', 'b']);

  const shared = unionRectangleFootprints([
    rectangle('a', [0, 0]),
    rectangle('b', [2, 0]),
  ]);
  assert.equal(shared.length, 1);
  assert.deepEqual(shared[0].polygon, [[-1, -1], [3, -1], [3, 1], [-1, 1]]);

  const contained = unionRectangleFootprints([
    rectangle('a', [0, 0], [6, 6]),
    rectangle('b', [0, 0], [2, 2], 30),
  ]);
  assert.equal(contained.length, 1);
  assert.equal(contained[0].polygon.length, 4);

  const disjoint = unionRectangleFootprints([
    rectangle('a', [0, 0]),
    rectangle('b', [6, 0]),
  ]);
  assert.equal(disjoint.length, 2);
});

test('corner-touching rectangles stay separate before overhang is applied', () => {
  const result = unionRectangleFootprints([
    rectangle('a', [0, 0]),
    rectangle('b', [2, 2]),
  ], { overhang: 0.5 });
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(({ primitiveIds }) => primitiveIds), [['a'], ['b']]);
});

test('rotated rectangle union is deterministic under primitive reordering', () => {
  const primitives = [
    rectangle('a', [0, 0], [5, 2], 30),
    rectangle('b', [1, 0], [2, 5], 45),
  ];
  assert.deepEqual(
    unionRectangleFootprints(primitives),
    unionRectangleFootprints([...primitives].reverse()),
  );
});

test('loop normalization removes closing duplicates and collinear vertices and emits CCW', () => {
  const normalized = normalizeFootprintLoop([
    [0, 0], [0, 2], [1, 2], [2, 2], [2, 0], [0, 0],
  ]);
  assert.equal(normalized.length, 4);
  assert.ok(signedPolygonArea(normalized) > 0);
  assert.deepEqual(normalized[0], [0, 0]);
});
