/**
 * Deterministic edge-wear / arris sampler for near-LOD masonry.
 *
 * Independent of Three.js, face relief and stoneJitter. Packing owns the
 * outer footprint; this module only decides how far the broad-face boundary
 * retreats inward and how deep the bevel travels into the stone.
 *
 * Corner order: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left.
 * Edge order:   0 bottom, 1 right, 2 top, 3 left.
 */

const BASE_DOMAIN = 0x243f6a88;
const CORNER_DOMAIN = 0x85a308d3;
const EDGE_DOMAIN = 0x13198a2e;
const FLATTEN_DOMAIN = 0x03707344;
const FRONT_SIDE_DOMAIN = 0x243f6a88;
const BACK_SIDE_DOMAIN = 0x85a308d3;

/** Shared stone-level mix vs side-specific mix for front/rear correlation. */
const SIDE_SHARED = 0.7;
const SIDE_LOCAL = 0.3;

function mixSeed(seed, value) {
  let hash = (seed ^ Math.imul(value + 1, 0x9e3779b1)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function laneUnit(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

function laneSigned(hash, shift) {
  return ((((hash >>> shift) & 255) / 255) - 0.5) * 2;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function correlatedVariation({ shared, local, correlation }) {
  return shared * correlation + local * (1 - correlation);
}

function cornerIsTop(index) {
  return index === 2 || index === 3;
}

function assertProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('StoneEdgeWearField: profile is required.');
  }
  if (!profile.bevel || !profile.categories || !profile.minimumStone || !profile.safeguards) {
    throw new Error('StoneEdgeWearField: profile is incomplete.');
  }
}

const DISABLED = Object.freeze({ enabled: false });

function freezeArray(values) {
  return Object.freeze(values.map((value) => value));
}

/**
 * Sample immutable edge-wear for one stone face side.
 *
 * @param {'front'|'back'} [side='front']
 */
export function sampleStoneEdgeWear({
  profile,
  seed,
  stableIndex,
  category = 'field',
  side = 'front',
  width,
  height,
  depth,
  mortarFaceRecess,
}) {
  assertProfile(profile);
  const categoryScale = profile.categories[category] ?? 0;
  if (!profile.enabled || !(categoryScale > 0)) return DISABLED;
  if (
    !(width >= profile.minimumStone.width)
    || !(height >= profile.minimumStone.height)
    || !(depth >= profile.minimumStone.depth)
  ) {
    return DISABLED;
  }
  if (!(mortarFaceRecess > 0)) return DISABLED;

  const sideDomain = side === 'back' ? BACK_SIDE_DOMAIN : FRONT_SIDE_DOMAIN;
  const sharedBase = mixSeed((seed ^ BASE_DOMAIN) >>> 0, stableIndex);
  const sideBase = mixSeed((seed ^ BASE_DOMAIN ^ sideDomain) >>> 0, stableIndex);
  // 70% shared stone value + 30% side-specific value.
  const sharedWidthLane = laneUnit(sharedBase, 0);
  const localWidthLane = laneUnit(sideBase, 8);
  const finalWidthLane = sharedWidthLane * SIDE_SHARED + localWidthLane * SIDE_LOCAL;
  const sharedDepthLane = laneUnit(sharedBase, 8);
  const localDepthLane = laneUnit(sideBase, 16);
  const finalDepthLane = sharedDepthLane * SIDE_SHARED + localDepthLane * SIDE_LOCAL;

  const faceMinimum = Math.min(width, height);
  const widthCandidate = faceMinimum * lerp(
    profile.bevel.widthRatio.min,
    profile.bevel.widthRatio.max,
    finalWidthLane,
  ) * categoryScale;
  const depthCandidate = Math.min(faceMinimum, depth) * lerp(
    profile.bevel.depthRatio.min,
    profile.bevel.depthRatio.max,
    finalDepthLane,
  ) * categoryScale;

  let baseWidth = clamp(
    widthCandidate,
    profile.bevel.absoluteMinimum * categoryScale,
    profile.bevel.absoluteMaximum * categoryScale,
  );
  let baseDepth = clamp(
    depthCandidate,
    profile.bevel.absoluteMinimum * categoryScale,
    profile.bevel.absoluteMaximum * categoryScale,
  );

  const mortarLimit = mortarFaceRecess * profile.safeguards.maximumMortarFraction;
  const depthLimit = depth * profile.safeguards.maximumDepthFraction;
  const safeDepth = Math.min(baseDepth, mortarLimit, depthLimit);
  const clamped = safeDepth < baseDepth - 1e-12;
  baseDepth = safeDepth;
  baseWidth = Math.min(baseWidth, faceMinimum * profile.safeguards.maximumInsetEdgeRatio);

  const sharedCornerHash = mixSeed((seed ^ CORNER_DOMAIN) >>> 0, stableIndex);
  const sharedSigned = laneSigned(sharedCornerHash, 0);
  const sharedDepthSigned = laneSigned(sharedCornerHash, 8);

  const cornerWidth = [];
  const cornerDepth = [];
  const cornerFlattening = [];
  let flattenedCount = 0;

  for (let index = 0; index < 4; index += 1) {
    const cornerHash = mixSeed(
      (seed ^ CORNER_DOMAIN ^ sideDomain ^ (index + 1) * 0x9e3779b1) >>> 0,
      stableIndex,
    );
    const widthVariation = correlatedVariation({
      shared: sharedSigned,
      local: laneSigned(cornerHash, 0),
      correlation: profile.cornerVariation.correlation,
    });
    const depthVariation = correlatedVariation({
      shared: sharedDepthSigned,
      local: laneSigned(cornerHash, 8),
      correlation: profile.cornerVariation.correlation,
    });
    const widthScale = 1 + widthVariation * profile.cornerVariation.amount;
    const depthScale = 1 + depthVariation * profile.cornerVariation.amount;
    const verticalBias = cornerIsTop(index)
      ? profile.verticalBias.top
      : profile.verticalBias.bottom;

    let widthValue = baseWidth * widthScale * verticalBias;
    let depthValue = baseDepth * depthScale * lerp(1, verticalBias, 0.45);
    widthValue = clamp(
      widthValue,
      profile.bevel.absoluteMinimum * 0.5 * categoryScale,
      profile.bevel.absoluteMaximum,
    );
    depthValue = clamp(
      depthValue,
      profile.bevel.absoluteMinimum * 0.5 * categoryScale,
      Math.min(profile.bevel.absoluteMaximum, mortarLimit, depthLimit),
    );
    cornerWidth.push(widthValue);
    cornerDepth.push(depthValue);

    const flattenHash = mixSeed(
      (seed ^ FLATTEN_DOMAIN ^ sideDomain ^ (index + 1) * 0x85ebca6b) >>> 0,
      stableIndex,
    );
    const chanceLane = laneUnit(flattenHash, 0);
    if (chanceLane < profile.cornerFlattening.chance && faceMinimum >= 0.36) {
      const strength = lerp(
        profile.cornerFlattening.strengthMin,
        profile.cornerFlattening.strengthMax,
        laneUnit(flattenHash, 8),
      );
      cornerFlattening.push(strength);
      flattenedCount += 1;
    } else {
      cornerFlattening.push(0);
    }
  }

  // Cap flattening to two corners per stone face.
  if (flattenedCount > 2) {
    const ranked = cornerFlattening
      .map((strength, index) => ({ strength, index }))
      .sort((a, b) => b.strength - a.strength);
    for (let rank = 2; rank < ranked.length; rank += 1) {
      cornerFlattening[ranked[rank].index] = 0;
    }
  }

  const edgeMidpointScale = [];
  for (let index = 0; index < 4; index += 1) {
    const edgeHash = mixSeed(
      (seed ^ EDGE_DOMAIN ^ sideDomain ^ (index + 1) * 0x27d4eb2d) >>> 0,
      stableIndex,
    );
    const signed = laneSigned(edgeHash, 0);
    const scale = 1 + signed * profile.edgeVariation.amount;
    edgeMidpointScale.push(clamp(scale, 0.8, 1.2));
  }

  return Object.freeze({
    enabled: true,
    side,
    cornerWidth: freezeArray(cornerWidth),
    cornerDepth: freezeArray(cornerDepth),
    edgeMidpointScale: freezeArray(edgeMidpointScale),
    cornerFlattening: freezeArray(cornerFlattening),
    baseWidth,
    baseDepth,
    clamped,
    safeguards: profile.safeguards,
  });
}
