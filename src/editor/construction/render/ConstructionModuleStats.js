export const ROUNDED_STAT_KEYS = Object.freeze([
  'roundedStones', 'roundedTriangles', 'roundedFallbacks', 'roundedShrunk',
  'roundedBuildMs', 'footingStones',
]);

export const MODULE_STAT_KEYS = Object.freeze([
  'stones', 'mortarPrisms', 'stoneTriangles', 'mortarTriangles',
  'reliefStones', 'reliefFallbacks', 'reliefClamped', 'reliefTriangles', 'reliefBuildMs',
  'edgeWearEligible', 'edgeWearStones', 'edgeWearClamped', 'edgeWearFallbacks',
  'flattenedCorners', 'edgeWearTriangles', 'edgeWearBuildMs',
  'nearSoftStones', 'coarseSoftStones', 'nearSoftTriangles', 'coarseSoftTriangles',
  'appearanceDescriptors', 'appearanceDescriptorMs', 'lodReductionMs',
  'stoneBuildMs', 'mortarBuildMs', ...ROUNDED_STAT_KEYS, 'growthLeaves', 'growthTriangles',
]);

/** Replace one module's contribution without visiting unrelated resident modules. */
export function updateModuleStats(totals, previous, next) {
  for (const key of MODULE_STAT_KEYS) {
    totals[key] = (totals[key] ?? 0) + ((next?.[key] ?? 0) - (previous?.[key] ?? 0));
  }
}
