import assert from 'node:assert/strict';
import test from 'node:test';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';

function rectangle(halfWidth, halfHeight) {
  return [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
}

function field({
  id,
  cellIndex = id,
  courseIndex,
  s,
  y,
  width = 0.8,
  height = 0.35,
  damageVoid = false,
}) {
  return {
    category: 'field',
    stableIndex: id,
    cellIndex,
    courseIndex,
    s,
    y,
    width,
    height,
    packedWidth: width,
    corners: rectangle(width / 2 - 0.02, height / 2 - 0.02),
    mortarCorners: rectangle(width / 2, height / 2),
    jointWidths: { head: 0.04, bed: 0.04 },
    support: {
      role: courseIndex === 0 ? 'foundation' : 'field',
      span: [s - width / 2, s + width / 2],
      bottom: y - height / 2,
      top: y + height / 2,
      courseIndex,
    },
    ruin: {
      damageVoid,
      clusterId: damageVoid ? 7 : null,
    },
  };
}

test('partial split-cell ruin is not merged back over the missing leaf', () => {
  const left = field({
    id: 1,
    cellIndex: 10,
    courseIndex: 0,
    s: 0.25,
    y: 0.2,
    width: 0.5,
    damageVoid: true,
  });
  const right = field({
    id: 2,
    cellIndex: 10,
    courseIndex: 0,
    s: 0.75,
    y: 0.2,
    width: 0.5,
    damageVoid: true,
  });
  const coarse = coarsePlacements([left, right], { styleKey: 'coursed-rubble' });
  assert.equal(coarse.filter(({ category }) => category === 'field').length, 2);
});

test('one completely missing course remains a ruin gap', () => {
  const bottom = field({ id: 1, courseIndex: 0, s: 0.5, y: 0.2 });
  const top = field({ id: 2, courseIndex: 2, s: 0.5, y: 1.0 });
  const coarse = coarsePlacements([bottom, top], { styleKey: 'coursed-rubble' });
  const keptBottom = coarse.find(({ stableIndex }) => stableIndex === bottom.stableIndex);
  assert.ok(keptBottom);
  assert.equal(keptBottom.height, bottom.height);
  assert.equal(keptBottom.y, bottom.y);
});

test('coarse stretching is local and does not fill a horizontal ruin void', () => {
  const lowerLeft = field({ id: 1, courseIndex: 0, s: 0.5, y: 0.2 });
  const lowerRight = field({ id: 2, courseIndex: 0, s: 1.5, y: 0.2 });
  const upperLeft = field({ id: 3, courseIndex: 1, s: 0.5, y: 0.6 });
  const coarse = coarsePlacements(
    [lowerLeft, lowerRight, upperLeft],
    { styleKey: 'coursed-rubble' },
  );
  const left = coarse.find(({ stableIndex }) => stableIndex === lowerLeft.stableIndex);
  const right = coarse.find(({ stableIndex }) => stableIndex === lowerRight.stableIndex);
  assert.ok(left.height > lowerLeft.height, 'covered left stone should stretch');
  assert.equal(right.height, lowerRight.height, 'uncovered right stone must preserve the void');
});
