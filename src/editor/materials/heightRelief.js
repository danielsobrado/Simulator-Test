import { positionView } from 'three/tsl';

/**
 * The terrain normal tilted by a procedural height (metres) through screen
 * derivatives: relief without a normal texture or extra geometry.
 */
export function heightRelief(normal, height) {
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const tangentX = dy.cross(normal), tangentY = normal.cross(dx);
  const determinant = dx.dot(tangentX);
  const gradient = height.dFdx().mul(tangentX).add(height.dFdy().mul(tangentY)).mul(determinant.sign());
  return normal.mul(determinant.abs().max(1e-8)).sub(gradient).normalize();
}
