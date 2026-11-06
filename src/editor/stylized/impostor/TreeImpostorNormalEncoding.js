// Canvas premultiplies RGB by alpha. Zero-alpha trunk pixels lose their normals.
// Trunks use 128; foliage uses 192..255, with six-bit sky visibility. The gap
// allows filtered classification at branch edges. Normal RGB retains at least
// seven-bit precision through canvas/PNG transport. Albedo owns coverage.
export const TREE_NORMAL_MASK_FLOOR_BYTE = 128;
export const TREE_NORMAL_MASK_RANGE_BYTE = 64;
export const TREE_NORMAL_VISIBILITY_RANGE_BYTE = 63;
export function encodeTreeFoliageMask(mask, visibility = 1) {
  const leaf = Math.min(1, Math.max(0, mask));
  return Math.round(TREE_NORMAL_MASK_FLOOR_BYTE + leaf * (TREE_NORMAL_MASK_RANGE_BYTE + Math.min(1, Math.max(0, visibility)) * TREE_NORMAL_VISIBILITY_RANGE_BYTE));
}
export function decodeTreeFoliageMaskNode(alpha) {
  return alpha.sub(TREE_NORMAL_MASK_FLOOR_BYTE / 255).mul(255 / TREE_NORMAL_MASK_RANGE_BYTE).clamp(0, 1);
}
export function decodeTreeCanopyVisibilityNode(alpha) {
  return alpha.mul(255).sub(TREE_NORMAL_MASK_FLOOR_BYTE + TREE_NORMAL_MASK_RANGE_BYTE).div(TREE_NORMAL_VISIBILITY_RANGE_BYTE).clamp(0, 1);
}
