/**
 * Wall-wide support resolver for ruined masonry.
 */

import {
  CONSTRUCTION_SUPPORT_ROLE,
  RUIN_REMOVAL_REASON,
} from './ConstructionSupportRoles.js';
import { resolveRuinClusters } from './RuinClusterResolver.js';
import { coverageWithinSpan, findOverlapCandidates } from './RuinSupportIntervals.js';

function emptyStats() {
  return {
    ruinCandidates: 0,
    preliminaryDamage: 0,
    isolatedHolesRestored: 0,
    clustersExpanded: 0,
    damageClusters: 0,
    supportEdges: 0,
    supportChecks: 0,
    supportIterations: 0,
    unsupportedRemoved: 0,
    cantileverRemoved: 0,
    bridgeRemoved: 0,
    pinnaclesRemoved: 0,
    archesKept: 0,
    archesRemoved: 0,
    jambUnitsRemoved: 0,
    finalSurvivors: 0,
    finalRemoved: 0,
    maximumClusterWidth: 0,
    maximumPropagationDistance: 0,
    damageResolveMs: 0,
    supportResolveMs: 0,
  };
}

function compareSupportOrder(a, b) {
  const course = (a.support?.courseIndex ?? 0) - (b.support?.courseIndex ?? 0);
  if (course !== 0) return course;
  const s = (a.support?.span?.[0] ?? a.s) - (b.support?.span?.[0] ?? b.s);
  if (s !== 0) return s;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function evaluateSupport(stone, lowerCourse, profile, survivors) {
  const [s0, s1] = stone.support.span;
  const candidates = findOverlapCandidates(lowerCourse, s0, s1, profile.support.maximumCantilever);
  const supports = [];
  for (const lower of candidates) {
    if (!survivors.has(lower._ruinId)) continue;
    const gap = stone.support.bottom - lower.support.top;
    if (
      gap < -profile.support.verticalTolerance
      || gap > profile.support.verticalTolerance
    ) {
      continue;
    }
    supports.push(lower.support.span);
  }
  return coverageWithinSpan(s0, s1, supports);
}

function isDirectlySupported(coverage, profile, role) {
  if (role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) return true;
  if (role === CONSTRUCTION_SUPPORT_ROLE.ARCH || role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE) {
    // Handled separately.
    return coverage.ratio >= profile.support.minimumOverlapRatio;
  }
  if (coverage.covered < profile.support.minimumAbsoluteOverlap) return false;
  if (coverage.ratio < profile.support.minimumOverlapRatio) return false;
  if (coverage.leftOverhang > profile.support.maximumCantilever) return false;
  if (coverage.rightOverhang > profile.support.maximumCantilever) return false;
  if (coverage.largestGap > profile.crown.maximumBridgeSpan) return false;
  return true;
}

function markRemoved(removed, placement, reason, stats) {
  removed.push(Object.freeze({ placement, reason, clusterId: placement.ruin?.clusterId ?? null }));
  if (reason === RUIN_REMOVAL_REASON.UNSUPPORTED) stats.unsupportedRemoved += 1;
  else if (reason === RUIN_REMOVAL_REASON.EXCESSIVE_CANTILEVER) stats.cantileverRemoved += 1;
  else if (reason === RUIN_REMOVAL_REASON.BRIDGE_SPAN) stats.bridgeRemoved += 1;
  else if (reason === RUIN_REMOVAL_REASON.PINNACLE) stats.pinnaclesRemoved += 1;
  else if (reason === RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED) {
    stats.archesRemoved += 1;
    if (placement.support?.role === CONSTRUCTION_SUPPORT_ROLE.JAMB) {
      stats.jambUnitsRemoved += 1;
    }
  }
}

/**
 * Resolve clustered damage then structural support across all wall modules.
 *
 * @param {{ modules: Array<{ id: string, placements: object[] }>, profile: object }} args
 */
export function resolveRuinSupport({
  modules,
  profile,
}) {
  const stats = emptyStats();
  const damageStarted = performance.now();

  const flattened = [];
  let nextId = 1;
  for (const module of modules) {
    for (const placement of module.placements ?? []) {
      const tagged = Object.freeze({
        ...placement,
        moduleId: placement.moduleId ?? module.id,
        _ruinId: nextId,
      });
      nextId += 1;
      if (placement.ruin?.candidate) stats.ruinCandidates += 1;
      flattened.push(tagged);
    }
  }

  // Clip dressings above collapse envelope.
  const clipped = [];
  const preRemoved = [];
  for (const placement of flattened) {
    if (
      placement.support?.role
      && placement.support.role !== CONSTRUCTION_SUPPORT_ROLE.FIELD
      && placement.support.role !== CONSTRUCTION_SUPPORT_ROLE.FOUNDATION
      && placement.ruin?.aboveEnvelope
    ) {
      markRemoved(preRemoved, placement, RUIN_REMOVAL_REASON.ABOVE_ENVELOPE, stats);
      continue;
    }
    clipped.push(placement);
  }

  const clustered = resolveRuinClusters({
    placements: clipped,
    profile,
  });
  stats.damageResolveMs = performance.now() - damageStarted;
  stats.preliminaryDamage += clustered.stats.preliminaryDamage;
  stats.isolatedHolesRestored += clustered.stats.isolatedHolesRestored;
  stats.clustersExpanded += clustered.stats.clustersExpanded;
  stats.damageClusters += clustered.stats.damageClusters;
  stats.maximumClusterWidth = Math.max(
    stats.maximumClusterWidth,
    clustered.stats.maximumClusterWidth,
  );

  const supportStarted = performance.now();
  const survivors = new Map();
  for (const placement of clustered.survivors) {
    survivors.set(placement._ruinId, placement);
  }
  const removed = [...preRemoved, ...clustered.removed];

  // Group by course for lower-support lookup.
  const byCourse = new Map();
  for (const placement of survivors.values()) {
    const course = placement.support?.courseIndex ?? 0;
    if (!byCourse.has(course)) byCourse.set(course, []);
    byCourse.get(course).push(placement);
  }
  for (const list of byCourse.values()) {
    list.sort(compareSupportOrder);
  }

  const courseKeys = [...byCourse.keys()].sort((a, b) => a - b);
  const reverseDeps = new Map();

  const queue = [];
  for (const course of courseKeys) {
    const stones = byCourse.get(course);
    const lower = byCourse.get(course - 1) ?? [];
    const lower2 = byCourse.get(course - 2) ?? [];
    const lowerPool = [...lower, ...lower2].sort(compareSupportOrder);

    for (const stone of stones) {
      const role = stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
      stats.supportChecks += 1;

      if (role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) continue;
      if (role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE || role === CONSTRUCTION_SUPPORT_ROLE.ARCH) {
        continue; // openings pass later
      }

      const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
      stats.supportEdges += coverage.merged.length;

      // Record reverse edges for propagation (approximate: all overlapping lower).
      for (const lowerStone of findOverlapCandidates(
        lowerPool,
        stone.support.span[0],
        stone.support.span[1],
        profile.support.maximumCantilever,
      )) {
        if (!survivors.has(lowerStone._ruinId)) continue;
        if (!reverseDeps.has(lowerStone._ruinId)) reverseDeps.set(lowerStone._ruinId, []);
        reverseDeps.get(lowerStone._ruinId).push(stone._ruinId);
      }

      if (!isDirectlySupported(coverage, profile, role)) {
        let reason = RUIN_REMOVAL_REASON.UNSUPPORTED;
        if (coverage.leftOverhang > profile.support.maximumCantilever
          || coverage.rightOverhang > profile.support.maximumCantilever) {
          reason = RUIN_REMOVAL_REASON.EXCESSIVE_CANTILEVER;
        } else if (coverage.largestGap > profile.crown.maximumBridgeSpan) {
          reason = RUIN_REMOVAL_REASON.BRIDGE_SPAN;
        }
        queue.push({ id: stone._ruinId, reason });
      }
    }
  }

  // Opening / arch groups.
  const archGroups = new Map();
  for (const stone of survivors.values()) {
    const groupId = stone.support?.groupId;
    if (!groupId) continue;
    if (!archGroups.has(groupId)) archGroups.set(groupId, []);
    archGroups.get(groupId).push(stone);
  }
  for (const [groupId, units] of archGroups) {
    void groupId;
    const springs = units.filter((unit) => unit.support?.archOrdinal === 0
      || unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.JAMB);
    const arches = units.filter((unit) => (
      unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.ARCH
      || unit.support?.role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE
    ));
    if (arches.length === 0) continue;

    const left = springs.find((unit) => (unit.support?.side ?? 0) < 0)
      ?? springs[0];
    const right = springs.find((unit) => (unit.support?.side ?? 0) > 0)
      ?? springs[springs.length - 1];
    const springsOk = Boolean(
      left && right
      && survivors.has(left._ruinId)
      && survivors.has(right._ruinId),
    );

    if (profile.openings.archRequiresBothSprings && !springsOk) {
      for (const unit of arches) {
        if (survivors.has(unit._ruinId)) {
          queue.push({ id: unit._ruinId, reason: RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED });
        }
      }
    } else {
      stats.archesKept += 1;
    }
  }

  queue.sort((a, b) => {
    const left = survivors.get(a.id);
    const right = survivors.get(b.id);
    if (!left || !right) return (a.id - b.id);
    return compareSupportOrder(left, right);
  });

  let steps = 0;
  const seen = new Set();
  while (queue.length > 0 && steps < profile.support.maximumPropagationSteps * survivors.size) {
    steps += 1;
    stats.supportIterations += 1;
    const { id, reason } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const stone = survivors.get(id);
    if (!stone) continue;
    survivors.delete(id);
    markRemoved(removed, stone, reason, stats);

    for (const dependantId of reverseDeps.get(id) ?? []) {
      if (!survivors.has(dependantId) || seen.has(dependantId)) continue;
      const dependant = survivors.get(dependantId);
      const course = dependant.support?.courseIndex ?? 0;
      const lowerPool = [
        ...(byCourse.get(course - 1) ?? []),
        ...(byCourse.get(course - 2) ?? []),
      ].filter((candidate) => survivors.has(candidate._ruinId));
      const coverage = evaluateSupport(dependant, lowerPool, profile, survivors);
      if (!isDirectlySupported(coverage, profile, dependant.support?.role)) {
        queue.push({ id: dependantId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
      }
    }
  }

  // Crown pinnacle cleanup.
  if (profile.crown.removeUnsupportedPinnacles) {
    const remaining = [...survivors.values()].sort(compareSupportOrder);
    const byCourseNow = new Map();
    for (const stone of remaining) {
      const course = stone.support?.courseIndex ?? 0;
      if (!byCourseNow.has(course)) byCourseNow.set(course, []);
      byCourseNow.get(course).push(stone);
    }
    for (const list of byCourseNow.values()) list.sort(compareSupportOrder);

    for (const stone of remaining) {
      if (!survivors.has(stone._ruinId)) continue;
      const role = stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
      if (role !== CONSTRUCTION_SUPPORT_ROLE.FIELD) continue;
      const course = stone.support.courseIndex;
      const above = byCourseNow.get(course + 1) ?? [];
      const hasAbove = above.some((candidate) => (
        survivors.has(candidate._ruinId)
        && coverageWithinSpan(
          stone.support.span[0],
          stone.support.span[1],
          [candidate.support.span],
        ).covered > 0
      ));
      if (hasAbove) continue;

      const same = byCourseNow.get(course) ?? [];
      const neighbours = same.filter((candidate) => (
        candidate._ruinId !== stone._ruinId
        && survivors.has(candidate._ruinId)
        && (
          Math.abs(candidate.support.span[0] - stone.support.span[1]) < 0.08
          || Math.abs(candidate.support.span[1] - stone.support.span[0]) < 0.08
        )
      ));
      if (neighbours.length > 0) continue;

      const width = stone.support.span[1] - stone.support.span[0];
      const lowerPool = [
        ...(byCourseNow.get(course - 1) ?? []),
        ...(byCourseNow.get(course - 2) ?? []),
      ].filter((candidate) => survivors.has(candidate._ruinId));
      const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
      const toothCourses = 1;
      if (
        width < profile.crown.minimumToothWidth
        || coverage.ratio < profile.crown.isolatedToothStrongSupport
        || toothCourses > profile.crown.maximumSupportedToothCourses
      ) {
        survivors.delete(stone._ruinId);
        markRemoved(removed, stone, RUIN_REMOVAL_REASON.PINNACLE, stats);
      }
    }
  }

  stats.supportResolveMs = performance.now() - supportStarted;
  stats.finalSurvivors = survivors.size;
  stats.finalRemoved = removed.length;

  // Mark damage voids on survivors that neighbour removals (for coarse LOD).
  const removedSpansByCourse = new Map();
  for (const entry of removed) {
    const placement = entry.placement;
    if ((placement.support?.role ?? placement.category) !== CONSTRUCTION_SUPPORT_ROLE.FIELD
      && placement.category !== 'field') {
      continue;
    }
    const course = placement.support?.courseIndex ?? placement.courseIndex ?? 0;
    if (!removedSpansByCourse.has(course)) removedSpansByCourse.set(course, []);
    removedSpansByCourse.get(course).push(placement.support?.span ?? [
      placement.s - placement.packedWidth / 2,
      placement.s + placement.packedWidth / 2,
    ]);
  }

  const finalByModule = new Map(modules.map((module) => [module.id, []]));
  for (const stone of survivors.values()) {
    const moduleId = stone.moduleId;
    const course = stone.support?.courseIndex ?? 0;
    const voids = removedSpansByCourse.get(course) ?? [];
    const [s0, s1] = stone.support?.span ?? [stone.s, stone.s];
    let nearVoid = false;
    for (const [v0, v1] of voids) {
      if (v0 <= s1 + 0.05 && v1 >= s0 - 0.05) {
        nearVoid = true;
        break;
      }
    }
    const {
      _ruinId,
      moduleId: ownedModuleId,
      ...rest
    } = stone;
    void _ruinId;
    const finalStone = Object.freeze({
      ...rest,
      moduleId: ownedModuleId,
      ruin: Object.freeze({
        ...(stone.ruin ?? {}),
        damageVoid: nearVoid,
        exposedTop: true,
      }),
    });
    if (!finalByModule.has(moduleId)) finalByModule.set(moduleId, []);
    finalByModule.get(moduleId).push(finalStone);
  }

  const resolvedModules = modules.map((module) => Object.freeze({
    ...module,
    placements: Object.freeze(finalByModule.get(module.id) ?? []),
  }));

  return {
    modules: Object.freeze(resolvedModules),
    removed: Object.freeze(removed),
    supportGraph: Object.freeze({ reverseDepsSize: reverseDeps.size }),
    stats: Object.freeze(stats),
  };
}
