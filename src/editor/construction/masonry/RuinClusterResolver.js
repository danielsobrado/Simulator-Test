/**
 * Course-by-course cleanup of preliminary ruin damage into coherent clusters.
 */

import { RUIN_REMOVAL_REASON } from './ConstructionSupportRoles.js';

function spanStart(placement) {
  return placement.support?.span?.[0] ?? (placement.s - placement.packedWidth / 2);
}

function spanEnd(placement) {
  return placement.support?.span?.[1] ?? (placement.s + placement.packedWidth / 2);
}

function compareBySpan(a, b) {
  const start = spanStart(a) - spanStart(b);
  if (start !== 0) return start;
  const end = spanEnd(a) - spanEnd(b);
  if (end !== 0) return end;
  return (a.stableIndex ?? 0) - (b.stableIndex ?? 0);
}

function touches(a, b, epsilon = 0.04) {
  return spanEnd(a) + epsilon >= spanStart(b) && spanEnd(b) + epsilon >= spanStart(a);
}

function runWidth(ordered, start, end) {
  return spanEnd(ordered[end]) - spanStart(ordered[start]);
}

function stableClusterId(courseIndex, placement) {
  return `course:${courseIndex}:stone:${placement.stableIndex ?? placement._ruinId ?? 0}`;
}

/** Resolve clustered damage on field stones. Dressings pass through unchanged. */
export function resolveRuinClusters({ placements, profile }) {
  const stats = {
    preliminaryDamage: 0,
    isolatedHolesRestored: 0,
    clustersExpanded: 0,
    damageClusters: 0,
    maximumClusterWidth: 0,
  };

  const field = [];
  const rest = [];
  for (const placement of placements) {
    if (placement.category === 'field') field.push(placement);
    else rest.push(placement);
  }

  const byCourse = new Map();
  for (const placement of field) {
    const key = placement.support?.courseIndex ?? placement.courseIndex ?? 0;
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(placement);
  }

  const survivors = [...rest];
  const removed = [];
  const clusterIds = new Map();

  const orderedCourses = [...byCourse.entries()].sort(([left], [right]) => left - right);
  for (const [courseIndex, coursePlacements] of orderedCourses) {
    const ordered = [...coursePlacements].sort(compareBySpan);
    const removeFlags = ordered.map((placement) => Boolean(placement.ruin?.candidate));
    for (const flag of removeFlags) {
      if (flag) stats.preliminaryDamage += 1;
    }

    let index = 0;
    while (index < ordered.length) {
      if (!removeFlags[index]) {
        index += 1;
        continue;
      }

      let end = index;
      while (
        end + 1 < ordered.length
        && removeFlags[end + 1]
        && touches(ordered[end], ordered[end + 1])
      ) {
        end += 1;
      }

      const initialWidth = runWidth(ordered, index, end);
      const run = ordered.slice(index, end + 1);
      const maxScore = Math.max(...run.map((placement) => placement.ruin?.score ?? 0));
      const leftNeighbour = index > 0 ? ordered[index - 1] : null;
      const rightNeighbour = end + 1 < ordered.length ? ordered[end + 1] : null;
      const isolated = run.length === 1
        && leftNeighbour
        && rightNeighbour
        && !removeFlags[index - 1]
        && !removeFlags[end + 1];

      if (
        isolated
        && initialWidth < profile.damage.cluster.minimumWidth
        && maxScore < profile.damage.cluster.isolatedHoleThreshold
      ) {
        stats.isolatedHolesRestored += 1;
        removeFlags[index] = false;
        index += 1;
        continue;
      }

      let expandedStart = index;
      let expandedEnd = end;
      const severe = maxScore >= profile.damage.cluster.severeThreshold;
      const belowPreferredWidth = initialWidth < profile.damage.cluster.preferredWidth;
      if (severe && belowPreferredWidth) {
        const threshold = profile.damage.probability.removeThreshold * 0.92;
        const tryExpand = (neighbourIndex, boundaryIndex) => {
          if (neighbourIndex < 0 || neighbourIndex >= ordered.length) return false;
          if (removeFlags[neighbourIndex]) return false;
          if (!touches(ordered[neighbourIndex], ordered[boundaryIndex])) return false;
          const score = ordered[neighbourIndex].ruin?.score ?? 0;
          if (score < threshold) return false;
          removeFlags[neighbourIndex] = true;
          stats.clustersExpanded += 1;
          return true;
        };

        if (tryExpand(index - 1, index)) expandedStart = index - 1;
        if (tryExpand(end + 1, end)) expandedEnd = end + 1;
      }

      const clusterId = stableClusterId(courseIndex, ordered[expandedStart]);
      stats.damageClusters += 1;
      stats.maximumClusterWidth = Math.max(
        stats.maximumClusterWidth,
        runWidth(ordered, expandedStart, expandedEnd),
      );
      for (let runIndex = expandedStart; runIndex <= expandedEnd; runIndex += 1) {
        const key = ordered[runIndex]._ruinId ?? ordered[runIndex].stableIndex;
        clusterIds.set(key, clusterId);
      }

      // A right-side expansion belongs to this cluster. Skip it so it cannot be
      // reprocessed as a new cluster and recursively expand only to the right.
      index = expandedEnd + 1;
    }

    for (let stoneIndex = 0; stoneIndex < ordered.length; stoneIndex += 1) {
      const placement = ordered[stoneIndex];
      const key = placement._ruinId ?? placement.stableIndex;
      const clusterId = clusterIds.get(key) ?? null;
      if (removeFlags[stoneIndex]) {
        removed.push(Object.freeze({
          placement,
          reason: RUIN_REMOVAL_REASON.CLUSTER_DAMAGE,
          clusterId,
        }));
      } else {
        survivors.push(Object.freeze({
          ...placement,
          ruin: Object.freeze({
            ...(placement.ruin ?? {}),
            candidate: Boolean(placement.ruin?.candidate),
            clusterId,
            damageVoid: false,
          }),
        }));
      }
    }
  }

  return {
    survivors: Object.freeze(survivors),
    removed: Object.freeze(removed),
    stats: Object.freeze(stats),
  };
}
