/**
 * Garment surface reconstruction.
 *
 * The cloth mesh carries no positions. `position` is `(u, v, 0)` and `panel` is
 * `(cols, rows, rowBase, 0)`, and this rebuilds the surface by bicubic
 * Catmull-Rom interpolation of the panel's simulated node grid in the transform
 * texture. That decoupling is the whole design: a 36x12 verlet solve renders as a
 * smooth 72x32 surface, and making the garment twice as smooth costs the
 * simulation nothing.
 *
 * Bilinear would be cheaper and is not good enough. The robe's nine pleats are
 * authored into the *rest shape* at four grid samples each; reconstructed
 * linearly they come out as a faceted zigzag, and the whole reason the fold count
 * was chosen was that Catmull-Rom turns four samples per fold into a clean wave.
 *
 * Sixteen texel fetches per vertex sounds like a lot and is not: the position and
 * both surface tangents all come out of the *same* sixteen control points, so the
 * normal is analytic and free rather than costing two more evaluations of the
 * whole patch.
 */

import {
  attribute, clamp, float, floor, int, ivec2, textureLoad, vec3,
} from 'three/tsl';

/**
 * Uniform Catmull-Rom through `p1` and `p2` at `t`, and its derivative.
 *
 * Written as plain functions that inline node expressions rather than as TSL
 * `Fn`s: they are called ten times between the position and the two tangents,
 * and inlining keeps the generated code free of the type-layout declarations a
 * `Fn` would need for every arity used here.
 */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t.mul(t);
  const t3 = t2.mul(t);
  return p1.mul(2)
    .add(p2.sub(p0).mul(t))
    .add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t2))
    .add(p1.mul(3).sub(p0).sub(p2.mul(3)).add(p3).mul(t3))
    .mul(0.5);
}

function catmullDerivative(p0, p1, p2, p3, t) {
  const t2 = t.mul(t);
  return p2.sub(p0)
    .add(p0.mul(2).sub(p1.mul(5)).add(p2.mul(4)).sub(p3).mul(t).mul(2))
    .add(p1.mul(3).sub(p0).sub(p2.mul(3)).add(p3).mul(t2).mul(3))
    .mul(0.5);
}

/**
 * @param {import('three').DataTexture} transformTexture
 */
export function createClothSurfaceNodes(transformTexture) {
  const panel = attribute('panel', 'vec4');
  const cols = int(panel.x);
  const rows = int(panel.y);
  const rowBase = int(panel.z);

  /**
   * One grid node. U wraps — every panel is a closed tube, and the seam has to
   * interpolate through rather than clamp against itself or the robe grows a
   * crease down the front. V clamps, because the hem and the waistband are
   * genuine ends.
   */
  const node = (col, row) => {
    const c = col.add(cols).mod(cols);
    const r = clamp(row, int(0), rows.sub(1)).add(rowBase);
    return textureLoad(transformTexture, ivec2(c, r)).xyz;
  };

  /**
   * @param {import('three/tsl').Node} uv `positionLocal.xy` — the panel parameter
   * @returns {{ position: Node, normal: Node }}
   */
  function surface(uv) {
    // Grid coordinates. U spans the full ring so it wraps at `cols`; V spans the
    // rows inclusive, so the last row lands exactly on the hem.
    const gu = uv.x.mul(float(cols));
    const gv = uv.y.mul(float(rows.sub(1)));
    const fu = floor(gu);
    const fv = floor(gv);
    const tu = gu.sub(fu);
    const tv = gv.sub(fv);
    const iu = int(fu);
    const iv = int(fv);

    // Four rows of four control points, then Catmull-Rom across and down. The
    // per-row derivative gives dP/du and the across-rows derivative gives dP/dv,
    // both from control points already in registers.
    const rowPos = [];
    const rowDer = [];
    for (let r = -1; r <= 2; r++) {
      const row = iv.add(int(r));
      const p0 = node(iu.sub(int(1)), row);
      const p1 = node(iu, row);
      const p2 = node(iu.add(int(1)), row);
      const p3 = node(iu.add(int(2)), row);
      rowPos.push(catmull(p0, p1, p2, p3, tu));
      rowDer.push(catmullDerivative(p0, p1, p2, p3, tu));
    }

    const position = catmull(rowPos[0], rowPos[1], rowPos[2], rowPos[3], tv);
    const dU = catmull(rowDer[0], rowDer[1], rowDer[2], rowDer[3], tv);
    const dV = catmullDerivative(rowPos[0], rowPos[1], rowPos[2], rowPos[3], tv);

    return {
      position,
      // The surface's own tangents. Handed back because they are the only real
      // tangent frame anywhere on this character: the weave's normal
      // perturbation and the hair's anisotropic streak both need one, and this
      // is the one mesh that gets it for free.
      tangentU: dU,
      tangentV: dV,
      // V runs down the garment and U around it, so U x V points outward on a
      // tube wound this way. Both faces are drawn anyway — every garment is an
      // open sheet — and the fragment stage flips the normal toward the viewer.
      normal: vec3(dU).cross(vec3(dV)).normalize(),
    };
  }

  return { surface };
}
