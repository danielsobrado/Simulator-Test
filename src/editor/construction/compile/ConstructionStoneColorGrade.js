import { mixSeed } from '../../workshop/ProceduralRandom.js';
import { constructionStoneColorProfile } from '../config/ConstructionStoneColorProfiles.generated.js';

const COLOR_HASH = 0x243f6a88;
const VALUE_HASH = 0x85a308d3;

function lane(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function categoryStrength(profile, category) {
  return profile.categories?.[category]
    ?? profile.categories?.field
    ?? 1;
}

/**
 * Apply one stable warm/cool grade to a complete stone after baked AO shading.
 *
 * The multiplier is uniform over the stone, so the bevel/contact shading already
 * written by `applyUnitShading` is preserved. It is intentionally disabled when
 * a user selected an imported stone preset: authored texture colour should not
 * be repainted by the procedural limestone palette.
 */
export function applyConstructionStoneColorGrade(geometry, {
  styleKey,
  seed,
  stableIndex,
  category = 'field',
  hasCustomStoneMaterial = false,
} = {}) {
  const profile = constructionStoneColorProfile(styleKey);
  const color = geometry?.getAttribute?.('color');
  if (
    !color
    || !profile.enabled
    || hasCustomStoneMaterial
    || !(profile.strength > 0)
  ) return geometry;

  const categoryAmount = categoryStrength(profile, category);
  if (!(categoryAmount > 0)) return geometry;

  const colorHash = mixSeed((seed >>> 0) ^ COLOR_HASH, stableIndex >>> 0);
  const valueHash = mixSeed((seed >>> 0) ^ VALUE_HASH, stableIndex >>> 0);
  const familyLane = lane(colorHash, 0);
  const neutralLane = lane(colorHash, 8);
  const strengthLane = lane(colorHash, 16);
  const outlierLane = lane(colorHash, 24);

  let target = [1, 1, 1];
  if (outlierLane < profile.outlier.chance) {
    target = profile.outlier.multiplier;
  } else if (neutralLane >= profile.neutralChance) {
    target = familyLane < profile.warmChance ? profile.warm : profile.cool;
  }

  const amount = profile.strength
    * categoryAmount
    * lerp(0.72, 1, strengthLane);
  const value = lerp(profile.value.min, profile.value.max, lane(valueHash, 8));
  const multipliers = target.map((channel) => lerp(1, channel, amount) * value);

  for (let vertex = 0; vertex < color.count; vertex += 1) {
    color.setXYZ(
      vertex,
      Math.max(0, Math.min(1, color.getX(vertex) * multipliers[0])),
      Math.max(0, Math.min(1, color.getY(vertex) * multipliers[1])),
      Math.max(0, Math.min(1, color.getZ(vertex) * multipliers[2])),
    );
  }
  color.needsUpdate = true;
  return geometry;
}
