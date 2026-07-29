import assert from 'node:assert/strict';
import test from 'node:test';
import {
  layoutOpening,
  openingCrownHeight,
  openingHalfWidthAt,
  survivingIntervals,
} from '../src/editor/construction/masonry/OpeningLayout.js';
import { packCurvedWall } from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { resolveCutStroke, resolveWindowGroup } from '../src/editor/construction/ConstructionCutStroke.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

const STYLE = constructionStyle('coursed-rubble');

/**
 * A nearly straight wall that still keeps three segments. Perfectly collinear
 * points are simplified away by the RDP fit, leaving a single segment — which
 * silently breaks any fixture that indexes past `segments[0]`.
 */
function straight(length = 24) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0.01], [(length * 2) / 3, -0.01], [length, 0],
  ], { simplifyTolerance: 0.001 });
}

function setup(overrides = {}, path = straight()) {
  const record = normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 5,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path,
    features: [],
    ...overrides,
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  return { record, arcTable, profile };
}

function pack(context, openings = [], overrides = {}) {
  return packCurvedWall({
    arcTable: context.arcTable,
    arcRange: [0, context.arcTable.totalLength],
    style: STYLE,
    thickness: context.record.dimensions.thickness,
    seed: context.record.seed,
    topHeightAt: context.profile.heightAt,
    ruinFactorAt: context.profile.ruinFactorAt,
    slopeAt: context.profile.slopeAt,
    crenellationsOver: context.profile.crenellationsOver,
    topStyle: context.record.top.style,
    openings,
    budget: 4000,
    ...overrides,
  });
}

function opening(overrides = {}) {
  return {
    id: 'opening-a',
    kind: 'arch',
    s: 12,
    width: 2.4,
    height: 2.6,
    sill: 0,
    profile: 'round',
    dressed: true,
    group: null,
    ...overrides,
  };
}

test('a round opening is full width to the springing then narrows to nothing', () => {
  const arch = opening();
  assert.equal(openingHalfWidthAt(arch, -0.1), 0, 'nothing is reserved below the sill');
  assert.equal(openingHalfWidthAt(arch, 0.5), 1.2);
  assert.equal(openingHalfWidthAt(arch, 1.3), 1.2, 'still full width at the springing');
  assert.ok(openingHalfWidthAt(arch, 2.2) < 1.2, 'the arch narrows above the springing');
  assert.equal(openingHalfWidthAt(arch, 2.7), 0, 'nothing is reserved above the crown');
});

test('a sill keeps the courses below a window unbroken', () => {
  const window = opening({ kind: 'window', sill: 1.2, height: 1.1, width: 0.9 });
  assert.equal(openingHalfWidthAt(window, 0.6), 0);
  assert.ok(openingHalfWidthAt(window, 1.5) > 0);
});

test('a flat-headed opening is a rectangle', () => {
  const flat = opening({ profile: 'flat', height: 2 });
  assert.equal(openingHalfWidthAt(flat, 1.9), 1.2);
  assert.equal(openingHalfWidthAt(flat, 2.1), 0);
});

test('surviving intervals tile the range around the void', () => {
  const spans = survivingIntervals([0, 24], [opening()], 1);
  assert.equal(spans.length, 2);
  assert.ok(spans[0][0] === 0 && spans[0][1] < 12);
  assert.ok(spans[1][0] > 12 && spans[1][1] === 24);
  // Above the crown the course is whole again.
  assert.deepEqual(survivingIntervals([0, 24], [opening()], 3), [[0, 24]]);
});

test('an opening at the wall end clips rather than producing a negative span', () => {
  const spans = survivingIntervals([0, 24], [opening({ s: 0.4 })], 1);
  for (const [from, to] of spans) assert.ok(to > from, `degenerate span ${from}..${to}`);
});

test('stone edges land flush on the jamb line', () => {
  const context = setup();
  const arch = opening();
  const { stones } = pack(context, [arch]);
  const field = stones.filter(({ category }) => category === 'field');
  assert.ok(field.length > 20);

  // For each course crossing the opening, the nearest stone edge either side
  // must sit on the reserved boundary, not wherever a dropped stone ended.
  const courses = new Map();
  for (const stone of field) {
    if (!courses.has(stone.courseIndex)) courses.set(stone.courseIndex, []);
    courses.get(stone.courseIndex).push(stone);
  }
  // The grid the packer solved on: the style's course height flat, from grade up.
  const courseHeight = STYLE.courseHeight;
  let checked = 0;
  for (const [courseIndex, course] of courses) {
    // Reconstruct the *course* centre, the height the opening was reserved
    // against. A stone's own `y` is the centre of its face, which the bed ramp
    // and a horizontal split both move by more than enough to miss the jamb.
    const y = (courseIndex + 0.5) * courseHeight;
    const half = openingHalfWidthAt(arch, y);
    if (half <= 0) continue;
    const spans = survivingIntervals([0, context.arcTable.totalLength], [arch], y);
    const left = Math.max(...course
      .filter((stone) => stone.s < arch.s)
      .map((stone) => stone.s + stone.packedWidth / 2));
    const right = Math.min(...course
      .filter((stone) => stone.s > arch.s)
      .map((stone) => stone.s - stone.packedWidth / 2));
    assert.ok(Math.abs(left - spans[0][1]) < 1e-9, `left jamb ragged: ${left} vs ${spans[0][1]}`);
    assert.ok(Math.abs(right - spans[1][0]) < 1e-9, `right jamb ragged: ${right} vs ${spans[1][0]}`);
    checked += 1;
  }
  assert.ok(checked >= 2, 'the fixture should cross several courses');
});

test('dressings are emitted with their own categories, never as field masonry', () => {
  const context = setup();
  const { stones } = pack(context, [opening()]);
  const categories = new Set(stones.map(({ category }) => category));
  assert.ok(categories.has('voussoir'), 'an arch needs a ring');
  assert.ok(categories.has('ashlar'), 'an arch needs jambs and a keystone');
  // CLAUDE.md: dressings are category-scaled down so they read as worked stone.
  for (const stone of stones) {
    if (stone.category === 'voussoir') assert.ok(Math.abs(stone.roll) <= Math.PI / 2 + 1e-9);
  }
});

test('the voussoir count follows the ring circumference', () => {
  const arch = opening();
  const { voussoirs } = layoutOpening(arch, { thickness: 0.8 });
  const radius = arch.width / 2 + 0.11;
  const expected = Math.max(9, Math.ceil((Math.PI * radius) / 0.28));
  // Two faces per ring block.
  assert.equal(voussoirs.length, expected * 2);
  for (const block of voussoirs) assert.equal(block.category, 'voussoir');
});

test('an undressed opening is a bare void', () => {
  const { jambs, voussoirs, keystone } = layoutOpening(opening({ dressed: false }), {
    thickness: 0.8,
  });
  assert.deepEqual(jambs, []);
  assert.deepEqual(voussoirs, []);
  assert.equal(keystone, null);
});

test('standalone arches: lower the top and cut until only the rings remain', () => {
  // The reference workflow — flatten the top, then draw paths underneath until
  // the wall disappears and only the stone arches are left. The top has to sit
  // below the springing, or the voids narrow near the crown and slivers of
  // walling survive between them.
  const context = setup({ top: { style: 'flat', base: 1.4 } });
  const arches = [];
  for (let s = 1.2; s < context.arcTable.totalLength; s += 2) {
    arches.push(opening({ id: `opening-${arches.length + 1}`, s, width: 2.4, height: 2.4 }));
  }
  const { stones } = pack(context, arches);
  const byCategory = {};
  for (const stone of stones) byCategory[stone.category] = (byCategory[stone.category] ?? 0) + 1;

  assert.ok((byCategory.voussoir ?? 0) > 0, 'the arch rings must survive');
  assert.ok((byCategory.ashlar ?? 0) > 0, 'the jambs must survive');
  assert.equal(byCategory.field ?? 0, 0, 'no field masonry should remain');
  // Nor should coping be left floating over the voids it no longer caps.
  assert.equal(byCategory.coping ?? 0, 0, 'coping must not span an open arcade');
});

test('coping runs unbroken over an arch that does not reach the crown', () => {
  // A 2.6 m arch in a 3.5 m wall leaves masonry above it, so the cap continues
  // across — suppression applies only where the void actually breaks the crown.
  const context = setup();
  const coping = pack(context, [opening()]).stones
    .filter(({ category }) => category === 'coping');
  assert.ok(coping.length > 5);
  assert.ok(
    coping.some((stone) => Math.abs(stone.s - 12) < 1.2),
    'coping should still span directly over the arch',
  );
});

test('an opening is stable when an unrelated part of the wall changes', () => {
  const context = setup();
  const arch = opening();
  const before = pack(context, [arch]);
  // Raise the far end of the wall; the opening's own courses must not move.
  const raised = setup({
    top: {
      style: 'flat',
      base: 3.5,
      profile: [
        { segmentId: context.record.path.segments.at(-1).id, arcFraction: 0.6, height: 3.5 },
        { segmentId: context.record.path.segments.at(-1).id, arcFraction: 0.85, height: 6 },
        { segmentId: context.record.path.segments.at(-1).id, arcFraction: 0.99, height: 3.5 },
      ],
    },
  });
  const after = pack(raised, [arch]);
  const near = (list) => list.stones
    .filter(({ s, category }) => category === 'voussoir' && s < 16)
    .map(({ s, y }) => `${s.toFixed(6)}:${y.toFixed(6)}`);
  assert.deepEqual(near(after), near(before), 'the arch ring drifted');
});

test('a stroke across a wall carves an arch, one that stops at it makes a door', () => {
  const context = setup();
  const records = [context.record];
  const arcTableFor = () => context.arcTable;

  const across = resolveCutStroke([{ x: 12, z: -4 }, { x: 12, z: 0 }, { x: 12, z: 4 }], records, {
    arcTableFor,
  });
  assert.equal(across.length, 1);
  assert.equal(across[0].kind, 'arch');
  assert.equal(across[0].constructionId, 'construction-1');
  assert.ok(across[0].height > 0.6 && across[0].height < 3.5);
  const placed = context.arcTable.toArc(across[0].segmentId, across[0].arcFraction);
  assert.ok(
    Math.abs(placed - 12) < 0.35,
    `arch must land at the crossing (~12), got s=${placed}`,
  );

  const upTo = resolveCutStroke([{ x: 12, z: -4 }, { x: 12, z: -1.5 }, { x: 12, z: -0.25 }], records, {
    arcTableFor,
  });
  assert.equal(upTo.length, 1);
  assert.equal(upTo[0].kind, 'door');

  const misses = resolveCutStroke([{ x: 12, z: -6 }, { x: 12, z: -4 }], records, { arcTableFor });
  assert.deepEqual(misses, []);
});

test('a cut sizes itself under the wall top above it', () => {
  const low = setup({ top: { style: 'flat', base: 2 } });
  const cuts = resolveCutStroke([{ x: 12, z: -4 }, { x: 12, z: 4 }], [low.record], {
    arcTableFor: () => low.arcTable,
    heightAt: (record, s) => low.profile.heightAt(s),
  });
  assert.equal(cuts.length, 1);
  assert.ok(cuts[0].height < 2, 'the opening must fit under a 2 m wall');
});

test('windows link when close and stay separate under Ctrl', () => {
  const segmentId = straight().segments[1].id;
  const context = setup({
    features: [{
      id: 'opening-1', kind: 'window', segmentId, arcFraction: 0.5, width: 0.9, height: 1.1, sill: 1.2,
    }],
  });
  const existing = context.record.features[0];
  const [start, end] = context.arcTable.segmentRange(segmentId);
  const span = end - start;
  const arcOf = (offset) => ({
    segmentId,
    arcFraction: existing.arcFraction + offset / span,
  });

  assert.ok(
    resolveWindowGroup(context.record, arcOf(1.1), context.arcTable),
    'a window 1.1 m away is inside the 1.6 m link radius',
  );
  assert.equal(
    resolveWindowGroup(context.record, arcOf(1.1), context.arcTable, { link: false }),
    null,
    'Left Ctrl must suppress the link',
  );
  assert.equal(
    resolveWindowGroup(context.record, arcOf(2.6), context.arcTable),
    null,
    'a window well beyond the radius stays standalone',
  );
});

test('crown height accounts for the arch ring', () => {
  assert.ok(openingCrownHeight(opening()) > opening().height);
  assert.ok(openingCrownHeight(opening({ profile: 'flat', height: 2 })) > 2);
});

test('soft-limestone-rubble openings stay clear and keep plumb jambs', () => {
  const soft = constructionStyle('soft-limestone-rubble');
  const path = straight(30);
  const segmentId = path.segments[1].id;
  const context = setup({
    style: { key: 'soft-limestone-rubble', version: 1 },
    features: [
      {
        id: 'opening-arch',
        kind: 'arch',
        segmentId,
        arcFraction: 0.25,
        width: 2.2,
        height: 2.5,
        sill: 0,
        profile: 'round',
        dressed: true,
      },
      {
        id: 'opening-door',
        kind: 'door',
        segmentId,
        arcFraction: 0.55,
        width: 1.2,
        height: 2.2,
        sill: 0,
        profile: 'flat',
        dressed: true,
      },
      {
        id: 'opening-window',
        kind: 'window',
        segmentId,
        arcFraction: 0.8,
        width: 0.9,
        height: 1.1,
        sill: 1.2,
        profile: 'flat',
        dressed: true,
      },
    ],
  }, path);
  const profile = createWallTopProfile(context.record, context.arcTable, { style: soft });
  const openings = context.record.features.map((feature) => {
    const [from, to] = context.arcTable.segmentRange(feature.segmentId);
    return {
      ...feature,
      s: from + (to - from) * feature.arcFraction,
    };
  });
  const { stones } = packCurvedWall({
    arcTable: context.arcTable,
    arcRange: [0, context.arcTable.totalLength],
    style: soft,
    thickness: context.record.dimensions.thickness,
    seed: context.record.seed,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    slopeAt: profile.slopeAt,
    openings,
    budget: 4000,
  });

  const field = stones.filter(({ category }) => category === 'field');
  assert.ok(field.length > 40);
  const courseHeight = soft.courseHeight;
  for (const stone of field) {
    if (stone.courseIndex == null) continue;
    // Openings are reserved against the course centre, not the leaf face centre.
    const courseY = (stone.courseIndex + 0.5) * courseHeight;
    for (const voidOpening of openings) {
      const half = openingHalfWidthAt(voidOpening, courseY);
      if (!(half > 0)) continue;
      const left = voidOpening.s - half;
      const right = voidOpening.s + half;
      const stoneLeft = stone.s - stone.packedWidth / 2;
      const stoneRight = stone.s + stone.packedWidth / 2;
      assert.ok(
        stoneRight <= left + 1e-6 || stoneLeft >= right - 1e-6,
        `field stone crosses ${voidOpening.id} at course ${stone.courseIndex}`,
      );
    }
  }

  // Jamb-adjacent soft stones still respect one-level split depth.
  const byCell = new Map();
  for (const stone of field) {
    if (stone.cellIndex == null) continue;
    if (!byCell.has(stone.cellIndex)) byCell.set(stone.cellIndex, []);
    byCell.get(stone.cellIndex).push(stone);
  }
  for (const leaves of byCell.values()) {
    assert.ok(leaves.length <= 2);
  }
});

test('a segmental void closes at the authored crown', () => {
  const arch = opening({ profile: 'segmental', height: 2.6, width: 2.4 });
  const crown = arch.sill + arch.height;
  assert.equal(openingHalfWidthAt(arch, crown), 0, 'void must pinch at sill+height');
  assert.ok(openingHalfWidthAt(arch, crown - 0.05) > 0, 'void still open just below the crown');
  assert.ok(openingHalfWidthAt(arch, arch.sill + arch.height * 0.72) === 1.2, 'full width at springing');
  const { keystone, voussoirs } = layoutOpening(arch, { thickness: 0.8 });
  assert.ok(keystone.y <= crown + 0.3, `keystone at ${keystone.y} overshoots crown ${crown}`);
  assert.ok(voussoirs.every((unit) => unit.y <= crown + 0.35));
  assert.ok(openingCrownHeight(arch) <= crown + 0.3);
});

test('a pointed void pinches at the authored crown with leaf dressings', () => {
  const arch = opening({ profile: 'pointed', height: 2.8, width: 2.0 });
  const crown = arch.sill + arch.height;
  assert.equal(openingHalfWidthAt(arch, crown), 0);
  assert.ok(openingHalfWidthAt(arch, crown - 0.1) > 0);
  const { keystone, voussoirs } = layoutOpening(arch, { thickness: 0.8 });
  assert.ok(voussoirs.length > 0);
  assert.ok(Math.abs(keystone.y - crown) < 0.05, `keystone ${keystone.y} vs crown ${crown}`);
  // Dressings stay near the two leaf arcs rather than climbing a full semicircle.
  assert.ok(voussoirs.every((unit) => unit.y <= crown + 0.2));
});

test('only the module that owns the opening centre emits dressings', () => {
  const context = setup({}, straight(30));
  const arch = opening({ s: 12 });
  const left = pack(context, [arch], { arcRange: [0, 12], wallRange: [0, 30] });
  const right = pack(context, [arch], { arcRange: [12, 24], wallRange: [0, 30] });
  const keystones = (stones) => stones.filter((stone) => stone.support?.role === 'keystone');
  assert.equal(keystones(left.stones).length, 0, 'left module ends at the centre and must not dress');
  assert.equal(keystones(right.stones).length, 1, 'right module owns the centre');

  const interior = opening({ s: 6 });
  const leftInterior = pack(context, [interior], { arcRange: [0, 12], wallRange: [0, 30] });
  const rightInterior = pack(context, [interior], { arcRange: [12, 24], wallRange: [0, 30] });
  assert.equal(keystones(leftInterior.stones).length, 1);
  assert.equal(keystones(rightInterior.stones).length, 0);
});
