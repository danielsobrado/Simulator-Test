import * as THREE from 'three/webgpu';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';

/**
 * The semantic wall shell: a terrain-following extruded ribbon.
 *
 * The shell is the far LOD band *and* the pre-masonry placeholder, and the LOD
 * band is chosen per module — so the ribbon has to be sliceable per module too.
 * One ribbon spanning the whole record cannot express "this module is far and
 * that one is near": showing it for the far module draws it straight through
 * the near module's masonry, which reads as holes and z-fighting in the courses
 * rather than as a distant wall.
 *
 * Vertices are **origin-local**, never render-space. Baking
 * `floatingOrigin.toRender` into a vertex costs float32 precision at world
 * scale — at 3 km out a 2 mm mortar inset is not representable — and forces a
 * full rebuild on every rebase. Parenting to a group whose position carries the
 * render offset fixes both.
 */

const FOUNDATION_OVERLAP = 0.08;

/** Slice boundaries closer than this to a sample reuse that sample exactly. */
const SEAM_EPSILON = 1e-6;

export function sampleShellPath(record) {
  return sampleCubicBezierPath(record.path, {
    chordError: 0.08,
    maxSpacing: 0.65,
  });
}

function lerpShellPoint(a, b, t) {
  const normalX = a.normalX + (b.normalX - a.normalX) * t;
  const normalZ = a.normalZ + (b.normalZ - a.normalZ) * t;
  const length = Math.hypot(normalX, normalZ) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    normalX: normalX / length,
    normalZ: normalZ / length,
    distance: a.distance + (b.distance - a.distance) * t,
  };
}

function shellPointAt(points, distance) {
  if (distance <= points[0].distance) return points[0];
  const last = points[points.length - 1];
  if (distance >= last.distance) return last;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (after.distance < distance) continue;
    const span = after.distance - before.distance;
    if (!(span > 0)) return after;
    return lerpShellPoint(before, after, (distance - before.distance) / span);
  }
  return last;
}

/**
 * Sampled points covering `[fromFraction, toFraction]` of the path.
 *
 * Boundaries are **fractions of the sampled total**, not absolute arc lengths:
 * the planner samples the same curve with its own tolerances, so its arc
 * coordinates are close to but not identical with the view's. Slicing on the
 * shared fraction makes neighbouring sections meet on the same interpolated
 * point, which is what keeps a seam from opening between two module shells.
 */
export function shellSectionPoints(sampled, fromFraction = 0, toFraction = 1) {
  const points = sampled.points;
  if (!points || points.length < 2) return [];
  const total = sampled.totalDistance;
  const from = Math.max(0, Math.min(1, fromFraction)) * total;
  const to = Math.max(0, Math.min(1, toFraction)) * total;
  if (!(to - from > SEAM_EPSILON)) return [];

  const section = [shellPointAt(points, from)];
  for (const point of points) {
    if (point.distance > from + SEAM_EPSILON && point.distance < to - SEAM_EPSILON) {
      section.push(point);
    }
  }
  section.push(shellPointAt(points, to));
  return section;
}

/**
 * Extrude one run of sampled points into the closed ribbon, origin-local.
 *
 * @param points from `shellSectionPoints`; the caller decides how much of the
 *   path a given shell covers.
 */
export function buildShellGeometry(points, { record, terrainView, origin }) {
  if (!points || points.length < 2) return null;
  const positions = [];
  const indices = [];
  const halfWidth = record.dimensions.thickness / 2;
  for (const entry of points) {
    const leftX = entry.x + entry.normalX * halfWidth - origin.x;
    const leftZ = entry.z + entry.normalZ * halfWidth - origin.z;
    const rightX = entry.x - entry.normalX * halfWidth - origin.x;
    const rightZ = entry.z - entry.normalZ * halfWidth - origin.z;
    const centerHeight = terrainView.getCanonicalHeight(entry.x, entry.z) ?? 0;
    const bottom = centerHeight - FOUNDATION_OVERLAP;
    const top = centerHeight + record.dimensions.height;
    positions.push(
      leftX, bottom, leftZ,
      rightX, bottom, rightZ,
      leftX, top, leftZ,
      rightX, top, rightZ,
    );
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = index * 4;
    const next = current + 4;
    indices.push(
      current, current + 2, next + 2,
      current, next + 2, next,
      current + 1, next + 1, next + 3,
      current + 1, next + 3, current + 3,
      current + 2, current + 3, next + 3,
      current + 2, next + 3, next + 2,
      current, next, next + 1,
      current, next + 1, current + 1,
    );
  }
  const last = (points.length - 1) * 4;
  indices.push(
    0, 1, 3,
    0, 3, 2,
    last, last + 2, last + 3,
    last, last + 3, last + 1,
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.constructionId = record.id;
  geometry.userData.constructionRevision = record.revision;
  return geometry;
}

/** The whole-record ribbon, for the states that have no per-module plan yet. */
export function buildWallGeometry(record, terrainView, origin) {
  return buildShellGeometry(sampleShellPath(record).points, { record, terrainView, origin });
}
