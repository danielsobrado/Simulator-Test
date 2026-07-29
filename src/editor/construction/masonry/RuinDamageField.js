/**
 * Wall-global clustered ruin damage field.
 * Independent of Three.js, module index, and build order.
 */

import { mixSeed } from '../../workshop/ProceduralRandom.js';

const BROAD_DOMAIN = 0x2a3b4c5d;
const FINE_DOMAIN = 0x6e7f8091;
const COURSE_DOMAIN = 0xa1b2c3d4;
const STONE_DOMAIN = 0xd5e6f708;

const KEEP_RESULT = Object.freeze({
  remove: false,
  score: 0,
  proximity: 0,
  clusterScore: 0,
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function hashUnit(seed, value) {
  return mixSeed(seed, value) / 0x100000000;
}

function valueNoise(seed, s, wavelength) {
  const scaled = s / Math.max(1e-6, wavelength);
  const cell = Math.floor(scaled);
  const t = scaled - cell;
  const a = hashUnit(seed, cell);
  const b = hashUnit(seed, cell + 1);
  const smooth = t * t * (3 - 2 * t);
  return a + (b - a) * smooth;
}

function valueNoise2d(seed, s, courseIndex) {
  const wavelength = 1.7;
  const sx = s / wavelength;
  const cellX = Math.floor(sx);
  const tx = sx - cellX;
  const cellY = Math.floor(courseIndex);
  const a = hashUnit(seed ^ (cellY * 0x9e3779b1), cellX);
  const b = hashUnit(seed ^ (cellY * 0x9e3779b1), cellX + 1);
  const smooth = tx * tx * (3 - 2 * tx);
  return a + (b - a) * smooth;
}

export function evaluateRuinCandidate({
  profile,
  ruinFactor,
  clusterScore,
  stoneNoise,
  yTop,
  collapsedTop,
}) {
  if (!(ruinFactor > 0)) return KEEP_RESULT;

  const topDistance = Math.max(0, collapsedTop - yTop);
  const reach = profile.damage.reach.base
    + ruinFactor * profile.damage.reach.perFactor;
  const proximity = clamp01(1 - topDistance / Math.max(1e-6, reach));
  const probability = profile.damage.probability;
  const score = (
    ruinFactor * probability.base
    + proximity * probability.topProximity
    + clusterScore * probability.clusterInfluence
    + stoneNoise * probability.stoneNoiseInfluence
  );

  return Object.freeze({
    remove: score >= probability.removeThreshold,
    score,
    proximity,
    clusterScore,
  });
}

export function isProtectedFooting(placement, profile) {
  const courseIndex = placement.support?.courseIndex ?? placement.courseIndex ?? 0;
  const top = placement.support?.top ?? (placement.y + (placement.height ?? 0) / 2);
  return (
    courseIndex < profile.damage.protectedFooting.courses
    || top <= profile.damage.protectedFooting.minimumHeight
  );
}

/**
 * @param {{ seed: number, profile: object, ruinFactorAt: (s: number) => number }} args
 */
export function createRuinDamageField({
  seed,
  profile,
  ruinFactorAt,
}) {
  const seedValue = seed >>> 0;

  function sampleAt(s, courseIndex = 0) {
    if (!profile.enabled) {
      return Object.freeze({ clusterScore: 0, stoneNoise: 0, ruinFactor: 0 });
    }
    const ruinFactor = clamp01(ruinFactorAt(s) ?? 0);
    if (!(ruinFactor > 0)) {
      return Object.freeze({ clusterScore: 0, stoneNoise: 0, ruinFactor: 0 });
    }

    const broad = valueNoise(
      mixSeed(seedValue, BROAD_DOMAIN),
      s,
      profile.damage.cluster.wavelength,
    );
    const fine = valueNoise(
      mixSeed(seedValue, FINE_DOMAIN),
      s,
      profile.damage.cluster.wavelength * profile.damage.cluster.fineWavelengthRatio,
    );
    const courseDrift = valueNoise2d(
      mixSeed(seedValue, COURSE_DOMAIN),
      s,
      courseIndex,
    );
    const clusterScore = clamp01(broad * 0.62 + fine * 0.24 + courseDrift * 0.14);
    return Object.freeze({ clusterScore, ruinFactor, broad, fine, courseDrift });
  }

  function stoneNoiseAt(stableIndex) {
    return hashUnit(mixSeed(seedValue, STONE_DOMAIN), stableIndex);
  }

  function evaluateStone({
    s,
    courseIndex,
    stableIndex,
    yTop,
    collapsedTop,
    protectedFooting = false,
  }) {
    const sample = sampleAt(s, courseIndex);
    if (!(sample.ruinFactor > 0) || protectedFooting) {
      return Object.freeze({
        ...KEEP_RESULT,
        clusterScore: sample.clusterScore,
      });
    }
    const stoneNoise = stoneNoiseAt(stableIndex);
    return evaluateRuinCandidate({
      profile,
      ruinFactor: sample.ruinFactor,
      clusterScore: sample.clusterScore,
      stoneNoise,
      yTop,
      collapsedTop,
    });
  }

  return Object.freeze({
    sampleAt,
    stoneNoiseAt,
    evaluateStone,
  });
}
