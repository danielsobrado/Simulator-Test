/**
 * LOD-independent stone appearance descriptor.
 *
 * Samples face relief and edge wear once from stable identity, then both near
 * and coarse writers consume the same frozen descriptor through the LOD reducer.
 * Never keyed on coarse placement-array index.
 */

import { sampleStoneFaceRelief } from './StoneFaceReliefField.js';
import { sampleStoneEdgeWear } from './StoneEdgeWearField.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function argMax(values) {
  let bestIndex = 0;
  let bestValue = values[0];
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] > bestValue) {
      bestValue = values[index];
      bestIndex = index;
    }
  }
  return bestIndex;
}

function sideFromRelief(relief) {
  if (!relief?.enabled) {
    return Object.freeze({
      fullness: 1,
      tiltU: 0,
      tiltV: 0,
      saddle: 0,
      edgeRecession: 0,
      columns: 0,
      rows: 0,
      edgeFalloffPower: 1,
      enabled: false,
    });
  }
  // fullness: 1 = flat face plane; lower values pillow more.
  const fullness = 1 - Math.min(1, relief.edgeRecession / 0.04);
  return Object.freeze({
    fullness,
    tiltU: relief.tiltU,
    tiltV: relief.tiltV,
    saddle: relief.saddle,
    edgeRecession: relief.edgeRecession,
    columns: relief.columns,
    rows: relief.rows,
    edgeFalloffPower: relief.edgeFalloffPower,
    enabled: true,
    clampedByBevel: relief.clampedByBevel,
    clampedByMortar: relief.clampedByMortar,
  });
}

function sideFromEdgeWear(wear) {
  if (!wear?.enabled) {
    return Object.freeze({
      enabled: false,
      cornerWidth: Object.freeze([0, 0, 0, 0]),
      cornerDepth: Object.freeze([0, 0, 0, 0]),
      edgeMidpointScale: Object.freeze([1, 1, 1, 1]),
      cornerFlattening: Object.freeze([0, 0, 0, 0]),
      baseWidth: 0,
      baseDepth: 0,
      clamped: false,
      safeguards: null,
    });
  }
  return Object.freeze({
    enabled: true,
    cornerWidth: Object.freeze([...wear.cornerWidth]),
    cornerDepth: Object.freeze([...wear.cornerDepth]),
    edgeMidpointScale: Object.freeze([...wear.edgeMidpointScale]),
    cornerFlattening: Object.freeze([...wear.cornerFlattening]),
    baseWidth: wear.baseWidth,
    baseDepth: wear.baseDepth,
    clamped: wear.clamped,
    safeguards: wear.safeguards,
  });
}

/**
 * Authoritative appearance for one stone. Independent of LOD topology.
 */
export function createStoneAppearanceDescriptor({
  faceReliefProfile,
  edgeWearProfile,
  seed,
  stableIndex,
  category = 'field',
  width,
  height,
  depth,
  mortarFaceRecess,
  bevelRadius = null,
}) {
  const frontWear = sampleStoneEdgeWear({
    profile: edgeWearProfile,
    seed,
    stableIndex,
    category,
    side: 'front',
    width,
    height,
    depth,
    mortarFaceRecess,
  });
  const backWear = sampleStoneEdgeWear({
    profile: edgeWearProfile,
    seed,
    stableIndex,
    category,
    side: 'back',
    width,
    height,
    depth,
    mortarFaceRecess,
  });

  const resolvedBevelRadius = bevelRadius
    ?? Math.max(frontWear.baseWidth ?? 0, frontWear.baseDepth ?? 0, 1e-4);

  const frontRelief = sampleStoneFaceRelief({
    profile: faceReliefProfile,
    seed,
    stableIndex,
    category,
    side: 'front',
    width,
    height,
    bevelRadius: resolvedBevelRadius,
    mortarFaceRecess,
  });
  const backRelief = sampleStoneFaceRelief({
    profile: faceReliefProfile,
    seed,
    stableIndex,
    category,
    side: 'back',
    width,
    height,
    bevelRadius: resolvedBevelRadius,
    mortarFaceRecess,
  });

  const face = Object.freeze({
    front: sideFromRelief(frontRelief),
    back: sideFromRelief(backRelief),
  });
  const edges = Object.freeze({
    front: sideFromEdgeWear(frontWear),
    back: sideFromEdgeWear(backWear),
  });

  const enabled = Boolean(
    face.front.enabled
    && face.back.enabled
    && edges.front.enabled
    && edges.back.enabled,
  );

  const averageBevelWidth = enabled
    ? (mean(edges.front.cornerWidth) + mean(edges.back.cornerWidth)) / 2
    : 0;
  const averageBevelDepth = enabled
    ? (mean(edges.front.cornerDepth) + mean(edges.back.cornerDepth)) / 2
    : 0;
  const widestCorner = enabled ? argMax(edges.front.cornerWidth) : 0;
  const softestEdge = enabled ? argMax(edges.front.edgeMidpointScale) : 0;

  return deepFreeze({
    enabled,
    seed,
    stableIndex,
    category,
    dimensions: Object.freeze({ width, height, depth }),
    face,
    edges,
    dominant: Object.freeze({
      broadFaceTiltU: (face.front.tiltU + face.back.tiltU) / 2,
      broadFaceTiltV: (face.front.tiltV + face.back.tiltV) / 2,
      averageBevelWidth,
      averageBevelDepth,
      widestCorner,
      softestEdge,
    }),
    // Keep raw sampler payloads for the topology resolver / writer without
    // resampling when LOD changes.
    raw: Object.freeze({
      relief: Object.freeze({
        enabled: frontRelief.enabled && backRelief.enabled,
        front: frontRelief,
        back: backRelief,
        clamped: Boolean(
          frontRelief.clampedByBevel
          || frontRelief.clampedByMortar
          || backRelief.clampedByBevel
          || backRelief.clampedByMortar,
        ),
      }),
      edgeWear: Object.freeze({
        enabled: frontWear.enabled && backWear.enabled,
        front: frontWear,
        back: backWear,
        clamped: Boolean(frontWear.clamped || backWear.clamped),
      }),
    }),
  });
}

/**
 * Convert a reduced LOD appearance back into the relief / edgeWear shapes the
 * existing topology resolver expects.
 */
export function topologyInputsFromAppearance(appearance) {
  if (!appearance?.enabled) {
    return { relief: null, edgeWear: null };
  }

  const toRelief = (side) => {
    if (!side.enabled) return Object.freeze({ enabled: false });
    return Object.freeze({
      enabled: true,
      columns: side.columns,
      rows: side.rows,
      edgeRecession: side.edgeRecession,
      tiltU: side.tiltU,
      tiltV: side.tiltV,
      saddle: side.saddle,
      edgeFalloffPower: side.edgeFalloffPower,
      clampedByBevel: Boolean(side.clampedByBevel),
      clampedByMortar: Boolean(side.clampedByMortar),
    });
  };

  const toWear = (side, label) => {
    if (!side.enabled) return Object.freeze({ enabled: false });
    return Object.freeze({
      enabled: true,
      side: label,
      cornerWidth: Object.freeze([...side.cornerWidth]),
      cornerDepth: Object.freeze([...side.cornerDepth]),
      edgeMidpointScale: Object.freeze([...side.edgeMidpointScale]),
      cornerFlattening: Object.freeze([...side.cornerFlattening]),
      baseWidth: side.baseWidth,
      baseDepth: side.baseDepth,
      clamped: Boolean(side.clamped),
      safeguards: side.safeguards,
    });
  };

  return {
    relief: Object.freeze({
      enabled: true,
      front: toRelief(appearance.face.front),
      back: toRelief(appearance.face.back),
      clamped: Boolean(
        appearance.face.front.clampedByBevel
        || appearance.face.front.clampedByMortar
        || appearance.face.back.clampedByBevel
        || appearance.face.back.clampedByMortar,
      ),
    }),
    edgeWear: Object.freeze({
      enabled: true,
      front: toWear(appearance.edges.front, 'front'),
      back: toWear(appearance.edges.back, 'back'),
      clamped: Boolean(appearance.edges.front.clamped || appearance.edges.back.clamped),
    }),
  };
}
