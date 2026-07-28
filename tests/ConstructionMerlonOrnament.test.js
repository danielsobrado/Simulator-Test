import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutMerlon } from '../src/editor/construction/masonry/MerlonOrnament.js';

const OPTIONS = { minWidth: 0.26, thickness: 0.8, seed: 3141, index: 28_000 };

/** The merlons a 40 m crenellated crown would produce, one per index slot. */
function crown(count = 64, overrides = {}) {
  const merlons = [];
  for (let index = 0; index < count; index += 1) {
    merlons.push(layoutMerlon(
      { s: index * 1.18, width: 0.65, base: 3.5, height: 0.72 },
      { ...OPTIONS, ...overrides, index: 28_000 + index * 16 },
    ));
  }
  return merlons;
}

test('a merlon is bonded masonry, not one block', () => {
  for (const ornament of crown()) {
    assert.ok(ornament.units.length >= 4, `only ${ornament.units.length} stones`);
  }
});

test('every stone stays inside the merlon it belongs to', () => {
  // A merlon that spills sideways lands in the embrasure next to it, which is
  // the one place on the wall where a stray stone is unmissable.
  const merlon = { s: 12, width: 0.65, base: 3.5, height: 0.72 };
  for (let index = 0; index < 64; index += 1) {
    const { units } = layoutMerlon(merlon, { ...OPTIONS, index: 28_000 + index * 16 });
    for (const unit of units) {
      const top = unit.y + unit.height / 2;
      assert.ok(unit.y - unit.height / 2 >= merlon.base - 1e-9, 'a stone sank into the crown');
      assert.ok(top <= merlon.base + merlon.height + 1e-9, 'a stone stood proud of the merlon');
      if (unit.category === 'ashlar') continue; // the corbel cantilevers on purpose
      const reach = Math.abs(unit.s - merlon.s) + unit.width / 2;
      assert.ok(reach <= merlon.width / 2 + 1e-9, `body stone reaches ${reach} of ${merlon.width / 2}`);
    }
  }
});

test('the corbel cantilevers clear of the merlon and stays modest', () => {
  const merlon = { s: 12, width: 0.65, base: 3.5, height: 0.72 };
  let corbels = 0;
  for (let index = 0; index < 128; index += 1) {
    const { units } = layoutMerlon(merlon, { ...OPTIONS, index: 28_000 + index * 16 });
    for (const unit of units.filter(({ category }) => category === 'ashlar')) {
      corbels += 1;
      const inner = Math.abs(unit.s - merlon.s) - unit.width / 2;
      assert.ok(inner > 0, 'the corbel should sit outside the merlon body, not inside it');
      assert.ok(unit.width <= merlon.width * 0.5, `corbel ${unit.width} m long`);
    }
  }
  // "A random border edge is extruded" — some merlons, not most and not none.
  assert.ok(corbels > 15 && corbels < 70, `${corbels} corbels in 128 merlons`);
});

test('some merlons are pierced and the slit is a clean void', () => {
  const pierced = crown(128).filter(({ pierced: hole }) => hole);
  assert.ok(pierced.length > 20, `only ${pierced.length} of 128 pierced`);
  assert.ok(pierced.length < 100, `${pierced.length} of 128 pierced — too many`);

  for (const ornament of pierced) {
    // Three columns, four rows, less the two cells the slit takes out. Counting
    // the cells rather than measuring the geometry is deliberate: the void is
    // made by *omitting* stones, so what has to be right is which ones are gone.
    const body = ornament.units.filter(({ category }) => category === 'field');
    assert.equal(ornament.columns, 3);
    assert.equal(ornament.rows, 4);
    assert.equal(body.length, ornament.rows * ornament.columns - 2);

    // The gap is in the middle column, and it is two rows tall and continuous.
    const byRow = new Map();
    for (const unit of body) {
      const key = unit.y.toFixed(6);
      byRow.set(key, (byRow.get(key) ?? 0) + 1);
    }
    const counts = [...byRow.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, count]) => count);
    assert.deepEqual(counts, [3, 2, 2, 3], 'the slit must be two rows tall, clear of the footing');
  }
});

test('a solid merlon breaks bond between its rows', () => {
  const solid = crown(128).filter(({ pierced }) => !pierced);
  assert.ok(solid.length > 20);
  for (const ornament of solid) {
    const rows = new Map();
    for (const unit of ornament.units.filter(({ category }) => category === 'field')) {
      const key = unit.y.toFixed(6);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(unit);
    }
    const counts = [...rows.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, row]) => row.length);
    // Alternating cell counts is what stops the joints stacking into a crack up
    // the middle of the merlon.
    for (let index = 1; index < counts.length; index += 1) {
      assert.notEqual(counts[index], counts[index - 1], `rows ${counts} stack their joints`);
    }
  }
});

test('the bridge is one segment or three, and only three can be pierced', () => {
  const bridges = new Set();
  for (const ornament of crown(128)) {
    bridges.add(ornament.bridge);
    if (ornament.pierced) assert.equal(ornament.bridge, 3, 'a stubby merlon was pierced');
  }
  assert.deepEqual([...bridges].sort(), [1, 3]);
});

test('a merlon is a pure function of its seed and index', () => {
  const merlon = { s: 7.4, width: 0.65, base: 3.5, height: 0.72 };
  assert.deepEqual(
    layoutMerlon(merlon, OPTIONS),
    layoutMerlon(merlon, OPTIONS),
  );
  // And neighbouring merlons do not share a shape.
  const shapes = new Set(crown(32).map(({ units }) => JSON.stringify(units)));
  assert.ok(shapes.size > 12, `only ${shapes.size} distinct shapes in 32 merlons`);
});

test('a merlon too narrow to course lays whole rows instead of splinters', () => {
  const { units } = layoutMerlon(
    { s: 3, width: 0.16, base: 3.5, height: 0.72 },
    { ...OPTIONS, minWidth: 0.34 },
  );
  assert.ok(units.length > 0);
  for (const unit of units.filter(({ category }) => category === 'field')) {
    assert.ok(unit.width >= 0.09, `splinter ${unit.width} m wide`);
  }
});
