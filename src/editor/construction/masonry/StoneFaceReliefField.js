/**
 * Deterministic low-order face relief for near-LOD field stones.
 *
 * Independent of Three.js and of `stoneJitter`. Packing owns the footprint;
 * this module only decides how far each face sample sits behind the nominal
 * plane. Hash lanes are keyed by record seed + stableIndex + face-side domain
 * so rebuilding a module at the same LOD reproduces identical relief.
 */

const FRONT_DOMAIN = 0x243f6a88;
const BACK_DOMAIN = 0x85a308d3;
const SHAPE_DOMAIN = 0x13198a2e;

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

function sideDomain(side) {
  if (side === 'front') return FRONT_DOMAIN;
  if (side === 'back') return BACK_DOMAIN;
  throw new Error(`StoneFaceReliefField: side must be "front" or "back", got ${side}.`);
}

function assertProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('StoneFaceReliefField: profile is required.');
  }
  if (!profile.grid || !profile.recession || !profile.categories || !profile.minimumStone) {
    throw new Error('StoneFaceReliefField: profile is incomplete.');
  }
  if (!(profile.recession.ratioMax >= profile.recession.ratioMin)) {
    throw new Error('StoneFaceReliefField: invalid recession ratios.');
  }
  if (!(profile.recession.maximum >= profile.recession.minimum)) {
    throw new Error('StoneFaceReliefField: invalid recession absolute range.');
  }
}

const DISABLED = Object.freeze({ enabled: false });

/**
 * Sample a frozen relief descriptor for one stone face.
 *
 * @returns {Readonly<{
 *   enabled: boolean,
 *   columns?: number,
 *   rows?: number,
 *   edgeRecession?: number,
 *   tiltU?: number,
 *   tiltV?: number,
 *   saddle?: number,
 *   edgeFalloffPower?: number,
 *   clampedByBevel?: boolean,
 *   clampedByMortar?: boolean,
 * }>}
 */
export function sampleStoneFaceRelief({
  profile,
  seed,
  stableIndex,
  category = 'field',
  side,
  width,
  height,
  bevelRadius,
  mortarFaceRecess,
}) {
  assertProfile(profile);

  const categoryScale = profile.categories[category] ?? 0;
  if (!profile.enabled || !(categoryScale > 0)) return DISABLED;
  if (!(width >= profile.minimumStone.width) || !(height >= profile.minimumStone.height)) {
    return DISABLED;
  }
  if (!(bevelRadius > 0) || !(mortarFaceRecess > 0)) return DISABLED;

  const domain = sideDomain(side);
  const shapeHash = mixSeed((seed ^ SHAPE_DOMAIN ^ domain) >>> 0, stableIndex);
  const recessHash = mixSeed((seed ^ domain) >>> 0, stableIndex);

  const recessionLane = laneUnit(recessHash, 0);
  const minimumDimension = Math.min(width, height);
  const requested = minimumDimension * lerp(
    profile.recession.ratioMin,
    profile.recession.ratioMax,
    recessionLane,
  ) * categoryScale;

  const absoluteClamped = clamp(
    requested,
    profile.recession.minimum * categoryScale,
    profile.recession.maximum * categoryScale,
  );

  const bevelLimit = bevelRadius * profile.maximumBevelFraction;
  const bevelClamped = Math.min(absoluteClamped, bevelLimit);
  const mortarLimit = mortarFaceRecess * profile.maximumMortarRecessFraction;
  const mortarClamped = Math.min(bevelClamped, mortarLimit);

  // Keep a strict inequality against the bevel radius so the bevel strip cannot
  // reverse (edge recession must stay behind the side ring).
  const safeBevelGap = bevelRadius * 0.05;
  const edgeRecession = Math.min(
    mortarClamped,
    Math.max(0, bevelRadius - safeBevelGap),
  );

  const asymmetry = profile.asymmetry;
  return Object.freeze({
    enabled: true,
    columns: profile.grid.columns,
    rows: profile.grid.rows,
    edgeRecession,
    tiltU: laneSigned(shapeHash, 0) * asymmetry,
    tiltV: laneSigned(shapeHash, 8) * asymmetry,
    saddle: laneSigned(shapeHash, 16) * profile.saddleStrength,
    edgeFalloffPower: profile.edgeFalloffPower,
    clampedByBevel: absoluteClamped > bevelLimit + 1e-12,
    clampedByMortar: bevelClamped > mortarLimit + 1e-12,
  });
}

/**
 * Recession behind the nominal face plane at normalised face coordinates.
 * Boundary samples (u or v at 0 / 1) always return the full edge recession.
 */
export function faceRecessionAt(relief, u, v) {
  if (!relief?.enabled) return 0;
  const edgeU = Math.sin(Math.PI * u);
  const edgeV = Math.sin(Math.PI * v);
  const envelope = Math.pow(
    Math.max(0, edgeU * edgeV),
    relief.edgeFalloffPower,
  );
  const centredU = u - 0.5;
  const centredV = v - 0.5;
  const asymmetry = (
    1
    + centredU * relief.tiltU
    + centredV * relief.tiltV
    + centredU * centredV * relief.saddle
  );
  const fullness = Math.max(0, Math.min(1, envelope * asymmetry));
  return relief.edgeRecession * (1 - fullness);
}
