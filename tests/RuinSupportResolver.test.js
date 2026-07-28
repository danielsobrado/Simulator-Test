import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionRuinProfile } from '../src/editor/construction/config/ConstructionRuinConfig.generated.js';
import { CONSTRUCTION_SUPPORT_ROLE } from '../src/editor/construction/masonry/ConstructionSupportRoles.js';
import { resolveRuinSupport } from '../src/editor/construction/masonry/RuinSupportResolver.js';

const profile = constructionRuinProfile('default');

function fieldStone({
  id,
  s0,
  s1,
  bottom,
  top,
  courseIndex,
  candidate = false,
  score = 0.2,
}) {
  return Object.freeze({
    category: 'field',
    s: (s0 + s1) / 2,
    y: (bottom + top) / 2,
    packedWidth: s1 - s0,
    width: s1 - s0,
    height: top - bottom,
    stableIndex: id,
    courseIndex,
    heightRatio: top / 4,
    support: Object.freeze({
      role: courseIndex === 0
        ? CONSTRUCTION_SUPPORT_ROLE.FOUNDATION
        : CONSTRUCTION_SUPPORT_ROLE.FIELD,
      span: Object.freeze([s0, s1]),
      bottom,
      top,
      courseIndex,
      groupId: null,
    }),
    ruin: Object.freeze({
      candidate,
      score,
      clusterScore: score,
      proximity: score,
    }),
  });
}

test('removing a lower stone removes the unsupported upper stone', () => {
  const modules = [{
    id: 'm0',
    placements: [
      fieldStone({ id: 1, s0: 0, s1: 0.6, bottom: 0, top: 0.4, courseIndex: 0 }),
      fieldStone({
        id: 2, s0: 0, s1: 0.6, bottom: 0.4, top: 0.8, courseIndex: 1, candidate: true, score: 0.9,
      }),
      fieldStone({ id: 3, s0: 0, s1: 0.6, bottom: 0.8, top: 1.2, courseIndex: 2 }),
    ],
  }];
  const resolved = resolveRuinSupport({ modules, profile });
  const survivors = resolved.modules[0].placements.map((stone) => stone.stableIndex).sort();
  assert.ok(!survivors.includes(2));
  assert.ok(!survivors.includes(3));
  assert.ok(survivors.includes(1));
});

test('supported column survives', () => {
  const modules = [{
    id: 'm0',
    placements: [
      fieldStone({ id: 1, s0: 0, s1: 0.6, bottom: 0, top: 0.4, courseIndex: 0 }),
      fieldStone({ id: 2, s0: 0, s1: 0.6, bottom: 0.4, top: 0.8, courseIndex: 1 }),
      fieldStone({ id: 3, s0: 0, s1: 0.6, bottom: 0.8, top: 1.2, courseIndex: 2 }),
    ],
  }];
  const resolved = resolveRuinSupport({ modules, profile });
  assert.equal(resolved.modules[0].placements.length, 3);
});

test('cross-module support keeps the upper stone', () => {
  const modules = [
    {
      id: 'm0',
      placements: [
        fieldStone({ id: 1, s0: 0, s1: 0.6, bottom: 0, top: 0.4, courseIndex: 0 }),
      ],
    },
    {
      id: 'm1',
      placements: [
        fieldStone({ id: 2, s0: 0, s1: 0.6, bottom: 0.4, top: 0.8, courseIndex: 1 }),
      ],
    },
  ];
  const resolved = resolveRuinSupport({ modules, profile });
  assert.equal(resolved.modules[1].placements.length, 1);
  assert.equal(resolved.modules[1].placements[0].stableIndex, 2);
});

test('shuffle does not change survivors', () => {
  const placements = [
    fieldStone({ id: 1, s0: 0, s1: 0.5, bottom: 0, top: 0.4, courseIndex: 0 }),
    fieldStone({ id: 2, s0: 0.5, s1: 1.0, bottom: 0, top: 0.4, courseIndex: 0 }),
    fieldStone({ id: 3, s0: 0, s1: 0.5, bottom: 0.4, top: 0.8, courseIndex: 1 }),
    fieldStone({
      id: 4, s0: 0.5, s1: 1.0, bottom: 0.4, top: 0.8, courseIndex: 1, candidate: true, score: 0.95,
    }),
  ];
  const a = resolveRuinSupport({
    modules: [{ id: 'm0', placements }],
    profile,
  });
  const b = resolveRuinSupport({
    modules: [{ id: 'm0', placements: [...placements].reverse() }],
    profile,
  });
  assert.deepEqual(
    a.modules[0].placements.map((stone) => stone.stableIndex).sort(),
    b.modules[0].placements.map((stone) => stone.stableIndex).sort(),
  );
});

function jambStone({
  id,
  s0,
  s1,
  bottom,
  top,
  side,
  jambOrdinal,
  openingId = 'door',
}) {
  return Object.freeze({
    category: 'jamb',
    s: (s0 + s1) / 2,
    y: (bottom + top) / 2,
    packedWidth: s1 - s0,
    width: s1 - s0,
    height: top - bottom,
    stableIndex: id,
    courseIndex: -1,
    support: Object.freeze({
      role: CONSTRUCTION_SUPPORT_ROLE.JAMB,
      span: Object.freeze([s0, s1]),
      bottom,
      top,
      courseIndex: -1,
      jambOrdinal,
      side,
      groupId: `opening:${openingId}:${side < 0 ? 'left' : 'right'}-jamb`,
    }),
    ruin: Object.freeze({ candidate: false, score: 0, clusterScore: 0, proximity: 0 }),
  });
}

function archStone({
  id,
  s0,
  s1,
  bottom,
  top,
  openingId = 'door',
  role = CONSTRUCTION_SUPPORT_ROLE.ARCH,
}) {
  return Object.freeze({
    category: role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE ? 'keystone' : 'voussoir',
    s: (s0 + s1) / 2,
    y: (bottom + top) / 2,
    packedWidth: s1 - s0,
    width: s1 - s0,
    height: top - bottom,
    stableIndex: id,
    courseIndex: -1,
    support: Object.freeze({
      role,
      span: Object.freeze([s0, s1]),
      bottom,
      top,
      courseIndex: -1,
      jambOrdinal: null,
      groupId: `opening:${openingId}:arch`,
      archOrdinal: id,
    }),
    ruin: Object.freeze({ candidate: false, score: 0, clusterScore: 0, proximity: 0 }),
  });
}

test('arch collapses when one jamb side is missing', () => {
  const modules = [{
    id: 'm0',
    placements: [
      fieldStone({ id: 1, s0: 0, s1: 0.5, bottom: 0, top: 0.4, courseIndex: 0 }),
      fieldStone({ id: 2, s0: 1.5, s1: 2.0, bottom: 0, top: 0.4, courseIndex: 0 }),
      jambStone({
        id: 10, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1, jambOrdinal: 0,
      }),
      // right jamb deliberately omitted
      archStone({ id: 20, s0: 0.55, s1: 1.45, bottom: 1.2, top: 1.5 }),
      archStone({
        id: 21, s0: 0.9, s1: 1.1, bottom: 1.45, top: 1.7, role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
      }),
    ],
  }];
  const resolved = resolveRuinSupport({ modules, profile });
  const survivors = resolved.modules[0].placements.map((stone) => stone.stableIndex);
  assert.ok(!survivors.includes(20));
  assert.ok(!survivors.includes(21));
  assert.ok(survivors.includes(10));
  assert.ok(resolved.stats.archesRemoved >= 1);
});

test('arch keeps when both jamb groups survive', () => {
  const modules = [{
    id: 'm0',
    placements: [
      fieldStone({ id: 1, s0: 0, s1: 0.5, bottom: 0, top: 0.4, courseIndex: 0 }),
      fieldStone({ id: 2, s0: 1.5, s1: 2.0, bottom: 0, top: 0.4, courseIndex: 0 }),
      jambStone({
        id: 10, s0: 0.4, s1: 0.55, bottom: 0.4, top: 1.2, side: -1, jambOrdinal: 0,
      }),
      jambStone({
        id: 11, s0: 1.45, s1: 1.6, bottom: 0.4, top: 1.2, side: 1, jambOrdinal: 0,
      }),
      archStone({ id: 20, s0: 0.55, s1: 1.45, bottom: 1.2, top: 1.5 }),
    ],
  }];
  const resolved = resolveRuinSupport({ modules, profile });
  const survivors = resolved.modules[0].placements.map((stone) => stone.stableIndex);
  assert.ok(survivors.includes(20));
  assert.ok(resolved.stats.archesKept >= 1);
});

test('foundationTolerance keeps field stone over a larger bed gap', () => {
  const gap = profile.support.verticalTolerance + 0.02;
  assert.ok(gap <= profile.support.foundationTolerance);
  const modules = [{
    id: 'm0',
    placements: [
      fieldStone({ id: 1, s0: 0, s1: 0.6, bottom: 0, top: 0.4, courseIndex: 0 }),
      fieldStone({
        id: 2,
        s0: 0,
        s1: 0.6,
        bottom: 0.4 + gap,
        top: 0.8 + gap,
        courseIndex: 1,
      }),
    ],
  }];
  const resolved = resolveRuinSupport({ modules, profile });
  assert.equal(resolved.modules[0].placements.length, 2);
});

test('tall isolated tooth is pruned using measured course count', () => {
  const placements = [
    fieldStone({ id: 1, s0: 0, s1: 0.25, bottom: 0, top: 0.4, courseIndex: 0 }),
    fieldStone({ id: 2, s0: 0, s1: 0.25, bottom: 0.4, top: 0.8, courseIndex: 1 }),
    fieldStone({ id: 3, s0: 0, s1: 0.25, bottom: 0.8, top: 1.2, courseIndex: 2 }),
    fieldStone({ id: 4, s0: 0, s1: 0.25, bottom: 1.2, top: 1.6, courseIndex: 3 }),
    fieldStone({ id: 5, s0: 0, s1: 0.25, bottom: 1.6, top: 2.0, courseIndex: 4 }),
  ];
  assert.ok(placements.length - 1 > profile.crown.maximumSupportedToothCourses);
  const resolved = resolveRuinSupport({
    modules: [{ id: 'm0', placements }],
    profile,
  });
  const survivors = resolved.modules[0].placements.map((stone) => stone.stableIndex);
  assert.ok(resolved.stats.pinnaclesRemoved >= 1);
  assert.ok(!survivors.includes(5));
});
