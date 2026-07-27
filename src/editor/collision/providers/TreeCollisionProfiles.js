import {
  TREE_COLLISION_CENTRE_MERGE_SCALE,
  TREE_COLLISION_LOWER_BAND_END_RATIO,
  TREE_COLLISION_LOWER_BAND_START_RATIO,
  TREE_COLLISION_MAXIMUM_RADIUS_HEIGHT_RATIO,
  TREE_COLLISION_MINIMUM_SLICE_POINTS,
  TREE_COLLISION_PROFILE_SELECTION_RATIO,
  TREE_COLLISION_RADIUS_PERCENTILE,
  TREE_COLLISION_SIGNATURE_SCALE,
  TREE_COLLISION_SLICE_COUNT,
} from './TreeCollisionConstants.js';

const MINIMUM_AGGREGATE_POINTS = 3;
const LOWEST_RING_EPSILON = 1e-6;

function readPosition(attribute, index) {
  if (typeof attribute.getX === 'function') {
    return {
      x: attribute.getX(index),
      y: attribute.getY(index),
      z: attribute.getZ(index),
    };
  }
  const itemSize = attribute.itemSize ?? 3;
  const offset = index * itemSize;
  return {
    x: attribute.array[offset],
    y: attribute.array[offset + 1],
    z: attribute.array[offset + 2],
  };
}

function positionAttribute(part) {
  const attribute = part?.geometry?.getAttribute?.('position')
    ?? part?.geometry?.attributes?.position;
  if (!attribute || !Number.isSafeInteger(attribute.count) || attribute.count < 1) {
    throw new Error('Tree trunk collision derivation requires position attributes.');
  }
  return attribute;
}

function forEachTrunkPosition(parts, visitor) {
  let trunkParts = 0;
  for (const part of parts ?? []) {
    if (part?.kind !== 'trunk') continue;
    trunkParts += 1;
    const attribute = positionAttribute(part);
    for (let index = 0; index < attribute.count; index += 1) {
      const point = readPosition(attribute, index);
      if (![point.x, point.y, point.z].every(Number.isFinite)) {
        throw new Error('Tree trunk collision geometry contains non-finite positions.');
      }
      visitor(point);
    }
  }
  if (trunkParts === 0) throw new Error('Tree collision prototype contains no trunk geometry.');
}

function percentile(values, ratio) {
  values.sort((left, right) => left - right);
  const index = Math.min(values.length - 1, Math.floor((values.length - 1) * ratio));
  return values[index];
}

function createSlice() {
  return {
    count: 0,
    // Distinct horizontal samples, keyed by quantized position. The centre is
    // their mean rather than the midpoint of their bounding box: a low-poly
    // trunk ring is a triangle, whose bounding box is centred off-axis, and
    // measuring radii from that off-axis point inflates every one of them.
    samples: new Map(),
    radii: [],
  };
}

function updateSlice(slice, point) {
  slice.count += 1;
  const key = `${Math.round(point.x * TREE_COLLISION_CENTRE_MERGE_SCALE)}`
    + `:${Math.round(point.z * TREE_COLLISION_CENTRE_MERGE_SCALE)}`;
  if (!slice.samples.has(key)) slice.samples.set(key, { x: point.x, z: point.z });
}

function sliceCenter(slice) {
  if (slice.samples.size === 0) return { x: 0, z: 0 };
  let sumX = 0;
  let sumZ = 0;
  for (const sample of slice.samples.values()) {
    sumX += sample.x;
    sumZ += sample.z;
  }
  return { x: sumX / slice.samples.size, z: sumZ / slice.samples.size };
}

function sliceIndexFor(y, minimum, maximum) {
  const range = Math.max(Number.EPSILON, maximum - minimum);
  const normalized = Math.max(0, Math.min(1 - Number.EPSILON, (y - minimum) / range));
  return Math.floor(normalized * TREE_COLLISION_SLICE_COUNT);
}

function candidateForSlice(slice) {
  if (slice.count < MINIMUM_AGGREGATE_POINTS || slice.radii.length === 0) return null;
  const center = sliceCenter(slice);
  return {
    centerX: center.x,
    centerZ: center.z,
    radius: percentile(slice.radii, TREE_COLLISION_RADIUS_PERCENTILE),
  };
}

function collectLowestRing(parts) {
  let lowestY = Number.POSITIVE_INFINITY;
  let lowest = createSlice();
  forEachTrunkPosition(parts, (point) => {
    if (point.y < lowestY - LOWEST_RING_EPSILON) {
      lowestY = point.y;
      lowest = createSlice();
    }
    if (Math.abs(point.y - lowestY) <= LOWEST_RING_EPSILON) updateSlice(lowest, point);
  });
  const center = sliceCenter(lowest);
  forEachTrunkPosition(parts, (point) => {
    if (Math.abs(point.y - lowestY) > LOWEST_RING_EPSILON) return;
    lowest.radii.push(Math.hypot(point.x - center.x, point.z - center.z));
  });
  return lowest;
}

function deriveLowerTrunk(parts) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
  };
  forEachTrunkPosition(parts, (point) => {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
  });

  const height = bounds.maxY - bounds.minY;
  if (!(height > 0)) throw new Error('Tree trunk collision height must be positive.');
  const bandMinimum = bounds.minY + height * TREE_COLLISION_LOWER_BAND_START_RATIO;
  const bandMaximum = bounds.minY + height * TREE_COLLISION_LOWER_BAND_END_RATIO;
  const slices = Array.from({ length: TREE_COLLISION_SLICE_COUNT }, createSlice);
  const aggregate = createSlice();

  forEachTrunkPosition(parts, (point) => {
    if (point.y < bandMinimum || point.y > bandMaximum) return;
    updateSlice(slices[sliceIndexFor(point.y, bandMinimum, bandMaximum)], point);
    updateSlice(aggregate, point);
  });

  const centres = slices.map(sliceCenter);
  const aggregateCenter = sliceCenter(aggregate);
  forEachTrunkPosition(parts, (point) => {
    if (point.y < bandMinimum || point.y > bandMaximum) return;
    const index = sliceIndexFor(point.y, bandMinimum, bandMaximum);
    const centre = centres[index];
    slices[index].radii.push(Math.hypot(point.x - centre.x, point.z - centre.z));
    aggregate.radii.push(Math.hypot(
      point.x - aggregateCenter.x,
      point.z - aggregateCenter.z,
    ));
  });

  const candidates = slices
    .map((slice) => (
      slice.count >= TREE_COLLISION_MINIMUM_SLICE_POINTS
        ? candidateForSlice(slice)
        : null
    ))
    .filter(Boolean)
    .sort((left, right) => left.radius - right.radius);

  const selected = candidates.length > 0
    ? candidates[Math.floor((candidates.length - 1) * TREE_COLLISION_PROFILE_SELECTION_RATIO)]
    : candidateForSlice(aggregate) ?? candidateForSlice(collectLowestRing(parts));
  return {
    bounds,
    height,
    selected,
    fallbackCenterX: (bounds.minX + bounds.maxX) * 0.5,
    fallbackCenterZ: (bounds.minZ + bounds.maxZ) * 0.5,
  };
}

function overrideFor(config, prototypeKey, prototypeIndex) {
  return config.prototypeOverrides?.[prototypeKey]
    ?? config.prototypeOverrides?.[String(prototypeIndex)]
    ?? null;
}

function finite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`Tree collision ${name} must be finite.`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (!(value > 0)) throw new Error(`Tree collision ${name} must be positive.`);
  return value;
}

function quantize(value) {
  return Math.round(value * TREE_COLLISION_SIGNATURE_SCALE);
}

export function deriveTreeCollisionProfile({
  parts,
  prototypeIndex,
  prototypeKey = `prototype:${prototypeIndex}`,
  config,
}) {
  if (!config || typeof config !== 'object') {
    throw new Error('Tree collision profile derivation requires configuration.');
  }
  const lower = deriveLowerTrunk(parts);
  const override = overrideFor(config, prototypeKey, prototypeIndex);
  if (!lower.selected && override?.radius == null) {
    throw new Error(
      `Tree collision prototype ${prototypeKey} has no usable lower-trunk sample; add a prototype override.`,
    );
  }

  const radius = Math.max(
    config.minimumTrunkRadius,
    positive(override?.radius ?? lower.selected.radius, `${prototypeKey}.radius`),
  );
  const height = positive(override?.height ?? lower.height, `${prototypeKey}.height`);
  const centerX = finite(
    override?.centerX ?? lower.selected?.centerX ?? lower.fallbackCenterX,
    `${prototypeKey}.centerX`,
  );
  const centerZ = finite(
    override?.centerZ ?? lower.selected?.centerZ ?? lower.fallbackCenterZ,
    `${prototypeKey}.centerZ`,
  );
  const baseY = finite(override?.baseY ?? lower.bounds.minY, `${prototypeKey}.baseY`);

  if (override?.radius == null && radius / height > TREE_COLLISION_MAXIMUM_RADIUS_HEIGHT_RATIO) {
    throw new Error(
      `Tree collision prototype ${prototypeKey} has an implausible lower-trunk radius; add a prototype override.`,
    );
  }

  return Object.freeze({
    id: prototypeKey,
    prototypeIndex,
    radius,
    height,
    centerX,
    centerZ,
    baseY,
  });
}

export function deriveTreeCollisionProfiles({ prototypes, prototypeKeys = [], config }) {
  if (!Array.isArray(prototypes) || prototypes.length === 0) {
    throw new Error('Tree collision profiles require at least one tree prototype.');
  }
  const profiles = prototypes.map((parts, prototypeIndex) => deriveTreeCollisionProfile({
    parts,
    prototypeIndex,
    prototypeKey: prototypeKeys[prototypeIndex] ?? `prototype:${prototypeIndex}`,
    config,
  }));
  return Object.freeze(profiles);
}

export function treeCollisionProfileSignature(profiles) {
  return profiles.map((profile) => [
    profile.id,
    quantize(profile.radius),
    quantize(profile.height),
    quantize(profile.centerX),
    quantize(profile.centerZ),
    quantize(profile.baseY),
  ].join(':')).join('|');
}
