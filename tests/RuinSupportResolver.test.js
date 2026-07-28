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
