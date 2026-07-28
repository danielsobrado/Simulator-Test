import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beveledBox,
  beveledQuadPrism,
} from '../src/editor/workshop/ProceduralWorkshopGeometry.js';

/** `[minX, minY, minZ, maxX, maxY, maxZ]` of a geometry's positions. */
function bounds(geometry) {
  const position = geometry.getAttribute('position');
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.count; index += 1) {
    for (const [axis, value] of [position.getX(index), position.getY(index), position.getZ(index)].entries()) {
      low[axis] = Math.min(low[axis], value);
      high[axis] = Math.max(high[axis], value);
    }
  }
  return [...low, ...high];
}

function triangles(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}

/** A rectangle in the corner form `beveledQuadPrism` takes, counter-clockwise. */
function rectangle(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

test('a rectangular quad prism costs the same as a bevelled box', () => {
  // The lattice replaces one primitive with the other for every field stone, so
  // a difference here would move the whole wall's triangle budget.
  const box = beveledBox({ width: 1.2, height: 0.56, depth: 0.8, bevelRatio: 0.085 });
  const quad = beveledQuadPrism({
    corners: rectangle(1.2, 0.56),
    depth: 0.8,
    bevelRatio: 0.085,
  });
  assert.equal(triangles(quad), triangles(box));
  assert.equal(triangles(quad), 28);
});

test('a rectangular quad prism measures its nominal size', () => {
  // The bevel ring is grown back out by the radius the profile was inset by, so
  // a stone still fills the cell the packer solved for it.
  const quad = beveledQuadPrism({
    corners: rectangle(1.2, 0.56),
    depth: 0.8,
    bevelRatio: 0.085,
  });
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(quad);
  assert.ok(Math.abs((maxX - minX) - 1.2) < 1e-6);
  assert.ok(Math.abs((maxY - minY) - 0.56) < 1e-6);
  assert.ok(Math.abs((maxZ - minZ) - 0.8) < 1e-6);
});

test('detail 3 spends its extra triangles on the bevel ring', () => {
  const coarse = beveledQuadPrism({ corners: rectangle(1, 0.5), depth: 0.6, detail: 2 });
  const fine = beveledQuadPrism({ corners: rectangle(1, 0.5), depth: 0.6, detail: 3 });
  assert.ok(triangles(fine) > triangles(coarse));
});

test('a leaning, ramped face stays a solid prism', () => {
  // The shape the lattice actually emits: no two edges parallel, no two corners
  // level. `ExtrudeGeometry` triangulates whatever it is handed, so the guard is
  // that the result still has volume and did not fold inside out.
  const quad = beveledQuadPrism({
    corners: [[-0.61, -0.31], [0.58, -0.26], [0.64, 0.29], [-0.55, 0.33]],
    depth: 0.78,
    bevelRatio: 0.085,
  });
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(quad);
  assert.ok(maxX - minX > 1.1 && maxX - minX < 1.3);
  assert.ok(maxY - minY > 0.55 && maxY - minY < 0.7);
  assert.ok(Math.abs((maxZ - minZ) - 0.78) < 1e-6);
  assert.equal(triangles(quad), 28);
  assert.ok(quad.getAttribute('uv'), 'the merge group needs a uv attribute');
});

test('winding is fixed up rather than trusted', () => {
  const ccw = rectangle(1.2, 0.56);
  const cw = [...ccw].reverse();
  assert.deepEqual(
    bounds(beveledQuadPrism({ corners: cw, depth: 0.8 })),
    bounds(beveledQuadPrism({ corners: ccw, depth: 0.8 })),
  );
});

test('a sliver falls back rather than inverting itself', () => {
  // A cell the wall-top clamp has nearly flattened: the inset would swallow the
  // profile and hand `ExtrudeGeometry` a self-intersecting shape, which
  // triangulates into faces pointing inward — a black hole in the wall.
  const sliver = beveledQuadPrism({
    corners: [[-0.5, -0.02], [0.5, -0.015], [0.5, 0.018], [-0.5, 0.02]],
    depth: 0.8,
    bevelRatio: 0.16,
  });
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(sliver);
  assert.ok(maxX - minX > 0.5, 'the sliver collapsed');
  assert.ok(maxY - minY > 0.005 && maxY - minY < 0.1);
  assert.ok(maxZ - minZ > 0.1);
  assert.ok(Number.isFinite(minX + minY + minZ), 'the fallback produced NaNs');
});

test('bevel radius follows the shortest edge, not the longest', () => {
  // Scaling it by the long edge would round a tall thin stone away entirely.
  const wide = beveledQuadPrism({ corners: rectangle(2.4, 0.2), depth: 0.8, bevelRatio: 0.12 });
  const [, minY, , , maxY] = bounds(wide);
  assert.ok(Math.abs((maxY - minY) - 0.2) < 1e-6);
});
