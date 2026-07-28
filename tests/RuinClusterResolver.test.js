import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionRuinProfile } from '../src/editor/construction/config/ConstructionRuinConfig.generated.js';
import { CONSTRUCTION_SUPPORT_ROLE } from '../src/editor/construction/masonry/ConstructionSupportRoles.js';
import { resolveRuinClusters } from '../src/editor/construction/masonry/RuinClusterResolver.js';

const profile = constructionRuinProfile('default');

function stone(id, s0, s1, score, candidate, courseIndex = 2) {
  return Object.freeze({
    category: 'field',
    s: (s0 + s1) / 2,
    packedWidth: s1 - s0,
    stableIndex: id,
    courseIndex,
    support: Object.freeze({
      role: CONSTRUCTION_SUPPORT_ROLE.FIELD,
      span: Object.freeze([s0, s1]),
      bottom: 1,
      top: 1.4,
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

test('weak isolated hole is restored', () => {
  const placements = [
    stone(1, 0, 0.5, 0.1, false),
    stone(2, 0.5, 1.0, 0.6, true),
    stone(3, 1.0, 1.5, 0.1, false),
  ];
  const resolved = resolveRuinClusters({ placements, profile });
  assert.equal(resolved.stats.isolatedHolesRestored, 1);
  assert.equal(resolved.removed.length, 0);
  assert.equal(resolved.survivors.filter((entry) => entry.category === 'field').length, 3);
});

test('severe isolated hole may remain', () => {
  const placements = [
    stone(1, 0, 0.5, 0.1, false),
    stone(2, 0.5, 1.0, 0.95, true),
    stone(3, 1.0, 1.5, 0.1, false),
  ];
  const resolved = resolveRuinClusters({ placements, profile });
  assert.equal(resolved.removed.length, 1);
  assert.equal(resolved.removed[0].placement.stableIndex, 2);
});

test('strong adjacent removals stay clustered', () => {
  const placements = [
    stone(1, 0, 0.5, 0.1, false),
    stone(2, 0.5, 1.0, 0.85, true),
    stone(3, 1.0, 1.5, 0.88, true),
    stone(4, 1.5, 2.0, 0.1, false),
  ];
  const resolved = resolveRuinClusters({ placements, profile });
  assert.ok(resolved.stats.damageClusters >= 1);
  assert.equal(resolved.removed.length, 2);
});

test('severe expansion is one bounded cluster rather than a rightward chain', () => {
  const placements = [
    stone(1, 0, 0.5, 0.1, false),
    stone(2, 0.5, 1.0, 0.55, false),
    stone(3, 1.0, 1.5, 0.95, true),
    stone(4, 1.5, 2.0, 0.55, false),
    stone(5, 2.0, 2.5, 0.55, false),
  ];
  const resolved = resolveRuinClusters({ placements, profile });
  assert.deepEqual(
    resolved.removed.map((entry) => entry.placement.stableIndex),
    [2, 3, 4],
  );
  assert.equal(resolved.stats.damageClusters, 1);
  assert.equal(resolved.stats.clustersExpanded, 2);
  assert.equal(new Set(resolved.removed.map((entry) => entry.clusterId)).size, 1);
});

test('course and input ordering do not alter survivors or cluster ids', () => {
  const placements = [
    stone(1, 0, 0.5, 0.1, false, 3),
    stone(2, 0.5, 1.0, 0.85, true, 3),
    stone(3, 1.0, 1.5, 0.88, true, 3),
    stone(4, 1.5, 2.0, 0.1, false, 3),
    stone(5, 0, 0.5, 0.95, true, 1),
  ];
  const a = resolveRuinClusters({ placements, profile });
  const b = resolveRuinClusters({ placements: [...placements].reverse(), profile });
  assert.deepEqual(
    a.removed.map((entry) => entry.placement.stableIndex).sort((x, y) => x - y),
    b.removed.map((entry) => entry.placement.stableIndex).sort((x, y) => x - y),
  );
  assert.deepEqual(
    a.removed.map((entry) => entry.clusterId).sort(),
    b.removed.map((entry) => entry.clusterId).sort(),
  );
});

test('adding an earlier unrelated cluster does not renumber a later cluster', () => {
  const later = [
    stone(10, 10, 10.5, 0.1, false, 3),
    stone(11, 10.5, 11, 0.95, true, 3),
    stone(12, 11, 11.5, 0.1, false, 3),
  ];
  const before = resolveRuinClusters({ placements: later, profile });
  const after = resolveRuinClusters({
    placements: [
      stone(1, 0, 0.5, 0.95, true, 1),
      ...later,
    ],
    profile,
  });
  const beforeId = before.removed.find((entry) => entry.placement.stableIndex === 11)?.clusterId;
  const afterId = after.removed.find((entry) => entry.placement.stableIndex === 11)?.clusterId;
  assert.equal(afterId, beforeId);
});
