import { projectedPixelHeight, selectProjectedLod } from '../../stylized/lod/projectedLod.js';
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

/**
 * Put the leaves of one split cell back into the single stone they were cut from.
 *
 * Exact rather than approximate: `splitCell` cuts axis-aligned in the cell's own
 * frame, so the cell's own corner is simply whichever leaf corner sits furthest
 * into that corner. Reconstructing it keeps the coarse band's stone count at or
 * below what it was before the lattice, instead of inheriting the split.
 */
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

  // Inherit shading, depth and straddle from the biggest leaf, so the merged
  // stone keeps the identity the eye was most likely tracking.
  const dominant = group.reduce(
    (best, leaf) => (leaf.width * leaf.height > best.width * best.height ? leaf : best),
    group[0],
  );
  return {
    ...dominant,
    s,
    y,
    corners: corners.map(([cornerS, cornerY]) => [cornerS - s, cornerY - y]),
    width: maxS - minS,
    height: maxY - minY,
    packedWidth: maxS - minS,
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
  return {
    ...placement,
    y: placement.y + step / 2,
    height,
    ...(placement.corners
      ? { corners: scaleCorners(placement.corners, 1, height / placement.height) }
      : {}),
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
 */
export function coarsePlacements(placements) {
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

  const meanY = (course) => (
    course.reduce((total, placement) => total + placement.y, 0) / course.length
  );
  const ordered = [...courses.values()].sort((a, b) => meanY(a) - meanY(b));

  const merged = [];
  for (let index = 0; index < ordered.length; index += 2) {
    const course = ordered[index];
    const above = ordered[index + 1];
    const step = above ? Math.max(0, meanY(above) - meanY(course)) : 0;
    for (const placement of course) merged.push(stretchOverGap(placement, step));
  }
  return [...rest, ...merged];
}
