/**
 * Arc-length reparameterisation of a sampled cubic Bézier path.
 *
 * Masonry is packed in arc length so `packCourse` can stay the scalar-span
 * interval solver it already is; this table is what maps a packed stone centre
 * back onto the curve. It also owns the frame convention every downstream
 * placement depends on.
 *
 * Frame convention: `yaw` orients a unit box so its local +X runs along the path
 * and its local +Z is the outward normal. Three.js `Ry(yaw)` maps local +X to
 * `(cos yaw, -sin yaw)` in world XZ — which is exactly how `buildWallCourses`
 * places planar stones — so matching that to the tangent gives
 * `yaw = atan2(-tangentZ, tangentX)`. Local +Z then lands on
 * `(-tangentZ, tangentX)`, which is the sampler's own `(normalX, normalZ)`.
 * That means `stoneJitter`'s default `protrusionAxis: 'z'` already pushes a
 * stone proud of the wall face with no change.
 */

const DEFAULT_STEP = 0.05;
const EPSILON = 1e-9;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function normalizeTangent(x, z) {
  const magnitude = Math.hypot(x, z);
  if (magnitude <= EPSILON) return { tangentX: 1, tangentZ: 0 };
  return { tangentX: x / magnitude, tangentZ: z / magnitude };
}

function frameFromParts(x, z, tangentX, tangentZ) {
  return {
    x,
    z,
    tangentX,
    tangentZ,
    normalX: -tangentZ,
    normalZ: tangentX,
    yaw: Math.atan2(-tangentZ, tangentX),
  };
}

/**
 * @param sampled Result of `sampleCubicBezierPath`.
 */
export function createCurveArcTable(sampled, { step = DEFAULT_STEP } = {}) {
  const points = sampled?.points;
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('An arc table requires at least two sampled path points.');
  }
  if (!(step > 0)) throw new Error('Arc table step must be positive.');

  const totalLength = sampled.totalDistance;

  // Segment ranges must be contiguous, not derived from sample membership: the
  // sampler drops each segment's duplicated first point, so the surviving
  // samples of segment n+1 start strictly after segment n ends. Ranges built
  // from membership would leave an unowned sliver at every joint, and an arc
  // coordinate landing in one could not round-trip.
  const order = [];
  const ends = new Map();
  for (const entry of points) {
    if (!ends.has(entry.segmentId)) order.push(entry.segmentId);
    ends.set(entry.segmentId, Math.max(ends.get(entry.segmentId) ?? 0, entry.distance));
  }
  const segmentRanges = new Map();
  let previousEnd = 0;
  for (let index = 0; index < order.length; index += 1) {
    const segmentId = order[index];
    const end = index === order.length - 1 ? totalLength : ends.get(segmentId);
    segmentRanges.set(segmentId, { start: previousEnd, end });
    previousEnd = end;
  }

  // Uniform lookup grid over arc length so `frameAt` is O(1) rather than a
  // binary search per stone; a 200 m wall at 5 cm is 4000 slots.
  const slots = Math.max(1, Math.ceil(totalLength / step));
  const index = new Int32Array(slots + 1);
  let cursor = 0;
  for (let slot = 0; slot <= slots; slot += 1) {
    const target = Math.min(totalLength, slot * step);
    while (cursor + 1 < points.length - 1 && points[cursor + 1].distance <= target) {
      cursor += 1;
    }
    index[slot] = cursor;
  }

  function neighbours(s) {
    const clamped = Math.max(0, Math.min(totalLength, s));
    let low = index[Math.min(slots, Math.floor(clamped / step))];
    while (low + 1 < points.length - 1 && points[low + 1].distance <= clamped) low += 1;
    while (low > 0 && points[low].distance > clamped) low -= 1;
    return { low, high: Math.min(points.length - 1, low + 1), clamped };
  }

  function frameAt(s) {
    const { low, high, clamped } = neighbours(s);
    const a = points[low];
    const b = points[high];
    const span = b.distance - a.distance;
    const t = span > EPSILON ? (clamped - a.distance) / span : 0;
    const { tangentX, tangentZ } = normalizeTangent(
      lerp(a.tangentX, b.tangentX, t),
      lerp(a.tangentZ, b.tangentZ, t),
    );
    return frameFromParts(lerp(a.x, b.x, t), lerp(a.z, b.z, t), tangentX, tangentZ);
  }

  /**
   * Signed turn rate of the tangent, in radians per metre. Finite-differenced
   * from the samples rather than taken from the second derivative, which is
   * noisy on an adaptively subdivided curve.
   */
  function curvatureAt(s, delta = 0.2) {
    const half = Math.max(step, delta / 2);
    const before = frameAt(Math.max(0, s - half));
    const after = frameAt(Math.min(totalLength, s + half));
    const measured = Math.min(totalLength, s + half) - Math.max(0, s - half);
    if (measured <= EPSILON) return 0;
    const cross = before.tangentX * after.tangentZ - before.tangentZ * after.tangentX;
    const dot = before.tangentX * after.tangentX + before.tangentZ * after.tangentZ;
    return Math.atan2(cross, dot) / measured;
  }

  function maxCurvatureOver(s0, s1, samples = 8) {
    let maximum = 0;
    for (let i = 0; i <= samples; i += 1) {
      maximum = Math.max(maximum, Math.abs(curvatureAt(lerp(s0, s1, i / samples))));
    }
    return maximum;
  }

  function segmentRange(segmentId) {
    const range = segmentRanges.get(segmentId);
    if (!range) throw new Error(`Unknown path segment ${segmentId}.`);
    return [range.start, range.end];
  }

  function toArc(segmentId, arcFraction) {
    const [start, end] = segmentRange(segmentId);
    const clamped = Math.max(0, Math.min(1, arcFraction));
    return start + (end - start) * clamped;
  }

  function fromArc(s) {
    const clamped = Math.max(0, Math.min(totalLength, s));
    for (const [segmentId, range] of segmentRanges) {
      if (clamped > range.end && segmentId !== order[order.length - 1]) continue;
      const span = range.end - range.start;
      return {
        segmentId,
        arcFraction: span > EPSILON
          ? Math.max(0, Math.min(1, (clamped - range.start) / span))
          : 0,
      };
    }
    return { segmentId: order[order.length - 1], arcFraction: 1 };
  }

  return Object.freeze({
    totalLength,
    step,
    segmentIds: Object.freeze([...segmentRanges.keys()]),
    frameAt,
    curvatureAt,
    maxCurvatureOver,
    segmentRange,
    toArc,
    fromArc,
  });
}
