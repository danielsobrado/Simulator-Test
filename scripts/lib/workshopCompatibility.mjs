import assert from 'node:assert/strict';

function roundNumber(value, precision) {
  if (!Number.isFinite(value)) {
    throw new Error('Workshop compatibility snapshots cannot contain non-finite numbers.');
  }
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function stableValue(value, precision = 6) {
  if (typeof value === 'number') return roundNumber(value, precision);
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, precision));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry, precision)]),
  );
}

export function stableJson(value, precision = 6) {
  return `${JSON.stringify(stableValue(value, precision), null, 2)}\n`;
}

function triangleCount(geometry) {
  const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return count / 3;
}

function boundsForPart(part) {
  part.geometry.computeBoundingBox();
  const bounds = part.geometry.boundingBox?.clone();
  if (!bounds || bounds.isEmpty()) return null;
  if (part.matrix) bounds.applyMatrix4(part.matrix);
  return bounds;
}

function mergeBounds(target, bounds) {
  if (!bounds) return;
  target.min[0] = Math.min(target.min[0], bounds.min.x);
  target.min[1] = Math.min(target.min[1], bounds.min.y);
  target.min[2] = Math.min(target.min[2], bounds.min.z);
  target.max[0] = Math.max(target.max[0], bounds.max.x);
  target.max[1] = Math.max(target.max[1], bounds.max.y);
  target.max[2] = Math.max(target.max[2], bounds.max.z);
}

function snapshotBounds(parts) {
  const aggregate = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const part of parts) mergeBounds(aggregate, boundsForPart(part));
  if (!aggregate.min.every(Number.isFinite) || !aggregate.max.every(Number.isFinite)) {
    throw new Error('Workshop compatibility geometry produced empty bounds.');
  }
  return {
    min: aggregate.min,
    max: aggregate.max,
    size: aggregate.max.map((value, index) => value - aggregate.min[index]),
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)));
}

function componentSnapshot(parts) {
  return (parts.components ?? []).map((component) => ({
    id: component.id,
    kind: component.kind,
    parentId: component.parentId ?? null,
    transformPolicy: component.transformPolicy,
    assemblyId: component.assemblyId ?? null,
    memberIds: component.memberIds ?? null,
  }));
}

export function snapshotParts(parts, precision = 6) {
  return stableValue({
    bounds: snapshotBounds(parts),
    partCount: parts.length,
    triangles: parts.reduce((total, part) => total + triangleCount(part.geometry), 0),
    vertices: parts.reduce((total, part) => (
      total + (part.geometry.getAttribute('position')?.count ?? 0)
    ), 0),
    materialSlots: countBy(parts.map((part) => part.material?.userData?.workshopSlot ?? 'unknown')),
    stats: parts.stats ?? {},
    components: componentSnapshot(parts),
    materialRegionIds: (parts.materialRegions ?? []).map(({ id }) => id).sort(),
    semantics: parts.semantics ?? null,
  }, precision);
}

export function snapshotLod(lodParts, precision = 6) {
  if (!lodParts) return null;
  return stableValue({
    config: lodParts.config,
    shadows: lodParts.shadows,
    statistics: lodParts.statistics,
    coarse: snapshotParts(lodParts.coarse, precision),
    shell: snapshotParts(lodParts.shell, precision),
  }, precision);
}

export function assertDeterministic(left, right, label, precision = 6) {
  assert.equal(
    stableJson(left, precision),
    stableJson(right, precision),
    `${label} changed between deterministic compatibility runs.`,
  );
}

export function uniqueOwnedParts(nearParts, lodParts) {
  return [...new Set([
    ...nearParts,
    ...(lodParts?.coarse ?? []),
    ...(lodParts?.shell ?? []),
  ])];
}
