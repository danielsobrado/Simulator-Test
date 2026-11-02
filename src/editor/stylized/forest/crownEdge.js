import { float, max, positionGeometry, smoothstep } from 'three/tsl';

/** Share of a leaf's card cut left to thin at the very edge of the crown. */
const EDGE_THIN = 0.42;
/** Alpha above the cut across which a leaf's rim fades into its body. */
const FRINGE_ALPHA = 0.55;
/** How much of a rim texel the sky behind it replaces: inside the crown, at its edge. */
const SKY_INSIDE = 0.12;
const SKY_EDGE = 0.8;

/**
 * Lets a textured crown dissolve into the sky rather than cut out of it.
 *
 * An alpha cut has no in-between: a dark leaf ends on a hard line against bright
 * sky. Blending or dithering the cut would fix the line at a cost (sorting, or the
 * screen-pattern sparkle StylizedDitheredMaterial removed), so this keeps the stable
 * cut and works on what is either side of it. Leaves at the crown's outside are
 * thinned so it ends in sprays, and each leaf's rim takes the sky's colour, so the
 * last pixels before the line are already close to what lies behind them.
 *
 * @param {object} alpha float node, the leaf map's alpha
 * @param {object} options
 * @param {number} options.cut the material's alpha test
 * @param {number} options.radius metres from the trunk axis to the crown's outside
 * @param {object} options.height 0..1 up the crown
 */
export function crownEdgeNodes(alpha, { cut, radius, height }) {
  const outer = smoothstep(0.5, 1, positionGeometry.xz.length().div(Math.max(0.001, radius)));
  const edge = max(outer, smoothstep(0.7, 1, height));
  const rim = smoothstep(cut, cut + FRINGE_ALPHA, alpha).oneMinus();
  return {
    opacity: alpha.mul(float(1).sub(edge.mul(EDGE_THIN))),
    sky: rim.mul(edge.mul(SKY_EDGE - SKY_INSIDE).add(SKY_INSIDE)),
  };
}
