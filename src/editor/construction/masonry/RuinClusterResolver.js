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

function isField(placement) {
  const role = placement.support?.role;
  if (role) return role === 'field' || role === 'foundation';
  return placement.category === 'field';
}

/**
 * Resolve clustered damage on field stones. Dressings pass through unchanged.
 */
export function resolveRuinClusters({
  placements,
  profile,
}) {
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
    if (isField(placement) && (placement.support?.role ?? 'field') !== 'foundation'
      && placement.category === 'field') {
      field.push(placement);
    } else if (placement.category === 'field' || placement.support?.role === 'foundation') {
      field.push(placement);
    } else {
      rest.push(placement);
    }
  }

  // Simpler: field category goes to field processing; rest pass through.
  field.length = 0;
  rest.length = 0;
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
  let nextClusterId = 1;

  for (const coursePlacements of byCourse.values()) {
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

      const run = ordered.slice(index, end + 1);
      const width = spanEnd(run[run.length - 1]) - spanStart(run[0]);
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
        && width < profile.damage.cluster.minimumWidth
        && maxScore < profile.damage.cluster.isolatedHoleThreshold
      ) {
        stats.isolatedHolesRestored += 1;
        removeFlags[index] = false;
      } else {
        stats.damageClusters += 1;
        stats.maximumClusterWidth = Math.max(stats.maximumClusterWidth, width);
        const clusterId = nextClusterId;
        nextClusterId += 1;

        if (maxScore >= profile.damage.cluster.severeThreshold) {
          const threshold = profile.damage.probability.removeThreshold;
          const tryExpand = (neighbourIndex) => {
            if (neighbourIndex < 0 || neighbourIndex >= ordered.length) return;
            if (removeFlags[neighbourIndex]) return;
            const score = ordered[neighbourIndex].ruin?.score ?? 0;
            if (score >= threshold * 0.92) {
              removeFlags[neighbourIndex] = true;
              stats.clustersExpanded += 1;
              clusterIds.set(ordered[neighbourIndex]._ruinId ?? ordered[neighbourIndex].stableIndex, clusterId);
            }
          };
          tryExpand(index - 1);
          tryExpand(end + 1);
        }

        for (let runIndex = index; runIndex <= end; runIndex += 1) {
          const key = ordered[runIndex]._ruinId ?? ordered[runIndex].stableIndex;
          clusterIds.set(key, clusterId);
        }
      }
      index = end + 1;
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
