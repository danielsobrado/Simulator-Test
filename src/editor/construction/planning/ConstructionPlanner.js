import { normalizeConstructionRecord } from '../ConstructionSchema.js';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';
import { createCurveArcTable } from '../masonry/CurveArcTable.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import {
  MAX_CONSTRUCTION_STONES,
  MAX_MODULE_STONES,
  packCurvedWall,
} from '../masonry/CurvedCoursePacker.js';

const DEFAULT_MAX_MODULE_LENGTH = 12;
const HASH_QUANTUM = 1e4;

/**
 * FNV-1a over the canonical inputs of one module, so the view can skip
 * rebuilding a module that a dirty-segment edit did not actually change.
 * Floats are quantised to 0.1 mm first — otherwise re-sampling noise below the
 * visible threshold would defeat the whole point of the hash.
 */
function createHasher() {
  let hash = 0x811c9dc5;
  const write = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  return {
    text(value) {
      write(String(value));
      write('');
    },
    number(value) {
      write(String(Math.round(value * HASH_QUANTUM)));
      write('');
    },
    digest() {
      return (hash >>> 0).toString(16).padStart(8, '0');
    },
  };
}

function interpolate(left, right, targetDistance) {
  const span = right.distance - left.distance;
  const t = span > 1e-9 ? (targetDistance - left.distance) / span : 0;
  const tangentX = left.tangentX + (right.tangentX - left.tangentX) * t;
  const tangentZ = left.tangentZ + (right.tangentZ - left.tangentZ) * t;
  const magnitude = Math.hypot(tangentX, tangentZ) || 1;
  return {
    x: left.x + (right.x - left.x) * t,
    z: left.z + (right.z - left.z) * t,
    tangentX: tangentX / magnitude,
    tangentZ: tangentZ / magnitude,
  };
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

function boundsForPoints(points, margin) {
  const bounds = {
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
  };
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x - margin);
    bounds.minZ = Math.min(bounds.minZ, point.z - margin);
    bounds.maxX = Math.max(bounds.maxX, point.x + margin);
    bounds.maxZ = Math.max(bounds.maxZ, point.z + margin);
  }
  return bounds;
}

export function planConstruction(input, {
  maxModuleLength = DEFAULT_MAX_MODULE_LENGTH,
  terrainSamples = [],
  masonry = true,
} = {}) {
  const record = normalizeConstructionRecord(input);
  if (record.path.type !== 'cubicBezier') {
    throw new Error('The live construction planner currently requires a cubic Bézier path.');
  }
  if (!(maxModuleLength >= 1)) throw new Error('Maximum construction module length is invalid.');
  const sampled = sampleCubicBezierPath(record.path);

  // Contiguous arc range per segment, so per-segment anchored top points and
  // features resolve to the same absolute arc coordinate the modules use.
  // Ranges are chained rather than taken from sample membership because the
  // sampler drops each segment's duplicated first point (see `CurveArcTable`).
  const segmentEnds = new Map();
  const segmentOrder = [];
  for (const entry of sampled.points) {
    if (!segmentEnds.has(entry.segmentId)) segmentOrder.push(entry.segmentId);
    segmentEnds.set(entry.segmentId, Math.max(segmentEnds.get(entry.segmentId) ?? 0, entry.distance));
  }
  const segmentRanges = new Map();
  let previousEnd = 0;
  for (let index = 0; index < segmentOrder.length; index += 1) {
    const segmentId = segmentOrder[index];
    const end = index === segmentOrder.length - 1
      ? sampled.totalDistance
      : segmentEnds.get(segmentId);
    segmentRanges.set(segmentId, { start: previousEnd, end });
    previousEnd = end;
  }
  const toArc = (segmentId, arcFraction) => {
    const range = segmentRanges.get(segmentId);
    if (!range) return 0;
    return range.start + (range.end - range.start) * arcFraction;
  };

  const topPoints = record.top.profile
    .map((entry) => ({ distance: toArc(entry.segmentId, entry.arcFraction), height: entry.height }))
    .sort((a, b) => a.distance - b.distance);
  const featureArcs = record.features.map((feature) => ({
    feature,
    distance: toArc(feature.segmentId, feature.arcFraction),
  }));

  function hashModule(moduleId, from, to, modulePoints) {
    const hasher = createHasher();
    hasher.text(moduleId);
    hasher.text(record.style.key);
    hasher.number(record.style.version);
    for (const family of ['stone', 'mortar', 'roof']) {
      hasher.text(record.style.materials[family] ?? '-');
    }
    hasher.number(record.seed);
    hasher.number(record.dimensions.height);
    hasher.number(record.dimensions.thickness);
    hasher.text(record.top.style);
    hasher.number(record.top.base);
    // The course grid is solved for the whole wall (see below), so a top edit
    // anywhere can re-space the courses everywhere. Without it in the hash the
    // edited module rebuilds onto the new grid while its neighbour keeps the old
    // one, and the courses step at the seam — the exact failure the wall-wide
    // grid exists to prevent. Locality still holds for the common case, because
    // the grid only moves when the wall's tallest point crosses a course.
    hasher.number(wallCourseHeight ?? 0);
    hasher.number(wallTopHeight ?? 0);
    for (const point of modulePoints) {
      hasher.number(point.x);
      hasher.number(point.z);
      hasher.number(point.tangentX);
      hasher.number(point.tangentZ);
    }
    // The interpolated top height inside a module also depends on the nearest
    // control point on each side, so bracket the slice rather than clipping it.
    let first = topPoints.findIndex((entry) => entry.distance >= from);
    if (first < 0) first = topPoints.length;
    let last = -1;
    for (let index = topPoints.length - 1; index >= 0; index -= 1) {
      if (topPoints[index].distance <= to) {
        last = index;
        break;
      }
    }
    const sliceStart = Math.max(0, first - 1);
    const sliceEnd = Math.min(topPoints.length - 1, last + 1);
    for (let index = sliceStart; index <= sliceEnd; index += 1) {
      hasher.number(topPoints[index].distance);
      hasher.number(topPoints[index].height);
    }
    for (const { feature, distance } of featureArcs) {
      const margin = feature.width / 2 + 0.5;
      if (distance + margin <= from || distance - margin >= to) continue;
      hasher.text(feature.id);
      hasher.text(feature.kind);
      hasher.text(feature.profile);
      hasher.text(feature.group ?? '-');
      hasher.text(feature.dressed ? 'd' : '-');
      hasher.number(distance);
      hasher.number(feature.width);
      hasher.number(feature.height);
      hasher.number(feature.sill);
    }
    return hasher.digest();
  }

  // The masonry solve needs the same arc-length view of the path the renderer
  // will use, so both come from one table rather than two approximations.
  const style = constructionStyle(record.style.key);
  const arcTable = masonry ? createCurveArcTable(sampled) : null;
  const topProfile = masonry ? createWallTopProfile(record, arcTable, { style }) : null;
  // One course grid for the whole wall. Derived per module it would drift
  // wherever the top height differs, and courses would step at the boundary.
  let wallCourseHeight = null;
  let wallTopHeight = null;
  if (masonry) {
    let wallTop = 0;
    const samples = Math.max(8, Math.ceil(sampled.totalDistance / 0.5));
    for (let index = 0; index <= samples; index += 1) {
      wallTop = Math.max(wallTop, topProfile.heightAt((sampled.totalDistance * index) / samples));
    }
    const body = Math.max(0.12, wallTop - (
      record.top.style === 'flat' || record.top.style === 'irregular' ? 0.16 : 0
    ));
    wallCourseHeight = body / Math.max(1, Math.ceil(body / style.courseHeight));
    wallTopHeight = wallTop;
  }
  let stoneTotal = 0;
  let overBudget = false;

  const modules = [];
  for (const segment of record.path.segments) {
    const segmentPoints = sampled.points.filter(({ segmentId }) => segmentId === segment.id);
    if (segmentPoints.length < 2) continue;
    // Take the segment's span from the **contiguous** ranges, not from its own
    // sampled points. The sampler drops each segment's duplicated first point,
    // so `segmentPoints[0].distance` sits strictly *after* the previous
    // segment's last point — and modules built from it leave an unwalled sliver
    // at every segment joint. That is the visible gap in a finished wall, and
    // no amount of care inside the packer can close it.
    const range = segmentRanges.get(segment.id);
    const startDistance = range.start;
    const endDistance = range.end;
    const length = endDistance - startDistance;
    const count = Math.max(1, Math.ceil(length / maxModuleLength));
    for (let index = 0; index < count; index += 1) {
      const from = startDistance + length * index / count;
      const to = startDistance + length * (index + 1) / count;
      const middle = pointAtDistance(sampled.points, (from + to) / 2);
      const relevant = sampled.points.filter(({ distance }) => distance >= from && distance <= to);
      const endpoints = [pointAtDistance(sampled.points, from), pointAtDistance(sampled.points, to)];
      const modulePoints = [...endpoints.slice(0, 1), ...relevant, ...endpoints.slice(1)];
      const moduleId = `${segment.id}-span-${index + 1}`;
      // Each module forks the random stream from its own index, so two modules
      // never lay down the same course divisions and stack a full-height joint
      // at their shared boundary.
      const seedOffset = modules.length;
      let packed = null;
      if (masonry) {
        packed = packCurvedWall({
          arcTable,
          arcRange: [from, to],
          style,
          thickness: record.dimensions.thickness,
          seed: record.seed,
          seedOffset,
          wallRange: [0, sampled.totalDistance],
          courseHeight: wallCourseHeight,
          heightReference: wallTopHeight,
          topHeightAt: topProfile.heightAt,
          ruinFactorAt: topProfile.ruinFactorAt,
          slopeAt: topProfile.slopeAt,
          crenellationsOver: topProfile.crenellationsOver,
          topStyle: record.top.style,
          // Openings whose void or dressings reach into this module. A wide
          // gate near a boundary has to be visible to both modules or the
          // course splits on one side and not the other.
          openings: featureArcs
            .filter(({ feature, distance }) => {
              const reach = feature.width / 2 + 0.6;
              return distance + reach > from && distance - reach < to;
            })
            .map(({ feature, distance }) => ({ ...feature, s: distance })),
          budget: Math.max(0, Math.min(
            MAX_MODULE_STONES,
            MAX_CONSTRUCTION_STONES - stoneTotal,
          )),
        });
        stoneTotal += packed.stats.stones;
        // Over budget leaves the remaining modules unstoned; their shell stays
        // visible rather than the whole wall failing.
        overBudget = overBudget || packed.stats.overBudget;
      }
      modules.push(Object.freeze({
        id: moduleId,
        kind: 'curved-span',
        segmentId: segment.id,
        seedOffset,
        contentHash: hashModule(moduleId, from, to, modulePoints),
        placements: packed ? packed.stones : null,
        masonryStats: packed ? packed.stats : null,
        pathInterval: Object.freeze([from, to]),
        frame: Object.freeze({
          origin: Object.freeze([middle.x, middle.z]),
          tangent: Object.freeze([middle.tangentX, middle.tangentZ]),
          outward: Object.freeze([-middle.tangentZ, middle.tangentX]),
        }),
        dimensions: record.dimensions,
        bounds: Object.freeze(boundsForPoints(modulePoints, record.dimensions.thickness / 2)),
        openingIds: Object.freeze(record.features
          .filter(({ segmentId }) => segmentId === segment.id)
          .map(({ id }) => id)),
      }));
    }
  }
  return Object.freeze({
    version: 1,
    constructionId: record.id,
    constructionRevision: record.revision,
    totalLength: sampled.totalDistance,
    modules: Object.freeze(modules),
    terrainSamples: Object.freeze(structuredClone(terrainSamples)),
    bounds: Object.freeze(boundsForPoints(
      sampled.points,
      record.dimensions.thickness / 2,
    )),
    contentHash: (() => {
      const hasher = createHasher();
      for (const module of modules) hasher.text(module.contentHash);
      return hasher.digest();
    })(),
    stats: Object.freeze({
      sampleCount: sampled.points.length,
      moduleCount: modules.length,
      openingCount: record.features.length,
      topPointCount: record.top.profile.length,
      stoneCount: stoneTotal,
      overBudget,
    }),
  });
}

