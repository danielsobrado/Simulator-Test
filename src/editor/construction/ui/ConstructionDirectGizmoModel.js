import { MAX_CONSTRUCTION_TOP_POINTS } from '../ConstructionSchema.js';
import { TOP_HEIGHT_RANGE, pruneTopProfile } from '../masonry/WallTopEdit.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';

const PROFILE_KEY_PRECISION = 6;
const PROFILE_POINT_EPSILON = 1e-9;

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function profileKey({ segmentId, arcFraction }) {
  return `${segmentId}:${arcFraction.toFixed(PROFILE_KEY_PRECISION)}`;
}

function sortProfile(points, arcTable) {
  return [...points].sort((a, b) => (
    arcTable.toArc(a.segmentId, a.arcFraction) - arcTable.toArc(b.segmentId, b.arcFraction)
  ));
}

function anchorIndex(path, anchorId) {
  return path.anchors.findIndex(({ id }) => id === anchorId);
}

function canonicalAnchorLocation(path, index) {
  if (index === 0) return { segmentId: path.segments[0].id, arcFraction: 0 };
  return { segmentId: path.segments[index - 1].id, arcFraction: 1 };
}

export function anchorArcLocations(path, anchorId) {
  if (path?.type !== 'cubicBezier') return [];
  const index = anchorIndex(path, anchorId);
  if (index < 0) return [];

  const locations = [canonicalAnchorLocation(path, index)];
  if (path.closed && index === 0) {
    locations.push({ segmentId: path.segments.at(-1).id, arcFraction: 1 });
  }
  return locations;
}

export function anchorArc(record, arcTable, anchorId) {
  const [location] = anchorArcLocations(record.path, anchorId);
  return location ? arcTable.toArc(location.segmentId, location.arcFraction) : null;
}

export function nominalTopHeightAtAnchor(record, arcTable, anchorId) {
  const s = anchorArc(record, arcTable, anchorId);
  if (!Number.isFinite(s)) return null;
  return createWallTopProfile(record, arcTable).ruinStateAt(s).nominalHeight;
}

function neighbourAnchorIds(path, index) {
  const result = [];
  if (index > 0) result.push(path.anchors[index - 1].id);
  else if (path.closed) result.push(path.anchors.at(-1).id);

  if (index + 1 < path.anchors.length) result.push(path.anchors[index + 1].id);
  else if (path.closed) result.push(path.anchors[0].id);
  return result;
}

function compactProfile(record, arcTable) {
  if (record.top.profile.length < MAX_CONSTRUCTION_TOP_POINTS - 3) {
    return sortProfile(record.top.profile, arcTable);
  }
  return sortProfile(pruneTopProfile(record, arcTable), arcTable);
}

/** Set one control node's nominal height while preserving its neighbouring wall shape. */
export function setAnchorTopHeight(record, arcTable, anchorId, requestedHeight) {
  if (record?.path?.type !== 'cubicBezier' || !Number.isFinite(requestedHeight)) return null;
  const index = anchorIndex(record.path, anchorId);
  if (index < 0) return null;

  const height = clamp(requestedHeight, TOP_HEIGHT_RANGE[0], TOP_HEIGHT_RANGE[1]);
  const current = nominalTopHeightAtAnchor(record, arcTable, anchorId);
  if (!Number.isFinite(current) || Math.abs(current - height) <= PROFILE_POINT_EPSILON) return null;

  const originalProfile = createWallTopProfile(record, arcTable);
  const merged = new Map(compactProfile(record, arcTable).map((point) => [
    profileKey(point),
    { ...point },
  ]));

  for (const neighbourId of neighbourAnchorIds(record.path, index)) {
    const [location] = anchorArcLocations(record.path, neighbourId);
    if (!location || merged.has(profileKey(location))) continue;
    const s = arcTable.toArc(location.segmentId, location.arcFraction);
    merged.set(profileKey(location), {
      ...location,
      height: originalProfile.ruinStateAt(s).nominalHeight,
    });
  }

  const targets = anchorArcLocations(record.path, anchorId);
  for (const location of targets) {
    merged.set(profileKey(location), { ...location, height });
  }

  let points = sortProfile(merged.values(), arcTable);
  if (points.length > MAX_CONSTRUCTION_TOP_POINTS) {
    const candidate = { ...record, top: { ...record.top, profile: points } };
    points = sortProfile(pruneTopProfile(candidate, arcTable), arcTable);
    const byKey = new Map(points.map((point) => [profileKey(point), point]));
    for (const location of targets) {
      byKey.set(profileKey(location), { ...location, height });
    }
    points = sortProfile(byKey.values(), arcTable);
  }

  if (points.length > MAX_CONSTRUCTION_TOP_POINTS) return null;
  return { ...record.top, profile: points };
}

export function translateConstructionRecord(record, deltaX, deltaZ) {
  if (record?.path?.type !== 'cubicBezier' || !Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) {
    return null;
  }
  if (Math.abs(deltaX) <= PROFILE_POINT_EPSILON && Math.abs(deltaZ) <= PROFILE_POINT_EPSILON) {
    return record;
  }

  const path = {
    ...record.path,
    anchors: record.path.anchors.map((anchor) => ({
      ...anchor,
      position: [anchor.position[0] + deltaX, anchor.position[1] + deltaZ],
    })),
  };
  return { ...record, path, features: path.features };
}

export function constructionCentroid(record) {
  const anchors = record?.path?.type === 'cubicBezier' ? record.path.anchors : [];
  if (anchors.length === 0) return null;
  let x = 0;
  let z = 0;
  for (const anchor of anchors) {
    x += anchor.position[0];
    z += anchor.position[1];
  }
  return { x: x / anchors.length, z: z / anchors.length };
}
