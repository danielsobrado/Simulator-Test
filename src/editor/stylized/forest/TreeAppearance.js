import { hash32 } from '../scatterMath.js';

export const TREE_COLOR_VARIATION_MIN = 0.9;
export const TREE_COLOR_VARIATION_RANGE = 0.2;

export function treeBaseSeed(placement) {
  if (Number.isFinite(placement.priority)) return placement.priority;
  return hash32(placement.index ?? 0) / 0xffffffff;
}

export function treeRenderSeed(placement) {
  return Number.isFinite(placement.windSeed)
    ? placement.windSeed
    : treeBaseSeed(placement);
}

export function treeColorVariation(placement) {
  return TREE_COLOR_VARIATION_MIN
    + treeRenderSeed(placement) * TREE_COLOR_VARIATION_RANGE;
}

export function treeMorphology(placement) {
  const crownScale = placement.crownScale ?? 1;
  const crownAspect = placement.crownAspect ?? 1;
  return [
    crownScale * crownAspect,
    crownScale,
    placement.trunkScale ?? 1,
  ];
}
