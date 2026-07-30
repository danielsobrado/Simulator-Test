/**
 * The cowl.
 *
 * Built as a swept Bezier: each strand runs from a point on the face-opening rim
 * to a point on the ring where the hood meets the shoulders, bowed outward by a
 * control point that is pushed furthest over the crown. That gives a genuinely
 * deep hood with a rolled opening, rather than a sphere with a hole in it.
 *
 * The rim curve it sweeps to comes from `drowAnatomy`, and the fur trim reads the
 * same function, so the two can never drift apart.
 */

import { B_HOOD } from '../characterBones.js';
import { M_ROBE } from '../materialSlots.js';

const HOOD_COLS = 34;
const HOOD_ROWS = 9;

/**
 * @param {import('./GeometryBuilder.js').Builder} B
 * @param {ReturnType<import('./drowAnatomy.js').createAnatomy>} anatomy
 */
export function buildDrowHood(B, anatomy) {
  const { centre } = anatomy.head;
  const rim = [0, 0, 0];
  const base = [0, 0, 0];
  let prevRow = null;

  for (let r = 0; r <= HOOD_ROWS; r++) {
    const t = r / HOOD_ROWS;
    const row = [];
    for (let c = 0; c < HOOD_COLS; c++) {
      const s = c / HOOD_COLS;
      anatomy.hood.rimPoint(s, rim);
      anatomy.hood.basePoint(s, base);

      // Control point.
      //
      // Not the chord's midpoint pushed away from the skull: at the crown the
      // chord runs from a rim point above and in front of the head to a base
      // point below and behind it, straight through the skull, so its midpoint
      // is already inside the head and "away from the head centre" points down
      // into the shoulders.
      //
      // The control direction has to be stated, not derived. It sweeps from
      // up-and-back over the crown, through sideways at the temples, to
      // down-and-forward under the chin — the same sweep the rim parameter
      // already makes, so it comes straight off `s`.
      const a = s * Math.PI * 2;
      const sa = Math.sin(a); const ca = Math.cos(a);
      let nx = sa * 1.0;
      let ny = ca * 0.84;
      let nz = ca * -0.54;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      // Radius out from the head: widest over the crown, tightest at the throat,
      // which is what gives the cowl its peak.
      const rad = 0.205 + 0.062 * ca;
      const mx = centre[0] + nx * rad;
      const my = centre[1] + ny * rad;
      const mz = centre[2] + nz * rad;

      const it = 1 - t;
      const px = it * it * rim[0] + 2 * it * t * mx + t * t * base[0];
      const py = it * it * rim[1] + 2 * it * t * my + t * t * base[1];
      const pz = it * it * rim[2] + 2 * it * t * mz + t * t * base[2];

      // Occlusion: the inside of a cowl sees almost no sky. It is the single
      // cheapest thing that makes a hood read as deep — and on a drow it is what
      // the eyes are read against.
      const ao = 0.34 + 0.55 * Math.min(1, t * 2.2);
      // UVs in metres: the rim is about a metre round and the sweep from rim to
      // shoulder about 45 cm.
      row.push(B.vert(px, py, pz, s * 1.02, t * 0.45, M_ROBE, ao, B_HOOD, 1, 0, 0));
    }
    if (prevRow) {
      for (let c = 0; c < HOOD_COLS; c++) {
        const c2 = (c + 1) % HOOD_COLS;
        B.quad(prevRow[c], prevRow[c2], row[c2], row[c]);
      }
    }
    prevRow = row;
  }
}
