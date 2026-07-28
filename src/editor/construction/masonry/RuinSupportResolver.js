/**
 * Wall-wide support resolver for ruined masonry.
 */

import { resolveArchCompression } from './RuinArchCompression.js';
import { resolveRuinClusters } from './RuinClusterResolver.js';
import { coverageWithinSpan, findOverlapCandidates } from './RuinSupportIntervals.js';
import { RUIN_DEBUG_STATE } from './RuinDebugStates.js';
import {
  CONSTRUCTION_SUPPORT_ROLE,
  RUIN_REMOVAL_REASON,
} from './ConstructionSupportRoles.js';

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

function isLatticeRole(role) {
  return (
    role === CONSTRUCTION_SUPPORT_ROLE.FIELD
    || role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION
  );
}

function compareSupportOrder(a, b) {
  const course = (a.support?.courseIndex ?? 0) - (b.support?.courseIndex ?? 0);
  if (course !== 0) return course;
  const s = (a.support?.span?.[0] ?? a.s) - (b.support?.span?.[0] ?? b.s);
  if (s !== 0) return s;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function compareJambOrder(a, b) {
  const ordinal = (a.support?.jambOrdinal ?? 0) - (b.support?.jambOrdinal ?? 0);
  if (ordinal !== 0) return ordinal;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function verticalToleranceFor(lower, profile) {
  if (lower.support?.role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) {
    return profile.support.foundationTolerance;
  }
  return profile.support.verticalTolerance;
}

function evaluateSupport(stone, lowerCourse, profile, survivors) {
  const [s0, s1] = stone.support.span;
  const candidates = findOverlapCandidates(lowerCourse, s0, s1, profile.support.maximumCantilever);
  const supports = [];
  for (const lower of candidates) {
    if (!survivors.has(lower._ruinId)) continue;
    const tolerance = verticalToleranceFor(lower, profile);
    const gap = stone.support.bottom - lower.support.top;
    if (gap < -tolerance || gap > tolerance) continue;
    supports.push(lower.support.span);
  }
  return coverageWithinSpan(s0, s1, supports);
}

function isDirectlySupported(coverage, profile, role) {
  if (role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) return true;
  if (role === CONSTRUCTION_SUPPORT_ROLE.ARCH || role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE) {
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

function openingPrefixFromGroupId(groupId) {
  if (typeof groupId !== 'string') return null;
  const match = groupId.match(/^(opening:[^:]+):/);
  return match ? match[1] : null;
}

function isLaterallyIsolated(stone, courseList, survivors) {
  return !courseList.some((candidate) => (
    candidate._ruinId !== stone._ruinId
    && survivors.has(candidate._ruinId)
    && (
      Math.abs(candidate.support.span[0] - stone.support.span[1]) < 0.08
      || Math.abs(candidate.support.span[1] - stone.support.span[0]) < 0.08
    )
  ));
}

/**
 * Height of an isolated tooth ending at `topStone`, walking downward.
 * Returns both the course count and the stack so tall pinnacles can be cleared
 * in one pass (the previous hardcoded `1` never tripped the YAML max).
 */
function isolatedToothFromTop(topStone, byCourseNow, survivors) {
  const stack = [topStone];
  let stone = topStone;
  let course = stone.support.courseIndex;
  while (true) {
    const below = byCourseNow.get(course - 1) ?? [];
    const stacked = below.filter((candidate) => (
      survivors.has(candidate._ruinId)
      && candidate.support?.role === CONSTRUCTION_SUPPORT_ROLE.FIELD
      && coverageWithinSpan(
        stone.support.span[0],
        stone.support.span[1],
        [candidate.support.span],
      ).ratio >= 0.55
    ));
    if (stacked.length !== 1) break;
    const next = stacked[0];
    if (!isLaterallyIsolated(next, below, survivors)) break;
    stack.push(next);
    stone = next;
    course -= 1;
  }
  return { toothCourses: stack.length, stack };
}

/**
 * Resolve clustered damage then structural support across all wall modules.
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

  // Lattice masonry only — dressings use jambOrdinal / opening groups.
  const byCourse = new Map();
  for (const placement of survivors.values()) {
    const role = placement.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
    if (!isLatticeRole(role)) continue;
    const course = placement.support?.courseIndex ?? placement.courseIndex ?? 0;
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
    const lowerPool = [
      ...(byCourse.get(course - 1) ?? []),
      ...(byCourse.get(course - 2) ?? []),
    ].sort(compareSupportOrder);

    for (const stone of stones) {
      const role = stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
      stats.supportChecks += 1;
      if (role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) continue;

      const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
      stats.supportEdges += coverage.merged.length;

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

  // Jamb stacks: bottom-up within each jamb group, using jambOrdinal.
  const jambGroups = new Map();
  for (const stone of survivors.values()) {
    if (stone.support?.role !== CONSTRUCTION_SUPPORT_ROLE.JAMB) continue;
    const groupId = stone.support.groupId;
    if (!groupId) continue;
    if (!jambGroups.has(groupId)) jambGroups.set(groupId, []);
    jambGroups.get(groupId).push(stone);
  }
  for (const units of jambGroups.values()) {
    units.sort(compareJambOrder);
    for (let index = 0; index < units.length; index += 1) {
      const stone = units[index];
      if (!survivors.has(stone._ruinId)) continue;
      stats.supportChecks += 1;
      if (index === 0) {
        // Bottom jamb: needs foundation / field under its footprint.
        const course = Math.max(0, Math.floor(stone.support.bottom / 0.5));
        const lowerPool = [
          ...(byCourse.get(0) ?? []),
          ...(byCourse.get(1) ?? []),
          ...(byCourse.get(course) ?? []),
          ...(byCourse.get(course - 1) ?? []),
        ].sort(compareSupportOrder);
        if (profile.openings.protectLowerJambs) continue;
        const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
        const ok = coverage.ratio >= profile.openings.jambMinimumSupport
          || isDirectlySupported(coverage, profile, CONSTRUCTION_SUPPORT_ROLE.JAMB);
        if (!ok) {
          queue.push({ id: stone._ruinId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
        }
        continue;
      }
      const below = units[index - 1];
      if (!survivors.has(below._ruinId)) {
        queue.push({ id: stone._ruinId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
        continue;
      }
      const gap = stone.support.bottom - below.support.top;
      const tolerance = profile.support.verticalTolerance;
      if (gap < -tolerance || gap > tolerance) {
        queue.push({ id: stone._ruinId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
        continue;
      }
      if (!reverseDeps.has(below._ruinId)) reverseDeps.set(below._ruinId, []);
      reverseDeps.get(below._ruinId).push(stone._ruinId);
    }
  }

  // Arch rings: compression from spring abutments, not mere jamb-group presence.
  const archGroups = new Map();
  const jambsByOpening = new Map();
  for (const stone of survivors.values()) {
    const groupId = stone.support?.groupId;
    if (!groupId) continue;
    const prefix = openingPrefixFromGroupId(groupId);
    if (!prefix) continue;
    if (stone.support.role === CONSTRUCTION_SUPPORT_ROLE.JAMB) {
      if (!jambsByOpening.has(prefix)) jambsByOpening.set(prefix, { left: [], right: [] });
      const bucket = jambsByOpening.get(prefix);
      if ((stone.support.side ?? 0) < 0) bucket.left.push(stone);
      else bucket.right.push(stone);
      continue;
    }
    if (
      stone.support.role === CONSTRUCTION_SUPPORT_ROLE.ARCH
      || stone.support.role === CONSTRUCTION_SUPPORT_ROLE.KEYSTONE
    ) {
      if (!archGroups.has(groupId)) archGroups.set(groupId, []);
      archGroups.get(groupId).push(stone);
    }
  }

  const fieldPool = [...survivors.values()].filter((stone) => (
    isLatticeRole(stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD)
  ));

  for (const [, arches] of archGroups) {
    const prefix = openingPrefixFromGroupId(arches[0]?.support?.groupId);
    const jambs = prefix ? jambsByOpening.get(prefix) : null;
    const resolved = resolveArchCompression({
      arches,
      leftJambs: jambs?.left ?? [],
      rightJambs: jambs?.right ?? [],
      fieldPool,
      survivors,
      profile,
    });
    for (const [id, reason] of resolved.remove) {
      if (survivors.has(id)) {
        queue.push({ id, reason });
      }
    }
    if (resolved.kept > 0) {
      stats.archesKept += 1;
    }

    // Upper jambs collapse when their spring abutment is gone.
    if (jambs) {
      const sideOk = [
        [jambs.left, resolved.leftSpringSupported],
        [jambs.right, resolved.rightSpringSupported],
      ];
      for (const [side, springOk] of sideOk) {
        const ordered = [...side].sort(compareJambOrder);
        for (let index = 1; index < ordered.length; index += 1) {
          const stone = ordered[index];
          if (!survivors.has(stone._ruinId)) continue;
          if (!springOk || !survivors.has(ordered[index - 1]._ruinId)) {
            queue.push({ id: stone._ruinId, reason: RUIN_REMOVAL_REASON.ARCH_UNSUPPORTED });
          }
        }
      }
    }
  }

  const supportMeta = new Map();
  for (const course of courseKeys) {
    const stones = byCourse.get(course) ?? [];
    const lowerPool = [
      ...(byCourse.get(course - 1) ?? []),
      ...(byCourse.get(course - 2) ?? []),
    ].sort(compareSupportOrder);
    for (const stone of stones) {
      if (!survivors.has(stone._ruinId)) continue;
      const role = stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
      if (role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) {
        supportMeta.set(stone._ruinId, {
          ratio: 1,
          crossModule: false,
          footing: true,
        });
        continue;
      }
      const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
      let crossModule = false;
      for (const lower of findOverlapCandidates(
        lowerPool,
        stone.support.span[0],
        stone.support.span[1],
        profile.support.maximumCantilever,
      )) {
        if (!survivors.has(lower._ruinId)) continue;
        if (lower.moduleId != null && stone.moduleId != null && lower.moduleId !== stone.moduleId) {
          crossModule = true;
          break;
        }
      }
      supportMeta.set(stone._ruinId, {
        ratio: coverage.ratio,
        crossModule,
        footing: false,
      });
    }
  }

  queue.sort((a, b) => {
    const left = survivors.get(a.id);
    const right = survivors.get(b.id);
    if (!left || !right) return a.id - b.id;
    return compareSupportOrder(left, right);
  });

  let steps = 0;
  const seen = new Set();
  while (queue.length > 0 && steps < profile.support.maximumPropagationSteps * Math.max(1, survivors.size)) {
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
      const role = dependant.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD;
      if (role === CONSTRUCTION_SUPPORT_ROLE.JAMB) {
        queue.push({ id: dependantId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
        continue;
      }
      if (!isLatticeRole(role)) continue;
      const course = dependant.support?.courseIndex ?? 0;
      const lowerPool = [
        ...(byCourse.get(course - 1) ?? []),
        ...(byCourse.get(course - 2) ?? []),
      ].filter((candidate) => survivors.has(candidate._ruinId));
      const coverage = evaluateSupport(dependant, lowerPool, profile, survivors);
      if (!isDirectlySupported(coverage, profile, role)) {
        queue.push({ id: dependantId, reason: RUIN_REMOVAL_REASON.UNSUPPORTED });
      }
    }
  }

  // Crown pinnacle cleanup on lattice field only.
  if (profile.crown.removeUnsupportedPinnacles) {
    const remaining = [...survivors.values()]
      .filter((stone) => isLatticeRole(stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD))
      .sort(compareSupportOrder);
    const byCourseNow = new Map();
    for (const stone of remaining) {
      const course = stone.support?.courseIndex ?? 0;
      if (!byCourseNow.has(course)) byCourseNow.set(course, []);
      byCourseNow.get(course).push(stone);
    }
    for (const list of byCourseNow.values()) list.sort(compareSupportOrder);

    for (const stone of remaining) {
      if (!survivors.has(stone._ruinId)) continue;
      if ((stone.support?.role ?? CONSTRUCTION_SUPPORT_ROLE.FIELD) !== CONSTRUCTION_SUPPORT_ROLE.FIELD) {
        continue;
      }
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
      if (!isLaterallyIsolated(stone, same, survivors)) continue;

      const width = stone.support.span[1] - stone.support.span[0];
      const lowerPool = [
        ...(byCourseNow.get(course - 1) ?? []),
        ...(byCourseNow.get(course - 2) ?? []),
      ].filter((candidate) => survivors.has(candidate._ruinId));
      const coverage = evaluateSupport(stone, lowerPool, profile, survivors);
      const { toothCourses, stack } = isolatedToothFromTop(stone, byCourseNow, survivors);
      if (
        width < profile.crown.minimumToothWidth
        || coverage.ratio < profile.crown.isolatedToothStrongSupport
        || toothCourses > profile.crown.maximumSupportedToothCourses
      ) {
        for (const unit of stack) {
          if (!survivors.has(unit._ruinId)) continue;
          survivors.delete(unit._ruinId);
          markRemoved(removed, unit, RUIN_REMOVAL_REASON.PINNACLE, stats);
        }
      }
    }
  }

  stats.supportResolveMs = performance.now() - supportStarted;
  stats.finalSurvivors = survivors.size;
  stats.finalRemoved = removed.length;

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
  const debugSurvivors = [];
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
    const meta = supportMeta.get(stone._ruinId) ?? { ratio: 1, crossModule: false, footing: false };
    let debugState = RUIN_DEBUG_STATE.SUPPORTED;
    if (meta.footing || stone.support?.role === CONSTRUCTION_SUPPORT_ROLE.FOUNDATION) {
      debugState = RUIN_DEBUG_STATE.FOOTING;
    } else if (meta.crossModule) {
      debugState = RUIN_DEBUG_STATE.CROSS_MODULE;
    } else if (meta.ratio < profile.support.strongOverlapRatio) {
      debugState = RUIN_DEBUG_STATE.WEAK;
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
        debugState,
        supportRatio: meta.ratio,
      }),
    });
    debugSurvivors.push(Object.freeze({
      stableIndex: finalStone.stableIndex,
      moduleId: ownedModuleId,
      s: finalStone.s,
      y: finalStone.y,
      width: finalStone.width ?? finalStone.packedWidth,
      height: finalStone.height,
      depth: finalStone.depth ?? stone.depth ?? 0.45,
      debugState,
      supportRatio: meta.ratio,
    }));
    if (!finalByModule.has(moduleId)) finalByModule.set(moduleId, []);
    finalByModule.get(moduleId).push(finalStone);
  }

  const compactRemovals = removed.map((entry) => Object.freeze({
    reason: entry.reason,
    clusterId: entry.clusterId,
    placement: Object.freeze({
      stableIndex: entry.placement.stableIndex,
      moduleId: entry.placement.moduleId,
      category: entry.placement.category,
      s: entry.placement.s,
      y: entry.placement.y,
      width: entry.placement.width ?? entry.placement.packedWidth,
      height: entry.placement.height,
      depth: entry.placement.depth ?? 0.45,
      support: entry.placement.support ?? null,
    }),
  }));

  const resolvedModules = modules.map((module) => Object.freeze({
    ...module,
    placements: Object.freeze(finalByModule.get(module.id) ?? []),
  }));

  return {
    modules: Object.freeze(resolvedModules),
    removed: Object.freeze(removed),
    diagnostics: Object.freeze({
      survivors: Object.freeze(debugSurvivors),
      removals: Object.freeze(compactRemovals),
    }),
    supportGraph: Object.freeze({ reverseDepsSize: reverseDeps.size }),
    stats: Object.freeze(stats),
  };
}
