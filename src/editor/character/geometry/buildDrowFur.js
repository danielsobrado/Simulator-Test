/**
 * Shell fur — the hood rim and the sleeve cuffs.
 *
 * A trim band is modelled as a partial torus around the edge it decorates: a
 * ring of cross-sections, each an arc of directions pointing away from the
 * garment. That surface is emitted once per shell, each copy pushed further along
 * its own direction, and the fragment shader alpha-tests a hashed strand field
 * whose threshold rises with the shell parameter — so strands taper, end at
 * different lengths, and the band reads as fur rather than as a smooth sausage.
 *
 * Bone-bound rather than cloth-bound, deliberately: the hood rim rides the hood
 * bone and the cuffs ride the forearms, both of which are rigid. Binding shells
 * to a simulated surface would need the shell direction to come out of the cloth
 * solve — a second vertex program, for very little visible gain.
 *
 * That constraint is why the drow's hair is *not* built here. It is a simulated
 * cloth panel instead (see `cloth/drowGarments.js`), shaded with an anisotropic
 * silver streak along its flow rather than as shells. Hair that hangs to the
 * mid-back has to move, and a moving band of twenty-two shells is precisely the
 * case this file says it will not do.
 */

import { Builder, finishGeometry } from './GeometryBuilder.js';
import { B_HOOD, B_FORE_L, B_FORE_R, B_HAND_L, B_HAND_R, BIND_STRIDE } from '../characterBones.js';

/** Shells per fur band. Below about 18 the layering is visible as banding. */
const HOOD_SHELLS = 22;
const CUFF_SHELLS = 18;

/** Cross-section steps across a fur band, and the arc they cover. */
const FUR_ARC_STEPS = 4;
const FUR_ARC = 2.1; // radians, centred on the outward direction

/**
 * @param {ReturnType<import('../characterBones.js').createRig>} rig
 * @param {ReturnType<import('./drowAnatomy.js').createAnatomy>} anatomy
 */
export function buildDrowFur(rig, anatomy) {
  const B = new Builder();
  B.explicitNormals = true;
  const p = [0, 0, 0];
  const { centre, faceDir } = anatomy.head;

  // ---- hood rim ---------------------------------------------------------
  // The band's outward direction is the rim's own bisector: away from the skull,
  // tilted along the face direction so the trim frames the opening.
  const cols = 26;
  const bases = new Float32Array(cols * 3);
  const outs = new Float32Array(cols * 3);
  for (let c = 0; c < cols; c++) {
    anatomy.hood.rimPoint(c / cols, p);
    bases[c * 3] = p[0]; bases[c * 3 + 1] = p[1]; bases[c * 3 + 2] = p[2];
    let dx = p[0] - centre[0]; let dy = p[1] - centre[1]; let dz = p[2] - centre[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx = dx / dl + faceDir[0] * 0.45;
    dy = dy / dl + faceDir[1] * 0.45;
    dz = dz / dl + faceDir[2] * 0.45;
    const l2 = Math.hypot(dx, dy, dz) || 1;
    outs[c * 3] = dx / l2; outs[c * 3 + 1] = dy / l2; outs[c * 3 + 2] = dz / l2;
  }
  emitFurBand(B, cols, bases, outs, 0.024, 0.048, HOOD_SHELLS, B_HOOD, 0.62);

  // ---- cuffs ------------------------------------------------------------
  const r = rig.profile.limbRadius;
  for (let a = 0; a < 2; a++) {
    const bone = a === 0 ? B_FORE_L : B_FORE_R;
    const handBone = a === 0 ? B_HAND_L : B_HAND_R;
    const o = handBone * BIND_STRIDE;
    // The band sits on the sleeve just above the loose cuff rows, where the
    // garment is pinned hard enough that a bone-bound band cannot visibly
    // separate from it. Backing up the hand axis from the wrist puts it there
    // whatever the arm's length ends up being.
    const cx = rig.bind[o] - rig.bind[o + 3] * 0.034;
    const cy = rig.bind[o + 1] - rig.bind[o + 4] * 0.034;
    const cz = rig.bind[o + 2] - rig.bind[o + 5] * 0.034;

    const n = 12;
    const cb = new Float32Array(n * 3);
    const co = new Float32Array(n * 3);
    // The forearm runs almost straight down in the bind pose, so the band's ring
    // sits in the XZ plane around it and its outward is radial.
    for (let c = 0; c < n; c++) {
      const ang = (c / n) * Math.PI * 2;
      const rx = Math.sin(ang); const rz = Math.cos(ang);
      cb[c * 3] = cx + rx * 0.066 * r;
      cb[c * 3 + 1] = cy;
      cb[c * 3 + 2] = cz + rz * 0.064 * r;
      co[c * 3] = rx; co[c * 3 + 1] = 0; co[c * 3 + 2] = rz;
    }
    emitFurBand(B, n, cb, co, 0.015, 0.032, CUFF_SHELLS, bone, 0.52);
  }

  return finishGeometry('drow-fur', B);
}

/**
 * One fur band.
 *
 * @param {Builder} B
 * @param {number} cols positions around the ring
 * @param {Float32Array} bases ring positions, 3 floats each
 * @param {Float32Array} outs unit outward direction per ring position
 * @param {number} r0 radius of the band's core, metres
 * @param {number} len strand length beyond the core, metres
 * @param {number} shells
 * @param {number} bone
 * @param {number} ao
 */
function emitFurBand(B, cols, bases, outs, r0, len, shells, bone, ao) {
  const dir = new Float32Array((cols * (FUR_ARC_STEPS + 1)) * 3);

  // Precompute the cross-section directions once: each is the outward vector
  // rotated about the ring's own tangent.
  for (let c = 0; c < cols; c++) {
    const cn = (c + 1) % cols;
    const cp = (c - 1 + cols) % cols;
    let tx = bases[cn * 3] - bases[cp * 3];
    let ty = bases[cn * 3 + 1] - bases[cp * 3 + 1];
    let tz = bases[cn * 3 + 2] - bases[cp * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;

    const ox = outs[c * 3]; const oy = outs[c * 3 + 1]; const oz = outs[c * 3 + 2];
    // Third axis of the cross-section plane.
    const ax = ty * oz - tz * oy;
    const ay = tz * ox - tx * oz;
    const az = tx * oy - ty * ox;

    for (let k = 0; k <= FUR_ARC_STEPS; k++) {
      const phi = (k / FUR_ARC_STEPS - 0.5) * FUR_ARC;
      const cs = Math.cos(phi); const sn = Math.sin(phi);
      const o = (c * (FUR_ARC_STEPS + 1) + k) * 3;
      dir[o] = ox * cs + ax * sn;
      dir[o + 1] = oy * cs + ay * sn;
      dir[o + 2] = oz * cs + az * sn;
    }
  }

  // Arc length around the ring, so the strand field has a uniform pitch in metres
  // regardless of how big the band is. The shader multiplies this by a density in
  // cells per metre; anything else makes hood fur and cuff fur come out at
  // different scales.
  const arc = new Float32Array(cols + 1);
  for (let c = 1; c <= cols; c++) {
    const a = ((c - 1) % cols) * 3;
    const b = (c % cols) * 3;
    arc[c] = arc[c - 1] + Math.hypot(
      bases[b] - bases[a], bases[b + 1] - bases[a + 1], bases[b + 2] - bases[a + 2],
    );
  }

  const stride = FUR_ARC_STEPS + 1;
  for (let s = 0; s < shells; s++) {
    const t = s / (shells - 1);
    const rowBase = B.pos.length / 3;

    for (let c = 0; c <= cols; c++) {
      const ci = c % cols;
      for (let k = 0; k <= FUR_ARC_STEPS; k++) {
        const o = (ci * stride + k) * 3;
        const dx = dir[o]; const dy = dir[o + 1]; const dz = dir[o + 2];
        const rad = r0 + len * t;
        const across = (k / FUR_ARC_STEPS - 0.5) * FUR_ARC * r0;
        const vi = B.vert(
          bases[ci * 3] + dx * rad,
          bases[ci * 3 + 1] + dy * rad,
          bases[ci * 3 + 2] + dz * rad,
          arc[c], across,
          t, ao, bone, 1, 0, 0,
        );
        B.normal(vi, dx, dy, dz);
      }
    }

    // Shells are independent sheets: each is stitched only to itself, never to
    // its neighbours. That is the whole idea — the gaps between them are where
    // you see through to the shell behind.
    for (let c = 0; c < cols; c++) {
      for (let k = 0; k < FUR_ARC_STEPS; k++) {
        const a = rowBase + c * stride + k;
        B.quad(a, a + 1, a + stride + 1, a + stride);
      }
    }
  }
}
