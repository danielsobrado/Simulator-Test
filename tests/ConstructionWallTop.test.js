import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOP_RADIUS_DEFAULT,
  TOP_STEP,
  applyTopEdit,
  falloffWeight,
  flattenTop,
  pruneTopProfile,
} from '../src/editor/construction/masonry/WallTopEdit.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import {
  MAX_CONSTRUCTION_TOP_POINTS,
  normalizeConstructionRecord,
} from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

const STYLE = constructionStyle('coursed-rubble');

function path(length = 30) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.01 });
}

function curvedPath() {
  return createCubicBezierPathFromStroke([
    [0, 0], [8, 5], [18, -3], [28, 4],
  ], { simplifyTolerance: 0.01 });
}

function setup(built = path(), overrides = {}) {
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 77,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: built,
    features: [],
    ...overrides,
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  return { record, arcTable };
}

function pack(record, arcTable) {
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  return packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STYLE,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    slopeAt: profile.slopeAt,
    crenellationsOver: profile.crenellationsOver,
    topStyle: record.top.style,
    budget: 4000,
  });
}

test('falloff is symmetric and effectively zero at the radius', () => {
  const radius = 3;
  for (const offset of [0.4, 1, 2.2]) {
    assert.ok(Math.abs(falloffWeight(offset, radius) - falloffWeight(-offset, radius)) < 1e-12);
  }
  assert.equal(falloffWeight(0, radius), 1);
  // Compact support: exactly zero at the edge, so the bracket points that
  // confine the edit are written at their existing height.
  assert.equal(falloffWeight(radius, radius), 0);
  assert.equal(falloffWeight(radius + 1, radius), 0);
  assert.ok(falloffWeight(radius / 2, radius) > 0.5, 'the middle must still bite');
});

test('a raise lifts the hovered point and leaves the far end alone', () => {
  const { record, arcTable } = setup();
  const top = applyTopEdit(record, arcTable, { centre: 6, direction: 1 });
  assert.ok(top);
  const raised = createWallTopProfile({ ...record, top }, arcTable);
  assert.ok(raised.heightAt(6) > 3.5 + TOP_STEP * 0.9);
  assert.ok(Math.abs(raised.heightAt(arcTable.totalLength - 1) - 3.5) < 1e-6);
});

test('the edit writes bracket points so it cannot leak along the wall', () => {
  const { record, arcTable } = setup();
  const top = applyTopEdit(record, arcTable, { centre: 12, direction: 1, radius: 3 });
  const arcs = top.profile.map(({ segmentId, arcFraction }) => arcTable.toArc(segmentId, arcFraction));
  assert.ok(Math.min(...arcs) <= 9.5 + 1e-6, 'a bracket must sit at the low edge');
  assert.ok(Math.max(...arcs) >= 14.5 - 1e-6, 'a bracket must sit at the high edge');

  const profile = createWallTopProfile({ ...record, top }, arcTable);
  // Outside the brackets the profile clamps to the outermost point, which the
  // brackets hold at the base height — so the rest of the wall is untouched.
  assert.ok(Math.abs(profile.heightAt(0) - 3.5) < 1e-6);
  assert.ok(Math.abs(profile.heightAt(arcTable.totalLength) - 3.5) < 1e-6);
});

test('lowering is the inverse of raising at the same point', () => {
  const { record, arcTable } = setup();
  const up = applyTopEdit(record, arcTable, { centre: 10, direction: 1 });
  const down = applyTopEdit({ ...record, top: up }, arcTable, { centre: 10, direction: -1 });
  const back = createWallTopProfile({ ...record, top: down }, arcTable);
  for (let s = 0; s <= arcTable.totalLength; s += 1) {
    assert.ok(Math.abs(back.heightAt(s) - 3.5) < 1e-6, `height drifted at ${s}`);
  }
});

test('repeated edits stay under the control point cap and keep their shape', () => {
  const { record, arcTable } = setup();
  let current = record;
  for (let index = 0; index < 40; index += 1) {
    const centre = 2 + (index % 9) * 3;
    const top = applyTopEdit(current, arcTable, { centre, direction: index % 3 === 0 ? -1 : 1 });
    if (!top) continue;
    current = normalizeConstructionRecord({ ...current, top });
  }
  assert.ok(
    current.top.profile.length <= MAX_CONSTRUCTION_TOP_POINTS,
    `profile grew to ${current.top.profile.length}`,
  );
  assert.ok(current.top.profile.length > 3, 'the shape must survive pruning');
});

test('pruning only removes points the rest already describe', () => {
  const { record, arcTable } = setup();
  const segmentId = record.path.segments[0].id;
  // A perfectly straight ramp: the middle point is redundant, the ends are not.
  const ramped = normalizeConstructionRecord({
    ...record,
    top: {
      style: 'flat',
      base: 3.5,
      profile: [
        { segmentId, arcFraction: 0.1, height: 3 },
        { segmentId, arcFraction: 0.3, height: 4 },
        { segmentId, arcFraction: 0.5, height: 5 },
        { segmentId, arcFraction: 0.7, height: 6 },
      ],
    },
  });
  const before = createWallTopProfile(ramped, arcTable);
  const pruned = pruneTopProfile(ramped, arcTable);
  assert.ok(pruned.length < 4, 'a straight ramp has redundant interior points');
  const after = createWallTopProfile(
    { ...ramped, top: { ...ramped.top, profile: pruned } },
    arcTable,
  );
  for (let s = 0; s <= arcTable.totalLength; s += 0.5) {
    assert.ok(Math.abs(after.heightAt(s) - before.heightAt(s)) <= 0.05 + 1e-9);
  }
});

test('flatten keeps the mean height and discards the profile', () => {
  const { record, arcTable } = setup();
  let current = record;
  for (const centre of [4, 5, 6]) {
    current = normalizeConstructionRecord({
      ...current,
      top: applyTopEdit(current, arcTable, { centre, direction: 1 }),
    });
  }
  const flattened = flattenTop(current, arcTable);
  assert.equal(flattened.style, 'flat');
  assert.deepEqual(flattened.profile, []);
  assert.ok(flattened.base > 3.5, 'a raised wall flattens above its original base');
  assert.ok(flattened.base < 3.5 + TOP_STEP * 3);
});

test('a raise beyond the far edge of the wall still lands', () => {
  const { record, arcTable } = setup();
  const top = applyTopEdit(record, arcTable, {
    centre: arcTable.totalLength,
    direction: 1,
    radius: TOP_RADIUS_DEFAULT,
  });
  assert.ok(top, 'an edit clipped by the wall end must not be refused');
  const profile = createWallTopProfile({ ...record, top }, arcTable);
  assert.ok(profile.heightAt(arcTable.totalLength) > 3.5);
});

test('a flat wall is finished with a coping course', () => {
  const { record, arcTable } = setup();
  const { stones } = pack(record, arcTable);
  const coping = stones.filter(({ category }) => category === 'coping');
  assert.ok(coping.length > 10, 'expected a coping course along the wall');
  // Coping oversails the wall face — that is what throws the shadow line.
  for (const stone of coping) {
    assert.ok(stone.depth > record.dimensions.thickness);
  }
  // The finished top still matches the requested height.
  const top = Math.max(...coping.map(({ y, height }) => y + height / 2));
  assert.ok(Math.abs(top - 3.5) < 0.02, `finished top was ${top}`);
});

test('coping rolls to follow a sloped top', () => {
  const { record, arcTable } = setup();
  const ramped = normalizeConstructionRecord({
    ...record,
    top: applyTopEdit(record, arcTable, { centre: 15, direction: 1, radius: 6 }),
  });
  const coping = pack(ramped, arcTable).stones.filter(({ category }) => category === 'coping');
  const profile = createWallTopProfile(ramped, arcTable, { style: STYLE });
  let rolled = 0;
  for (const stone of coping) {
    assert.ok(Math.abs(stone.roll - profile.slopeAt(stone.s)) < 1e-9);
    if (Math.abs(stone.roll) > 1e-3) rolled += 1;
  }
  assert.ok(rolled > 3, 'a ramped top must actually roll its coping');
});

test('a ruined wall is not coped', () => {
  const { record, arcTable } = setup(path(), { top: { style: 'ruined', base: 3.5 } });
  const { stones } = pack(record, arcTable);
  assert.equal(stones.filter(({ category }) => category === 'coping').length, 0);
});

test('crenellations emit bonded merlons above the crown', () => {
  const { record, arcTable } = setup(path(), { top: { style: 'crenellated', base: 3.5 } });
  const { stones } = pack(record, arcTable);
  assert.equal(stones.filter(({ category }) => category === 'coping').length, 0);

  const above = stones.filter(({ y }) => y > 3.5);
  assert.ok(above.length > 0, 'merlons must sit above the crown');
  assert.ok(above.every((stone) => stone.support?.role === 'merlon'));
  assert.ok(above.some((stone) => stone.category === 'merlon'));
  // Merlons are packed courses, not single blocks.
  const merlonCount = new Set(above.map(({ s }) => Math.round(s / 1.18))).size;
  assert.ok(above.length > merlonCount, 'expected more than one stone per merlon');
});

test('merlon rhythm does not jump at a module boundary', () => {
  const { record, arcTable } = setup(curvedPath(), {
    top: { style: 'crenellated', base: 3.5 },
  });
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  const middle = arcTable.totalLength / 2;
  const whole = profile.crenellationsOver(0, arcTable.totalLength).map(({ s }) => s);
  const left = profile.crenellationsOver(0, middle).map(({ s }) => s);
  const right = profile.crenellationsOver(middle, arcTable.totalLength).map(({ s }) => s);
  for (const s of [...left, ...right]) {
    assert.ok(whole.some((other) => Math.abs(other - s) < 1e-9), `merlon at ${s} drifted`);
  }
});

test('a raise adds courses rather than stretching stones', () => {
  const { record, arcTable } = setup();
  const flat = pack(record, arcTable);
  const raised = normalizeConstructionRecord({
    ...record,
    top: applyTopEdit(record, arcTable, { centre: 15, direction: 1, radius: 5 }),
  });
  const after = pack(raised, arcTable);
  assert.ok(after.stats.courses >= flat.stats.courses);
  const flatHeights = new Set(flat.stones.map(({ height }) => height.toFixed(3)));
  const afterHeights = new Set(after.stones.map(({ height }) => height.toFixed(3)));
  // Course height is uniform within a wall, so a raise must not double it.
  assert.ok(afterHeights.size <= flatHeights.size + 2);
});
