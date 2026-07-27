import { hash32 } from '../scatterMath.js';

export function treeBaseSeed(placement) {
  if (Number.isFinite(placement.priority)) return placement.priority;
  return hash32(placement.index ?? 0) / 0xffffffff;
}

export function treeRenderSeed(placement) {
  return Number.isFinite(placement.windSeed)
    ? placement.windSeed
    : treeBaseSeed(placement);
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
