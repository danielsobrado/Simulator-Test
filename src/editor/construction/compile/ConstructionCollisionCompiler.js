const COLLISION_PLAN_VERSION = 1;
const FOUNDATION_OVERLAP = 0.08;
const EPSILON = 1e-6;
const HASH_QUANTUM = 1e4;
const MAX_STRAIGHT_BOX_LENGTH = 48;
const OPENING_KINDS = new Set(['door', 'window', 'arch', 'gate', 'breach']);

function createHasher() {
  let hash = 0x811c9dc5;
  const write = (value) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 1;
    hash = Math.imul(hash, 0x01000193);
  };
  return {
    text: write,
    number: (value) => write(Math.round(value * HASH_QUANTUM)),
    digest: () => (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

function interpolate(left, right, targetDistance) {
  const span = right.distance - left.distance;
  const t = span > EPSILON ? (targetDistance - left.distance) / span : 0;
  const tangentX = left.tangentX + (right.tangentX - left.tangentX) * t;
  const tangentZ = left.tangentZ + (right.tangentZ - left.tangentZ) * t;
  const magnitude = Math.hypot(tangentX, tangentZ) || 1;
  return Object.freeze({
    x: left.x + (right.x - left.x) * t,
    z: left.z + (right.z - left.z) * t,
    tangentX: tangentX / magnitude,
    tangentZ: tangentZ / magnitude,
    distance: targetDistance,
  });
}

function pointAtDistance(points, distance) {
  if (distance <= points[0].distance) return points[0];
  if (distance >= points.at(-1).distance) return points.at(-1);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance <= distance) low = middle;
    else high = middle;
  }
  return interpolate(points[low], points[high], distance);
}

function segmentRanges(sampled, path) {
  const ends = new Map();
  for (const point of sampled.points) {
    ends.set(point.segmentId, Math.max(ends.get(point.segmentId) ?? 0, point.distance));
  }
  const ranges = new Map();
  let start = 0;
  for (let index = 0; index < path.segments.length; index += 1) {
    const segment = path.segments[index];
    const end = index === path.segments.length - 1
      ? sampled.totalDistance
      : ends.get(segment.id);
    ranges.set(segment.id, Object.freeze({ start, end }));
    start = end;
  }
  return ranges;
}

function featureArcs(record, ranges) {
  return record.features
    .filter((feature) => OPENING_KINDS.has(feature.kind))
    .map((feature) => {
      const range = ranges.get(feature.segmentId);
      const center = range.start + (range.end - range.start) * feature.arcFraction;
      return Object.freeze({
        id: feature.id,
        segmentId: feature.segmentId,
        start: Math.max(range.start, center - feature.width / 2),
        end: Math.min(range.end, center + feature.width / 2),
        bottom: feature.sill,
        top: feature.sill + feature.height,
      });
    });
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Math.round(value / EPSILON) * EPSILON))]
    .sort((left, right) => left - right);
}

function segmentIsStraight(points, range) {
  const relevant = points.filter(
    (point) => point.distance >= range.start - EPSILON && point.distance <= range.end + EPSILON,
  );
  if (relevant.length < 2) return true;
  const first = pointAtDistance(points, range.start);
  const last = pointAtDistance(points, range.end);
  const dx = last.x - first.x;
  const dz = last.z - first.z;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) return true;
  for (const point of relevant) {
    const distance = Math.abs((point.x - first.x) * dz - (point.z - first.z) * dx) / length;
    if (distance > 0.01) return false;
  }
  return true;
}

function boundariesForSegment(sampled, range, openings, curveSegmentLength) {
  const boundaries = [range.start, range.end];
  const straight = segmentIsStraight(sampled.points, range);
  const length = range.end - range.start;
  const maximumLength = straight ? MAX_STRAIGHT_BOX_LENGTH : curveSegmentLength;
  if (length > maximumLength) {
    const count = Math.max(1, Math.ceil(length / maximumLength));
    for (let index = 1; index < count; index += 1) {
      boundaries.push(range.start + length * index / count);
    }
  }
  for (const opening of openings) boundaries.push(opening.start, opening.end);
  return uniqueSorted(boundaries);
}

function mergeVoidBands(openings, wallHeight) {
  const sorted = openings
    .map((opening) => ({
      bottom: Math.max(0, Math.min(wallHeight, opening.bottom)),
      top: Math.max(0, Math.min(wallHeight, opening.top)),
    }))
    .filter(({ bottom, top }) => top - bottom > EPSILON)
    .sort((left, right) => left.bottom - right.bottom);
  const merged = [];
  for (const band of sorted) {
    const previous = merged.at(-1);
    if (previous && band.bottom <= previous.top + EPSILON) {
      previous.top = Math.max(previous.top, band.top);
    } else {
      merged.push({ ...band });
    }
  }
  return merged;
}

function solidBands(openings, wallHeight) {
  const voids = mergeVoidBands(openings, wallHeight);
  const solids = [];
  let cursor = 0;
  for (const band of voids) {
    if (band.bottom - cursor > EPSILON) solids.push([cursor, band.bottom]);
    cursor = Math.max(cursor, band.top);
  }
  if (wallHeight - cursor > EPSILON) solids.push([cursor, wallHeight]);
  return solids;
}

function bandSignature(bands) {
  return bands.map(([bottom, top]) => `${bottom.toFixed(4)}:${top.toFixed(4)}`).join('|');
}

function boxBounds(centerX, centerZ, tangentX, tangentZ, length, thickness) {
  const halfLength = length / 2;
  const halfDepth = thickness / 2;
  const outwardX = -tangentZ;
  const outwardZ = tangentX;
  const extentX = Math.abs(tangentX) * halfLength + Math.abs(outwardX) * halfDepth;
  const extentZ = Math.abs(tangentZ) * halfLength + Math.abs(outwardZ) * halfDepth;
  return Object.freeze({
    minX: centerX - extentX,
    minZ: centerZ - extentZ,
    maxX: centerX + extentX,
    maxZ: centerZ + extentZ,
  });
}

function unionBounds(target, bounds) {
  target.minX = Math.min(target.minX, bounds.minX);
  target.minZ = Math.min(target.minZ, bounds.minZ);
  target.maxX = Math.max(target.maxX, bounds.maxX);
  target.maxZ = Math.max(target.maxZ, bounds.maxZ);
}

function planSignature(record, boxes, curveSegmentLength) {
  const hasher = createHasher();
  hasher.text(record.id);
  hasher.number(record.revision);
  hasher.number(curveSegmentLength);
  for (const box of boxes) {
    hasher.text(box.id);
    hasher.number(box.center[0]);
    hasher.number(box.center[1]);
    hasher.number(box.tangent[0]);
    hasher.number(box.tangent[1]);
    hasher.number(box.length);
    hasher.number(box.thickness);
    hasher.number(box.bottom);
    hasher.number(box.top);
  }
  return hasher.digest();
}

export function compileConstructionCollision(record, sampled, {
  curveSegmentLength = 1.25,
} = {}) {
  if (!record || record.path?.type !== 'cubicBezier') {
    throw new Error('Construction collision compilation requires a cubic Bézier record.');
  }
  if (!sampled?.points?.length || !(sampled.totalDistance > 0)) {
    throw new Error('Construction collision compilation requires a sampled path.');
  }
  if (!(curveSegmentLength > 0)) {
    throw new Error('Construction collision curve segment length must be positive.');
  }

  const ranges = segmentRanges(sampled, record.path);
  const openings = featureArcs(record, ranges);
  const intervals = [];

  for (const segment of record.path.segments) {
    const range = ranges.get(segment.id);
    const segmentOpenings = openings.filter(({ segmentId }) => segmentId === segment.id);
    const boundaries = boundariesForSegment(sampled, range, segmentOpenings, curveSegmentLength);
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const from = boundaries[index];
      const to = boundaries[index + 1];
      if (to - from <= EPSILON) continue;
      const midpoint = (from + to) / 2;
      const activeOpenings = segmentOpenings.filter(
        (opening) => midpoint > opening.start - EPSILON && midpoint < opening.end + EPSILON,
      );
      const bands = solidBands(activeOpenings, record.dimensions.height);
      intervals.push({
        segmentId: segment.id,
        from,
        to,
        midpoint,
        bands,
        signature: bandSignature(bands),
        openingIds: activeOpenings.map(({ id }) => id).sort(),
      });
    }
  }

  const overlap = Math.max(0.05, Math.min(curveSegmentLength * 0.2, record.dimensions.thickness * 0.25));
  const boxes = [];
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };

  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index];
    const previous = intervals[index - 1]
      ?? (record.path.closed ? intervals.at(-1) : null);
    const next = intervals[index + 1]
      ?? (record.path.closed ? intervals[0] : null);
    const overlapLeft = previous && previous.signature === interval.signature ? overlap : 0;
    const overlapRight = next && next.signature === interval.signature ? overlap : 0;
    const point = pointAtDistance(sampled.points, interval.midpoint);
    const shift = (overlapRight - overlapLeft) / 2;
    const centerX = point.x + point.tangentX * shift;
    const centerZ = point.z + point.tangentZ * shift;
    const length = interval.to - interval.from + overlapLeft + overlapRight;

    for (let bandIndex = 0; bandIndex < interval.bands.length; bandIndex += 1) {
      const [bottom, top] = interval.bands[bandIndex];
      const id = [
        interval.segmentId,
        Math.round(interval.from * 1000),
        Math.round(interval.to * 1000),
        `band-${bandIndex + 1}`,
      ].join(':');
      const box = Object.freeze({
        id,
        segmentId: interval.segmentId,
        center: Object.freeze([centerX, centerZ]),
        tangent: Object.freeze([point.tangentX, point.tangentZ]),
        length,
        thickness: record.dimensions.thickness,
        bottom,
        top,
        foundationOverlap: bottom <= EPSILON ? FOUNDATION_OVERLAP : 0,
        openingIds: Object.freeze(interval.openingIds),
        bounds: boxBounds(
          centerX,
          centerZ,
          point.tangentX,
          point.tangentZ,
          length,
          record.dimensions.thickness,
        ),
      });
      boxes.push(box);
      unionBounds(bounds, box.bounds);
    }
  }

  if (boxes.length === 0) {
    bounds.minX = sampled.points[0].x;
    bounds.maxX = sampled.points[0].x;
    bounds.minZ = sampled.points[0].z;
    bounds.maxZ = sampled.points[0].z;
  }

  return Object.freeze({
    version: COLLISION_PLAN_VERSION,
    constructionId: record.id,
    constructionRevision: record.revision,
    signature: planSignature(record, boxes, curveSegmentLength),
    bounds: Object.freeze(bounds),
    boxes: Object.freeze(boxes),
    stats: Object.freeze({
      boxCount: boxes.length,
      openingCount: openings.length,
      intervalCount: intervals.length,
    }),
  });
}
