import { MORPH_CHANNEL, TREE_MORPHOLOGY_RUNTIME_DEFAULTS } from './constants.js';
import { clampTreeInstanceMorphology } from './validation.js';

const PREVAILING_WIND_XZ = normalize2([0.8, 0.6]);

/** Deterministic PCG2D matching clod-poc vegetation gpu authority. */
export function treePcg2dU32(cellX, cellZ, salt) {
  const m = 1664525;
  const c = 1013904223;
  const saltU32 = salt >>> 0;
  const a0 = (Math.trunc(cellX) + 40000 + (saltU32 & 0x3fff)) >>> 0;
  const b0 = (Math.trunc(cellZ) + 40000 + ((saltU32 >>> 14) & 0x3fff)) >>> 0;
  const a1 = (Math.imul(a0, m) + c) >>> 0;
  const b1 = (Math.imul(b0, m) + c) >>> 0;
  const a2 = (a1 + Math.imul(b1, m)) >>> 0;
  const b2 = (b1 + Math.imul(a2, m)) >>> 0;
  const a3 = (a2 ^ (a2 >>> 16)) >>> 0;
  const b3 = (b2 ^ (b2 >>> 16)) >>> 0;
  const a4 = (a3 + Math.imul(b3, m)) >>> 0;
  const b4 = (b3 + Math.imul(a4, m)) >>> 0;
  return [(a4 ^ (a4 >>> 16)) >>> 0, (b4 ^ (b4 >>> 16)) >>> 0];
}

export function hash01(identity, channel) {
  const [word] = treePcg2dU32(identity.stableIdLo | 0, identity.stableIdHi | 0, channel);
  return (word & 0xffffff) / 16777216;
}

export function hashSigned(identity, channel) {
  return hash01(identity, channel) * 2 - 1;
}

/**
 * Derive per-instance tree morphology from identity + terrain/ecology/competition.
 * Ported from clod-poc `trees/morphology/derive.ts`.
 */
export function deriveTreeInstanceMorphology(
  identity,
  speciesId,
  terrain,
  ecology,
  competition,
  runtimeConfig = TREE_MORPHOLOGY_RUNTIME_DEFAULTS[speciesId]
    ?? TREE_MORPHOLOGY_RUNTIME_DEFAULTS.broadleaf_round,
) {
  const config = runtimeConfig;
  const age01 = clamp(
    0.10
      + hash01(identity, MORPH_CHANNEL.AGE) * 0.78
      + ecology.oldForestBias * 0.22
      - competition.crownPressure * 0.18,
    0,
    1,
  );
  const branchDroop = clamp(
    config.baseDroop
      + age01 * config.ageDroop
      + ecology.moisture * config.moistureDroop
      + hashSigned(identity, MORPH_CHANNEL.DROOP) * 0.08,
    -0.18,
    0.32,
  );
  const health01 = clamp(
    0.72
      + ecology.moistureSuitability * 0.18
      + ecology.temperatureSuitability * 0.14
      - competition.crownPressure * 0.18
      - ecology.stress * 0.32
      + hashSigned(identity, MORPH_CHANNEL.HEALTH) * 0.10,
    0,
    1,
  );
  const stiffness = clamp(
    config.baseStiffness + (1 - age01) * 0.12 + health01 * 0.08 - branchDroop * 0.25,
    0.65,
    1.35,
  );

  const slopeDirection = normalize2(terrain.downhillDirectionXZ);
  const randomLeanDirection = hashDirection(identity, MORPH_CHANNEL.LEAN);
  let leanX = slopeDirection[0] * terrain.slope01 * config.slopeLean
    + PREVAILING_WIND_XZ[0] * config.windLean
    + randomLeanDirection[0] * config.randomLean;
  let leanZ = slopeDirection[1] * terrain.slope01 * config.slopeLean
    + PREVAILING_WIND_XZ[1] * config.windLean
    + randomLeanDirection[1] * config.randomLean;
  const leanScale = lerp(0.55, 1.15, age01) * lerp(1.20, 0.75, stiffness);
  [leanX, leanZ] = clampLength([leanX * leanScale, leanZ * leanScale], 0.22);

  const openLight = normalize2(competition.openLightDirectionXZ);
  const randomBiasDirection = hashDirection(identity, MORPH_CHANNEL.CROWN_BIAS);
  const [crownBiasX, crownBiasZ] = clampLength([
    openLight[0] * competition.directionalPressure * 0.28 + randomBiasDirection[0] * 0.07,
    openLight[1] * competition.directionalPressure * 0.28 + randomBiasDirection[1] * 0.07,
  ], 0.35);

  return clampTreeInstanceMorphology({
    age01,
    leanX,
    leanZ,
    crownBiasX,
    crownBiasZ,
    crownWidth: clamp(
      0.88 + age01 * 0.20 - competition.crownPressure * 0.12
        + hashSigned(identity, MORPH_CHANNEL.WIDTH) * 0.08,
      0.82,
      1.18,
    ),
    crownFlattening: clamp(
      1.00 - terrain.exposure01 * config.exposureFlattening + age01 * config.ageFlattening
        + hashSigned(identity, MORPH_CHANNEL.FLAT) * 0.06,
      0.82,
      1.20,
    ),
    branchDroop,
    foliageDensity: clamp(
      0.58 + health01 * 0.48 + age01 * 0.10 - competition.crownPressure * 0.12,
      0.55,
      1.15,
    ),
    health01,
    rootFlare: clamp(
      0.85 + age01 * 0.28 + terrain.exposedRootPotential * 0.18
        + hashSigned(identity, MORPH_CHANNEL.FLARE) * 0.08,
      0.75,
      1.35,
    ),
    stiffness,
  });
}

/**
 * Build morphology samples from SimCity forest habitat + placement identity.
 */
export function deriveForestPlacementMorphology({
  stableId,
  speciesId,
  habitat,
}) {
  const identity = stableIdToIdentity(stableId);
  const slope01 = clamp(Number(habitat?.slope) || 0, 0, 1);
  const downhill = habitat?.downhillDirectionXZ ?? [0, 0];
  const moisture = clamp(Number(habitat?.waterWeight) || 0, 0, 1);
  const edge = clamp(Number(habitat?.patchEdge) || 0, 0, 1);
  const coverage = clamp(Number(habitat?.patchCoverage) || 0, 0, 1);
  return deriveTreeInstanceMorphology(
    identity,
    speciesId,
    {
      slope01,
      downhillDirectionXZ: downhill,
      exposure01: clamp(slope01 * 0.65 + edge * 0.35, 0, 1),
      exposedRootPotential: clamp(slope01 * 0.8, 0, 1),
    },
    {
      oldForestBias: clamp(coverage * (1 - edge), 0, 1),
      moisture,
      moistureSuitability: clamp(0.55 + moisture * 0.45, 0, 1),
      temperatureSuitability: 0.75,
      stress: clamp(edge * 0.35 + slope01 * 0.25, 0, 1),
    },
    {
      crownPressure: clamp(coverage * 0.55, 0, 1),
      directionalPressure: clamp(coverage * 0.4, 0, 1),
      openLightDirectionXZ: edge > 0.01
        ? normalize2([Math.cos(edge * 6.2831853), Math.sin(edge * 6.2831853)])
        : [0, 0],
    },
  );
}

export function stableIdToIdentity(stableId) {
  const text = String(stableId ?? '');
  let lo = 0x811c9dc5;
  let hi = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    lo = Math.imul(lo ^ code, 0x01000193) >>> 0;
    hi = Math.imul(hi ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return { stableIdLo: lo, stableIdHi: hi };
}

function hashDirection(identity, channel) {
  const angle = hash01(identity, channel) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}

function normalize2(input) {
  const length = Math.hypot(input[0], input[1]);
  return length > 1e-12 ? [input[0] / length, input[1] / length] : [0, 0];
}

function clampLength(input, maxLength) {
  const length = Math.hypot(input[0], input[1]);
  if (length <= maxLength || length <= 1e-12) return input;
  return [input[0] * maxLength / length, input[1] * maxLength / length];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
