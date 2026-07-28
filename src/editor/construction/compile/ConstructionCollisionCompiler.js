import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';

const COLLISION_PLAN_VERSION = 1;
const FOUNDATION_OVERLAP = 0.08;
const EPSILON = 1e-6;
const HASH_QUANTUM = 1e4;
const MAX_STRAIGHT_BOX_LENGTH = 48;
const TOP_SAMPLE_SPACING = 0.2;
const MAX_TOP_SAMPLES = 256;
const OPENING_KINDS = new Set(['door', 'window', 'arch', 'gate', 'breach']);
const VARIABLE_TOP_STYLES = new Set(['irregular', 'ruined']);

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

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Math.round(value / EPSILON) * EPSILON))]
    .sort((left, right) => left - right);
}

function segmentIsStraight(sampled, range) {
  const [start, end] = range;
  const relevant = sampled.points.filter(
    (point) => point.distance >= start - EPSILON && point.distance <= end + EPSILON,
  );
  if (relevant.length < 2) return true;
  const first = relevant[0];
  const last = relevant.at(-1);
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

function featureArcs(record, arcTable) {
  return record.features
    .filter((feature) => OPENING_KINDS.has(feature.kind))
    .map((feature) => {
      const [segmentStart, segmentEnd] = arcTable.segmentRange(feature.segmentId);
      const center = arcTable.toArc(feature.segmentId, feature.arcFraction);
      return Object.freeze({
        id: feature.id,
        segmentId: feature.segmentId,
        start: Math.max(segmentStart, center - feature.width / 2),
        end: Math.min(segmentEnd, center + feature.width / 2),
        bottom: feature.sill,
        top: feature.sill + feature.height,
      });
    });
}

function topControlArcs(record, arcTable) {
  return record.top.profile.map(
    (entry) => arcTable.toArc(entry.segmentId, entry.arcFraction),
  );
}

function boundariesForSegment({
  sampled,
  range,
  openings,
  topControls,
  curveSegmentLength,
  variableTop,
}) {
  const [start, end] = range;
  const boundaries = [start, end];
  const straight = segmentIsStraight(sampled, range);
  const length = end - start;
  const maximumLength = !straight || variableTop
    ? curveSegmentLength
    : MAX_STRAIGHT_BOX_LENGTH;
  if (length > maximumLength) {
    const count = Math.max(1, Math.ceil(length / maximumLength));
    for (let index = 1; index < count; index += 1) {
      boundaries.push(start + length * index / count);
    }
  }
  for (const opening of openings) boundaries.push(opening.start, opening.end);
  for (const control of topControls) {
    if (control > start + EPSILON && control < end - EPSILON) boundaries.push(control);
  }
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

function maximumTopHeight(topProfile, from, to) {
  const length = Math.max(0, to - from);
  const samples = Math.max(
    2,
    Math.min(MAX_TOP_SAMPLES, Math.ceil(length / TOP_SAMPLE_SPACING)),
  );
  let maximum = 0;
  for (let index = 0; index <= samples; index += 1) {
    maximum = Math.max(maximum, topProfile.heightAt(from + length * index / samples));
  }
  return maximum;
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

  const arcTable = createCurveArcTable(sampled);
  const topProfile = createWallTopProfile(record, arcTable);
  const openings = featureArcs(record, arcTable);
  const topControls = topControlArcs(record, arcTable);
  const variableTop = topControls.length > 0 || VARIABLE_TOP_STYLES.has(record.top.style);
  const intervals = [];

  for (const segment of record.path.segments) {
    const range = arcTable.segmentRange(segment.id);
    const segmentOpenings = openings.filter(({ segmentId }) => segmentId === segment.id);
    const segmentTopControls = topControls.filter(
      (distance) => distance >= range[0] - EPSILON && distance <= range[1] + EPSILON,
    );
    const boundaries = boundariesForSegment({
      sampled,
      range,
      openings: segmentOpenings,
      topControls: segmentTopControls,
      curveSegmentLength,
      variableTop,
    });
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const from = boundaries[index];
      const to = boundaries[index + 1];
      if (to - from <= EPSILON) continue;
      const midpoint = (from + to) / 2;
      const activeOpenings = segmentOpenings.filter(
        (opening) => midpoint > opening.start - EPSILON && midpoint < opening.end + EPSILON,
      );
      const wallHeight = maximumTopHeight(topProfile, from, to);
      const bands = solidBands(activeOpenings, wallHeight);
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

  const overlap = Math.max(
    0.05,
    Math.min(curveSegmentLength * 0.2, record.dimensions.thickness * 0.25),
  );
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
    const frame = arcTable.frameAt(interval.midpoint);
    const shift = (overlapRight - overlapLeft) / 2;
    const centerX = frame.x + frame.tangentX * shift;
    const centerZ = frame.z + frame.tangentZ * shift;
    const length = interval.to - interval.from + overlapLeft + overlapRight;

    for (let bandIndex = 0; bandIndex < interval.bands.length; bandIndex += 1) {
      const [bottom, top] = interval.bands[bandIndex];
      const id = [
        interval.segmentId,
        Math.round(interval.from * 1000),
        Math.round(interval.to * 1000),
        `band-${bandIndex + 1}`,
      ].join(':');
      const boundsForBox = boxBounds(
        centerX,
        centerZ,
        frame.tangentX,
        frame.tangentZ,
        length,
        record.dimensions.thickness,
      );
      const box = Object.freeze({
        id,
        segmentId: interval.segmentId,
        center: Object.freeze([centerX, centerZ]),
        tangent: Object.freeze([frame.tangentX, frame.tangentZ]),
        length,
        thickness: record.dimensions.thickness,
        bottom,
        top,
        foundationOverlap: bottom <= EPSILON ? FOUNDATION_OVERLAP : 0,
        openingIds: Object.freeze(interval.openingIds),
        bounds: boundsForBox,
      });
      boxes.push(box);
      unionBounds(bounds, boundsForBox);
    }
  }

  if (boxes.length === 0) {
    const frame = arcTable.frameAt(0);
    bounds.minX = frame.x;
    bounds.maxX = frame.x;
    bounds.minZ = frame.z;
    bounds.maxZ = frame.z;
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
