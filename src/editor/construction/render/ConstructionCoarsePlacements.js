import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';
import { scaleCorners } from '../masonry/CourseLattice.js';
import { coverageWithinSpan } from '../masonry/RuinSupportIntervals.js';

const CORNER_DIRECTIONS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

function cornerBounds(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function mergeCornerRing(group, key, s, y) {
  if (!group.every((leaf) => Array.isArray(leaf[key]))) return null;
  const world = CORNER_DIRECTIONS.map(([alongS, alongY], slot) => {
    let best = null;
    for (const leaf of group) {
      const point = [leaf.s + leaf[key][slot][0], leaf.y + leaf[key][slot][1]];
      if (!best
        || point[0] * alongS > best[0] * alongS + 1e-12
        || (Math.abs(point[0] - best[0]) <= 1e-12
          && point[1] * alongY > best[1] * alongY)) {
        best = point;
      }
    }
    return best;
  });
  return world.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]);
}

export function selectDominantPlacement(leaves) {
  return leaves.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestArea = best.width * best.height;
    const candidateArea = candidate.width * candidate.height;
    if (candidateArea !== bestArea) return candidateArea > bestArea ? candidate : best;
    return candidate.stableIndex < best.stableIndex ? candidate : best;
  }, null);
}

function mergeCellLeaves(group) {
  const corners = CORNER_DIRECTIONS.map(([alongS, alongY], slot) => {
    let best = null;
    for (const leaf of group) {
      const point = [leaf.s + leaf.corners[slot][0], leaf.y + leaf.corners[slot][1]];
      if (!best
        || point[0] * alongS > best[0] * alongS + 1e-12
        || (Math.abs(point[0] - best[0]) <= 1e-12
          && point[1] * alongY > best[1] * alongY)) {
        best = point;
      }
    }
    return best;
  });

  let minS = Infinity;
  let maxS = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [s, y] of corners) {
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const s = (minS + maxS) / 2;
  const y = (minY + maxY) / 2;
  const dominant = selectDominantPlacement(group);
  const mergedMortarCorners = mergeCornerRing(group, 'mortarCorners', s, y);
  const jointWidths = dominant.jointWidths ? { ...dominant.jointWidths } : null;
  const packedWidth = mergedMortarCorners
    ? cornerBounds(mergedMortarCorners).width
    : maxS - minS;

  return {
    ...dominant,
    s,
    y,
    corners: corners.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]),
    ...(mergedMortarCorners ? { mortarCorners: mergedMortarCorners } : {}),
    ...(jointWidths ? { jointWidths } : {}),
    ...(dominant.jointWidthsNear
      ? { jointWidthsNear: { ...dominant.jointWidthsNear } }
      : jointWidths
        ? { jointWidthsNear: { ...jointWidths } }
        : {}),
    width: maxS - minS,
    height: maxY - minY,
    packedWidth,
    bandHeight: 1,
  };
}

function canMergeSplitCell(group) {
  if (group.some((placement) => placement.ruin?.damageVoid)) return false;
  const clusterIds = new Set(
    group.map((placement) => placement.ruin?.clusterId).filter((value) => value != null),
  );
  return clusterIds.size <= 1;
}

function mergeSplitCells(field) {
  const cells = new Map();
  const merged = [];
  for (const placement of field) {
    if (placement.cellIndex == null || !placement.corners) {
      merged.push(placement);
      continue;
    }
    const group = cells.get(placement.cellIndex);
    if (group) group.push(placement);
    else cells.set(placement.cellIndex, [placement]);
  }
  for (const group of cells.values()) {
    if (group.length === 1 || !canMergeSplitCell(group)) merged.push(...group);
    else merged.push(mergeCellLeaves(group));
  }
  return merged;
}

function stretchOverGap(placement, step) {
  if (!(step > 0)) return placement;
  const height = placement.height + step;
  const scaleY = height / placement.height;
  return {
    ...placement,
    y: placement.y + step / 2,
    height,
    ...(placement.corners ? { corners: scaleCorners(placement.corners, 1, scaleY) } : {}),
    ...(placement.mortarCorners
      ? { mortarCorners: scaleCorners(placement.mortarCorners, 1, scaleY) }
      : {}),
  };
}

export function amplifyCoarseJoints(placement, profile) {
  if (!placement.corners || !placement.jointWidths || !placement.mortarCorners) {
    return placement;
  }
  if (!(profile.coarseLodMultiplier > 1) || placement.coarseJointsAmplified) {
    return placement;
  }

  const nearWidths = placement.jointWidthsNear ?? placement.jointWidths;
  const mortarBounds = cornerBounds(placement.mortarCorners);
  if (!(mortarBounds.width > 0) || !(mortarBounds.height > 0)) return placement;

  const finalHead = Math.min(
    nearWidths.head * profile.coarseLodMultiplier,
    Math.max(0, mortarBounds.width - profile.minimumRenderedWidth),
  );
  const finalBed = Math.min(
    nearWidths.bed * profile.coarseLodMultiplier,
    Math.max(0, mortarBounds.height - profile.minimumRenderedHeight),
  );
  const scaleX = Math.max(0.01, 1 - finalHead / mortarBounds.width);
  const scaleY = Math.max(0.01, 1 - finalBed / mortarBounds.height);

  return {
    ...placement,
    corners: scaleCorners(placement.mortarCorners, scaleX, scaleY),
    width: mortarBounds.width * scaleX,
    height: mortarBounds.height * scaleY,
    packedWidth: mortarBounds.width,
    jointWidthsNear: { head: nearWidths.head, bed: nearWidths.bed },
    jointWidths: { head: finalHead, bed: finalBed },
    coarseJointsAmplified: true,
  };
}

function placementSpan(placement) {
  if (Array.isArray(placement.support?.span)) return placement.support.span;
  const width = placement.packedWidth ?? placement.width ?? 0;
  return [placement.s - width / 2, placement.s + width / 2];
}

function courseCoversPlacement(placement, above) {
  if (!above || above.length === 0 || placement.ruin?.damageVoid) return false;
  const [s0, s1] = placementSpan(placement);
  const width = Math.max(0, s1 - s0);
  if (!(width > 0)) return false;
  const coverage = coverageWithinSpan(s0, s1, above.map(placementSpan));
  return coverage.ratio >= 0.75 && coverage.largestGap <= width * 0.25;
}

function courseMeanY(course) {
  return course.reduce((total, placement) => total + placement.y, 0) / course.length;
}

function courseIndexSpan(course) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const placement of course) {
    const index = placement.courseIndex ?? placement.support?.courseIndex;
    if (index == null) continue;
    minimum = Math.min(minimum, index);
    maximum = Math.max(maximum, index);
  }
  return { minimum, maximum };
}

export function coarsePlacements(placements, { styleKey = null } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) return placements ?? [];
  const field = [];
  const rest = [];
  for (const placement of placements) {
    if (placement.category === 'field') field.push(placement);
    else rest.push(placement);
  }
  if (field.length === 0) return placements;

  const courses = new Map();
  for (const placement of mergeSplitCells(field)) {
    const key = placement.courseIndex != null
      ? `course:${placement.courseIndex}`
      : `y:${Math.round(placement.y * 50) / 50}`;
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(placement);
  }

  const jointProfile = constructionJointProfile(styleKey);
  const ordered = [...courses.values()].sort((a, b) => courseMeanY(a) - courseMeanY(b));
  const merged = [];

  for (let index = 0; index < ordered.length; index += 2) {
    const course = ordered[index];
    const above = ordered[index + 1];
    let step = 0;
    let ruinGap = false;
    if (above) {
      const belowSpan = courseIndexSpan(course);
      const aboveSpan = courseIndexSpan(above);
      ruinGap = Number.isFinite(belowSpan.maximum)
        && Number.isFinite(aboveSpan.minimum)
        && aboveSpan.minimum - belowSpan.maximum > 1;
      if (!ruinGap) step = Math.max(0, courseMeanY(above) - courseMeanY(course));
    }

    for (const placement of course) {
      const mayStretch = !ruinGap && courseCoversPlacement(placement, above);
      const stretched = stretchOverGap(placement, mayStretch ? step : 0);
      merged.push(amplifyCoarseJoints(stretched, jointProfile));
    }
  }

  return [...rest, ...merged];
}
