import { closestPointOnCubicBezierPath } from './CubicBezierPath.js';

/**
 * Anchor snapping while dragging.
 *
 * **Snapping is on by default and Left Ctrl suppresses it.** The two source
 * descriptions of the reference game conflict — "hold Control for precise node
 * snapping" versus "hold Left Ctrl to place close without connecting" — but in
 * the game snapping is the default and Ctrl is the escape hatch; "precise" is
 * describing that default. One rule satisfies both readings.
 */

const GRID_SIZE = 0.5;
const ANGLE_STEP = Math.PI / 12;   // 15 degrees
const EPSILON = 1e-9;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function anchorPoint(anchor) {
  return { x: anchor.position[0], z: anchor.position[1] };
}

/**
 * Project onto the line through the two neighbouring anchors.
 *
 * This is the "pull a node to stretch the wall into a perfectly straight line"
 * behaviour. It returns the projection *and* the perpendicular component to
 * zero out of the adjacent handles — projecting the anchor alone leaves the
 * curve bowing between neighbours, so the run looks almost straight and the
 * user cannot tell why.
 */
function straightSnap(candidate, path, anchorIndex) {
  const count = path.anchors.length;
  const previousIndex = path.closed ? (anchorIndex - 1 + count) % count : anchorIndex - 1;
  const nextIndex = path.closed ? (anchorIndex + 1) % count : anchorIndex + 1;
  if (previousIndex < 0 || nextIndex >= count) return null;

  const a = anchorPoint(path.anchors[previousIndex]);
  const b = anchorPoint(path.anchors[nextIndex]);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON) return null;
  const t = ((candidate.x - a.x) * dx + (candidate.z - a.z) * dz) / lengthSquared;
  // Only inside the span; past an endpoint "straight" is not what is meant.
  if (t <= 0.02 || t >= 0.98) return null;
  return { x: a.x + dx * t, z: a.z + dz * t };
}

function gridSnap(candidate) {
  return {
    x: Math.round(candidate.x / GRID_SIZE) * GRID_SIZE,
    z: Math.round(candidate.z / GRID_SIZE) * GRID_SIZE,
  };
}

function angleSnap(candidate, origin) {
  const dx = candidate.x - origin.x;
  const dz = candidate.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) return null;
  const bearing = Math.round(Math.atan2(dz, dx) / ANGLE_STEP) * ANGLE_STEP;
  return { x: origin.x + Math.cos(bearing) * length, z: origin.z + Math.sin(bearing) * length };
}

/**
 * @param options.others `[{ constructionId, path }]` — every other construction.
 * @param options.enabled `false` while Left Ctrl is held.
 * @returns `{ position, kind, targetId, flattenHandles }` or `null`.
 */
export function resolveAnchorSnap({
  candidate,
  path,
  anchorId,
  others = [],
  worldRadius = 0.75,
  enabled = true,
}) {
  if (!enabled) return null;
  const point = { x: Number(candidate.x ?? candidate[0]), z: Number(candidate.z ?? candidate[1]) };
  const anchorIndex = path.anchors.findIndex(({ id }) => id === anchorId);
  if (anchorIndex < 0) return null;
  const isEndpoint = !path.closed
    && (anchorIndex === 0 || anchorIndex === path.anchors.length - 1);

  // 1. Endpoint to endpoint — explicit joins and loop closure outrank everything.
  let best = null;
  const considerAnchor = (target, constructionId, targetAnchorId, closesLoop) => {
    const found = distance(point, target);
    if (found > worldRadius) return;
    if (best && found >= best.distance) return;
    best = {
      distance: found,
      position: [target.x, target.z],
      kind: 'anchor',
      targetId: targetAnchorId,
      constructionId,
      closesLoop,
    };
  };

  if (isEndpoint) {
    const otherEnd = anchorIndex === 0 ? path.anchors.at(-1) : path.anchors[0];
    if (otherEnd && otherEnd.id !== anchorId && path.anchors.length >= 3) {
      considerAnchor(anchorPoint(otherEnd), null, otherEnd.id, true);
    }
  }
  for (const other of others) {
    for (const anchor of other.path.anchors) {
      considerAnchor(anchorPoint(anchor), other.constructionId, anchor.id, false);
    }
  }
  if (best) {
    return Object.freeze({
      position: best.position,
      kind: best.kind,
      targetId: best.targetId,
      constructionId: best.constructionId,
      closesLoop: best.closesLoop,
      flattenHandles: false,
    });
  }

  // 2. Endpoint onto another centreline — a T-junction.
  for (const other of others) {
    const closest = closestPointOnCubicBezierPath(other.path, point);
    if (!closest || closest.distance > worldRadius) continue;
    return Object.freeze({
      position: [closest.x, closest.z],
      kind: 'curve',
      targetId: closest.segmentId,
      constructionId: other.constructionId,
      closesLoop: false,
      flattenHandles: false,
    });
  }

  // 3. Straighten against the two neighbouring anchors.
  const straight = straightSnap(point, path, anchorIndex);
  if (straight && distance(point, straight) <= worldRadius) {
    return Object.freeze({
      position: [straight.x, straight.z],
      kind: 'straight',
      targetId: null,
      constructionId: null,
      closesLoop: false,
      // The anchors being collinear is not enough; the adjacent handles keep
      // their perpendicular component and the span still bows.
      flattenHandles: true,
    });
  }

  // 4. World grid.
  const grid = gridSnap(point);
  if (distance(point, grid) <= Math.min(worldRadius, GRID_SIZE * 0.4)) {
    return Object.freeze({
      position: [grid.x, grid.z],
      kind: 'grid',
      targetId: null,
      constructionId: null,
      closesLoop: false,
      flattenHandles: false,
    });
  }

  // 5. Bearing from the previous anchor, for regular corners.
  const previous = path.anchors[anchorIndex - 1] ?? path.anchors[anchorIndex + 1];
  if (previous) {
    const angled = angleSnap(point, anchorPoint(previous));
    if (angled && distance(point, angled) <= worldRadius * 0.6) {
      return Object.freeze({
        position: [angled.x, angled.z],
        kind: 'angle',
        targetId: null,
        constructionId: null,
        closesLoop: false,
        flattenHandles: false,
      });
    }
  }
  return null;
}

/**
 * Zero the perpendicular component of the handles either side of an anchor, so
 * a `straight` snap produces a dead-straight span rather than a near-straight
 * one.
 */
export function flattenHandlesAround(path, anchorId) {
  const anchorIndex = path.anchors.findIndex(({ id }) => id === anchorId);
  if (anchorIndex < 0) return path;
  const count = path.anchors.length;
  const previousIndex = path.closed ? (anchorIndex - 1 + count) % count : anchorIndex - 1;
  const nextIndex = path.closed ? (anchorIndex + 1) % count : anchorIndex + 1;
  if (previousIndex < 0 || nextIndex >= count) return path;

  const a = anchorPoint(path.anchors[previousIndex]);
  const b = anchorPoint(path.anchors[nextIndex]);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) return path;
  const ux = dx / length;
  const uz = dz / length;
  const project = ([hx, hz]) => {
    const along = hx * ux + hz * uz;
    return [along * ux, along * uz];
  };

  const touching = new Set([previousIndex, anchorIndex].filter((index) => index >= 0));
  const segments = path.segments.map((segment, index) => (
    touching.has(index)
      ? {
        ...segment,
        startHandle: project(segment.startHandle),
        endHandle: project(segment.endHandle),
      }
      : segment
  ));
  return { ...path, segments };
}
