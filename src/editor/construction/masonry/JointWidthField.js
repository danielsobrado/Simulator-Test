import { mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * Total intended visible joint width between neighbouring stones (metres).
 * Each stone retracts roughly half via scaleCorners on its full face.
 */

const HEAD_DOMAIN = 0x243f6a88;
const BED_DOMAIN = 0x85a308d3;

function lane(seed, stableIndex, domain) {
  return (mixSeed(seed ^ domain, stableIndex) >>> 0) / 0x100000000;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

/**
 * Sample head (vertical) and bed (horizontal) joint widths for one field stone.
 *
 * @param {object} options
 * @param {object} options.profile from constructionJointProfile
 * @param {number} options.seed shapeSeed (or wall seed)
 * @param {number} options.stableIndex placement stable identity
 * @param {'near'|'coarse'} [options.lodBand]
 */
export function sampleJointWidths({
  profile,
  seed,
  stableIndex,
  lodBand = 'near',
}) {
  const multiplier = lodBand === 'coarse'
    ? profile.coarseLodMultiplier
    : 1;

  return Object.freeze({
    head: lerp(
      profile.headJoint.min,
      profile.headJoint.max,
      lane(seed, stableIndex, HEAD_DOMAIN),
    ) * multiplier,

    bed: lerp(
      profile.bedJoint.min,
      profile.bedJoint.max,
      lane(seed, stableIndex, BED_DOMAIN),
    ) * multiplier,
  });
}

/**
 * Keep a stone above the profile's minimum rendered size.
 * `jointWidth` is the total gap, so retraction is applied once across the face.
 */
export function clampJointWidths(face, sampled, profile) {
  const maximumHead = Math.max(0, face.width - profile.minimumRenderedWidth);
  const maximumBed = Math.max(0, face.height - profile.minimumRenderedHeight);

  return {
    head: Math.min(sampled.head, maximumHead),
    bed: Math.min(sampled.bed, maximumBed),
    headClamped: sampled.head > maximumHead,
    bedClamped: sampled.bed > maximumBed,
  };
}
