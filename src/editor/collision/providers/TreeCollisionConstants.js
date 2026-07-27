export const TREE_COLLISION_LOWER_BAND_START_RATIO = 0.08;
export const TREE_COLLISION_LOWER_BAND_END_RATIO = 0.34;
export const TREE_COLLISION_SLICE_COUNT = 6;
export const TREE_COLLISION_MINIMUM_SLICE_POINTS = 6;
export const TREE_COLLISION_RADIUS_PERCENTILE = 0.85;
export const TREE_COLLISION_PROFILE_SELECTION_RATIO = 0.35;
export const TREE_COLLISION_MAXIMUM_RADIUS_HEIGHT_RATIO = 0.45;
export const TREE_COLLISION_SIGNATURE_SCALE = 10000;
// Positions this close together are the same trunk sample. Authored rings
// duplicate their seam vertex, and counting it twice would bias the centre.
export const TREE_COLLISION_CENTRE_MERGE_SCALE = 10000;
