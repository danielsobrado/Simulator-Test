import { projectedPixelHeight, selectProjectedLod } from '../../stylized/lod/projectedLod.js';
import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';
import { scaleCorners } from '../masonry/CourseLattice.js';

/**
 * LOD band selection for construction modules.
 *
 * Adapts the shared projected-pixel selector rather than adding a second
 * implementation: a differently-tuned LOD in the same renderer is how popping
 * becomes inconsistent between walls and the buildings beside them.
 *
 * Three bands. `near` is full masonry; `coarse` is the same placements built at
 * reduced detail with the dressings kept — an arch ring is the readable feature
 * of a wall at middle distance, so dropping it removes the thing that makes the
 * wall legible; `shell` is the extruded ribbon, which already exists as the
 * pre-masonry placeholder and therefore costs nothing new.
 */

export const CONSTRUCTION_LOD_BANDS = Object.freeze(['near', 'coarse', 'shell']);

export const DEFAULT_CONSTRUCTION_LOD = Object.freeze({
  nearPixels: 140,
  coarsePixels: 35,
  hysteresisRatio: 0.15,
});

/** The shared selector's band vocabulary, mapped onto ours. */
const TO_SHARED = Object.freeze({ near: 'near', coarse: 'proxy', shell: 'impostor' });
const FROM_SHARED = Object.freeze({
  near: 'near', proxy: 'coarse', impostor: 'shell', cluster: 'shell', culled: 'shell',
});

export function selectConstructionLod({
  pixels,
  previous = null,
  thresholds = DEFAULT_CONSTRUCTION_LOD,
  pinned = false,
}) {
  // An edited or selected module must never change band mid-gesture; that reads
  // as the geometry glitching rather than as a distance transition.
  if (pinned) return 'near';
  const band = selectProjectedLod({
    pixels,
    previous: previous ? TO_SHARED[previous] : null,
    hysteresisRatio: thresholds.hysteresisRatio,
    nearPixels: thresholds.nearPixels,
    proxyPixels: thresholds.coarsePixels,
    impostorPixels: 0,
    clusterPixels: 0,
  });
  return FROM_SHARED[band] ?? 'shell';
}

/**
 * Projected height of a module, from its bounds.
 *
 * `module.bounds` are **canonical** world coordinates but `camera.position` is
 * render space, so the caller must supply `toRender` — comparing the two
 * directly makes every module read as its distance from the floating origin
 * rather than from the camera, which lands the whole wall in one band.
 */
export function moduleProjectedPixels({
  camera,
  module,
  height,
  viewportHeight,
  toRender = null,
  cameraY = 0,
}) {
  const bounds = module.bounds;
  const canonicalX = (bounds.minX + bounds.maxX) / 2;
  const canonicalZ = (bounds.minZ + bounds.maxZ) / 2;
  const rendered = toRender ? toRender(canonicalX, canonicalZ) : { x: canonicalX, z: canonicalZ };
  return projectedPixelHeight({
    camera,
    worldPosition: { x: rendered.x, y: cameraY, z: rendered.z },
    worldHeight: height,
    viewportHeight,
  });
}

/** The corner slots `resolveCellCorners` emits, and which way each one faces. */
const CORNER_DIRECTIONS = [
  [-1, -1], // bottom-left
  [1, -1], // bottom-right
  [1, 1], // top-right
  [-1, 1], // top-left
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
        || (Math.abs(point[0] - best[0]) <= 1e-12 && point[1] * alongY > best[1] * alongY)) {
        best = point;
      }
    }
    return best;
  });
  return world.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]);
}

/**
 * Put the leaves of one split cell back into the single stone they were cut from.
 *
 * Exact rather than approximate: `splitCell` cuts axis-aligned in the cell's own
 * frame, so the cell's own corner is simply whichever leaf corner sits furthest
 * into that corner. Reconstructing it keeps the coarse band's stone count at or
 * below what it was before the lattice, instead of inheriting the split.
 *
 * Appearance identity: largest leaf wins; equal-area ties pick the lowest
 * stableIndex so leaf order cannot repaint the merged stone.
 */
export function selectDominantPlacement(leaves) {
  return leaves.reduce((best, candidate) => {
    if (!best) return candidate;
    const bestArea = best.width * best.height;
    const candidateArea = candidate.width * candidate.height;
    if (candidateArea !== bestArea) {
      return candidateArea > bestArea ? candidate : best;
    }
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
        || (Math.abs(point[0] - best[0]) <= 1e-12 && point[1] * alongY > best[1] * alongY)) {
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

  const mergedStoneCorners = corners.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]);
  const mergedMortarCorners = mergeCornerRing(group, 'mortarCorners', s, y);

  // Joint widths on the merged cell: keep the dominant leaf's near widths so
  // coarse amplification has a stable base (internal split joints disappear).
  const jointWidths = dominant.jointWidths
    ? { ...dominant.jointWidths }
    : undefined;

  let width = maxS - minS;
  let height = maxY - minY;
  let packedWidth = width;
  if (mergedMortarCorners) {
    const mortar = cornerBounds(mergedMortarCorners);
    // Solved cell span — not the shrunken visible hull — so coarse amplification
    // and footprint checks still see the authoritative course tile.
    packedWidth = mortar.width;
  }

  return {
    ...dominant,
    s,
    y,
    corners: mergedStoneCorners,
    ...(mergedMortarCorners ? { mortarCorners: mergedMortarCorners } : {}),
    ...(jointWidths ? { jointWidths } : {}),
    // Near joint widths stay authoritative across merge/stretch/amplify.
    ...(dominant.jointWidthsNear
      ? { jointWidthsNear: { ...dominant.jointWidthsNear } }
      : jointWidths
        ? { jointWidthsNear: { ...jointWidths } }
        : {}),
    width,
    height,
    packedWidth,
    bandHeight: 1,
  };
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
    merged.push(group.length === 1 ? group[0] : mergeCellLeaves(group));
  }
  return merged;
}

/** Stretch a kept stone upward to cover the course that was dropped above it. */
function stretchOverGap(placement, step) {
  if (!(step > 0)) return placement;
  const height = placement.height + step;
  const scaleY = height / placement.height;
  return {
    ...placement,
    y: placement.y + step / 2,
    height,
    ...(placement.corners
      ? { corners: scaleCorners(placement.corners, 1, scaleY) }
      : {}),
    ...(placement.mortarCorners
      ? { mortarCorners: scaleCorners(placement.mortarCorners, 1, scaleY) }
      : {}),
  };
}

/**
 * Widen coarse joints from the authoritative mortar footprint.
 *
 * Always derived from near joint widths + multiplier once — never mutates the
 * near source, so near → coarse → near returns identical near geometry.
 * Idempotent: re-amplifying an already-amplified placement is a no-op.
 */
export function amplifyCoarseJoints(placement, profile) {
  if (!placement.corners || !placement.jointWidths || !placement.mortarCorners) {
    return placement;
  }

  const multiplier = profile.coarseLodMultiplier;
  if (!(multiplier > 1)) {
    return placement;
  }

  // Prefer the near-band widths frozen on first amplify so a second pass cannot
  // compound the multiplier (coarsePlacements(coarsePlacements(near))).
  const nearWidths = placement.jointWidthsNear ?? placement.jointWidths;
  if (placement.coarseJointsAmplified) {
    return placement;
  }

  const mortarBounds = cornerBounds(placement.mortarCorners);
  if (!(mortarBounds.width > 0) || !(mortarBounds.height > 0)) {
    return placement;
  }

  const extraHead = nearWidths.head * (multiplier - 1);
  const extraBed = nearWidths.bed * (multiplier - 1);

  const maximumHead = Math.max(0, mortarBounds.width - profile.minimumRenderedWidth);
  const maximumBed = Math.max(0, mortarBounds.height - profile.minimumRenderedHeight);

  const finalHead = Math.min(nearWidths.head + extraHead, maximumHead);
  const finalBed = Math.min(nearWidths.bed + extraBed, maximumBed);

  const scaleX = Math.max(0.01, 1 - finalHead / mortarBounds.width);
  const scaleY = Math.max(0.01, 1 - finalBed / mortarBounds.height);

  return {
    ...placement,
    corners: scaleCorners(placement.mortarCorners, scaleX, scaleY),
    width: mortarBounds.width * scaleX,
    height: mortarBounds.height * scaleY,
    packedWidth: mortarBounds.width,
    jointWidthsNear: {
      head: nearWidths.head,
      bed: nearWidths.bed,
    },
    jointWidths: {
      head: finalHead,
      bed: finalBed,
    },
    coarseJointsAmplified: true,
  };
}

/**
 * Thin field masonry for the coarse band: put split cells back together, then
 * keep every other course and stretch the survivors to cover the gap. Dressings
 * (voussoirs, jambs, coping, …) are left alone — an arch ring is the readable
 * feature at middle distance.
 *
 * Courses are keyed on `courseIndex` where the lattice supplies one. Bucketing on
 * `y` stopped being sound once bed joints ramp: two stones in the same course sit
 * at different heights, and near a wall top they can be a whole bucket apart.
 *
 * @param placements near-authoritative placements (never mutated)
 * @param options.styleKey masonry style for joint amplification
 */
export function coarsePlacements(placements, { styleKey = null } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) return placements ?? [];
  const field = [];
  const rest = [];
  for (const placement of placements) {
    if (placement.category === 'field') field.push(placement);
    else rest.push(placement);
  }
  if (field.length === 0) return placements;

  const jointProfile = constructionJointProfile(styleKey);
  // Preserve intentional ruin notches: never stretch across a gap larger than the
  // normal every-other-course thin (one omitted lattice course).
  const courses = new Map();
  for (const placement of mergeSplitCells(field)) {
    const key = placement.courseIndex != null
      ? `course:${placement.courseIndex}`
      : `y:${Math.round(placement.y * 50) / 50}`;
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(placement);
  }

  const meanY = (course) => (
    course.reduce((total, placement) => total + placement.y, 0) / course.length
  );
  const courseIndexSpan = (course) => {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const placement of course) {
      const index = placement.courseIndex ?? placement.support?.courseIndex;
      if (index == null) continue;
      minimum = Math.min(minimum, index);
      maximum = Math.max(maximum, index);
    }
    return { minimum, maximum };
  };
  const ordered = [...courses.values()].sort((a, b) => meanY(a) - meanY(b));

  const merged = [];
  for (let index = 0; index < ordered.length; index += 2) {
    const course = ordered[index];
    const above = ordered[index + 1];
    let step = 0;
    if (above) {
      const belowSpan = courseIndexSpan(course);
      const aboveSpan = courseIndexSpan(above);
      // Normal coarse thin keeps N and N+2. Anything wider implies a missing
      // ruin course between survivors — do not grow stones through that notch.
      let ruinGap = false;
      if (
        Number.isFinite(belowSpan.maximum)
        && Number.isFinite(aboveSpan.minimum)
        && aboveSpan.minimum - belowSpan.maximum > 2
      ) {
        // Normal coarse thin keeps N and N+2. A wider jump means at least one
        // additional lattice course was removed by ruin support — do not fill it.
        ruinGap = true;
      }
      if (!ruinGap) {
        step = Math.max(0, meanY(above) - meanY(course));
      }
    }
    for (const placement of course) {
      const stretched = stretchOverGap(placement, step);
      merged.push(amplifyCoarseJoints(stretched, jointProfile));
    }
  }
  return [...rest, ...merged];
}
