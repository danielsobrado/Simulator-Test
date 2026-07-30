/**
 * The drow's garments, as simulated panels.
 *
 * Four came across from the source — robe, mantle, two sleeves — and one is new:
 * the hair. Everything is authored in bind-pose world space against the rig's
 * anchors, never against absolute heights, so the taller drow's hem still clears
 * its own boots.
 */

import { ClothPanel, C_TORSO, C_LEGS, C_ARM_L, C_ARM_R } from './ClothPanel.js';
import {
  B_ROOT, B_CHEST, B_HEAD,
  B_UPPER_L, B_FORE_L, B_HAND_L, B_UPPER_R, B_FORE_R, B_HAND_R,
  BIND_STRIDE,
} from '../characterBones.js';
import { M_ROBE, M_MANTLE, M_FUR } from '../materialSlots.js';

/** Piecewise-linear lookup over a table of `[t, a, b]` control points. */
function curve(table, t) {
  let i = 0;
  while (i < table.length - 2 && t > table[i + 1][0]) i++;
  const a = table[i]; const b = table[i + 1];
  const s = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 0;
  const k = Math.min(1, Math.max(0, s));
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function joint(rig, bone) {
  const o = bone * BIND_STRIDE;
  return [rig.bind[o], rig.bind[o + 1], rig.bind[o + 2]];
}

/**
 * The robe: a long tube from the waist, flaring to a hem that is cut high at the
 * front so the boots read, and trails behind. The asymmetry is what makes the
 * silhouette move when the figure turns.
 */
function makeRobe(rig, anatomy) {
  const p = new ClothPanel({
    // Thirty-six columns is set by the fold count, not by smoothness: nine
    // pleats need four samples each to survive the grid at all, and the
    // Catmull-Rom reconstruction turns four samples per fold into a clean wave.
    // Twenty columns aliased them into a wobble.
    name: 'robe', cols: 36, rows: 12, matId: M_ROBE,
    renderCols: 72, renderRows: 32,
    // Metres of surface, so the shader's weave and slub scales are physical.
    weaveU: 1.75, weaveV: 1.05,
    aoTop: 0.55, aoBottom: 0.42,
    collide: C_TORSO | C_LEGS, groundRows: 2,
  });

  const RATE = [Infinity, 30, 10, 4, 1.6, 0.9, 0.55, 0.4, 0.35, 0.3, 0.3, 0.3];
  const waistY = rig.anchors.pelvisY + 0.040;
  const hemBase = anatomy.leg.kneeY - 0.160;
  const slim = rig.profile.torsoRadius;

  for (let j = 0; j < p.rows; j++) {
    const v = j / (p.rows - 1);
    for (let i = 0; i < p.cols; i++) {
      const a = (i / p.cols) * Math.PI * 2;
      const sa = Math.sin(a); const ca = Math.cos(a);
      // The flare accelerates downward, and the back flares furthest — that
      // extra fabric is what becomes the train.
      const f = v ** 1.25;

      // Pleats. A garment cut as a smooth cone stays a smooth cone: the solver
      // has nothing to break the symmetry with, and a robe with no vertical
      // folds reads as a traffic cone no matter how good the shading is. Putting
      // the folds in the *rest shape* means the constraints preserve them, they
      // deepen toward the hem where the fabric is loose, and they travel with
      // the garment rather than sliding across it the way a normal map would.
      //
      // Three incommensurate frequencies, so no two folds are alike and the
      // pattern never repeats around the tube.
      const fold = 0.118 * Math.sin(a * 7 + 0.6)
        + 0.055 * Math.sin(a * 12 + 2.1)
        + 0.026 * Math.sin(a * 19 + 4.4);
      const pleat = 1 + f * fold;

      // ca = +1 at the front, -1 at the back. The hem hangs *lowest* at the
      // crest of a fold, where there is most fabric to hang — in phase with the
      // pleat it produced a row of hard spikes instead.
      //
      // Cut high at the front and long at the back. Ankle length all the way
      // round hides the boots, and with the boots hidden the entire
      // foot-planting solve is invisible.
      const hemY = hemBase + 0.200 * ca - 0.048 * Math.sin(a * 7 + 0.6);
      const y = waistY + (hemY - waistY) * v;

      // The waist is the drow's slim waist; the hem is fabric and keeps its
      // fullness, or a slimmer body would come with a meaner robe.
      const slimAtV = slim + (1 - slim) * f;
      const rx = (0.158 + (0.345 - 0.158) * f) * pleat * slimAtV;
      const rz = (0.128 + (0.318 - 0.128) * f * (1 - 0.12 * ca)) * pleat * slimAtV;

      const o = (j * p.cols + i) * 3;
      p.bindPos[o] = rx * sa;
      p.bindPos[o + 1] = y;
      p.bindPos[o + 2] = rz * ca - 0.010 * v;
      p.bone[j * p.cols + i] = B_ROOT;
      p.pinRate[j * p.cols + i] = RATE[j];
    }
  }
  return p.finalise();
}

/**
 * The piwafwi: a short cape that clears the shoulders and falls to the small of
 * the back. Its job is to break the vertical line of the robe and to catch light
 * on the shoulders, which is the read that says "layered" from fifteen metres.
 *
 * Kept deliberately short. A drow cloak that reaches the ankles is more correct
 * to the source material and much worse to look at — long enough to cover the
 * forearms and it swallows the sleeves, the fur cuffs and the whole silhouette
 * into one dark mass. The violet sheen in `DrowPalette` carries the piwafwi read
 * instead of the length.
 */
function makeMantle(rig, anatomy) {
  const p = new ClothPanel({
    name: 'piwafwi', cols: 28, rows: 7, matId: M_MANTLE,
    renderCols: 64, renderRows: 22,
    weaveU: 1.35, weaveV: 0.72,
    aoTop: 0.85, aoBottom: 0.6,
    collide: C_TORSO | C_ARM_L | C_ARM_R,
  });

  const RATE = [Infinity, 40, 12, 4, 1.5, 0.8, 0.45];
  // The collar has to clear the torso it sits on: start it inside the shoulders
  // and the top of the mantle only emerges at the shoulder line, which reads as
  // a flat plate bolted to the chest.
  const RAD = [
    [0.00, 0.176, 0.148],
    [0.20, 0.222, 0.176],
    [0.55, 0.235, 0.196],
    [1.00, 0.246, 0.214],
  ];
  const { chestY, neckY, pelvisY } = rig.anchors;
  const YT = [
    [0.00, neckY - 0.018, 0],
    [0.20, anatomy.hood.baseY, 0],
    [0.55, chestY - 0.040, 0],
    [1.00, 0, 0], // filled per column below
  ];

  for (let j = 0; j < p.rows; j++) {
    const v = j / (p.rows - 1);
    const [rx, rz] = curve(RAD, v);
    for (let i = 0; i < p.cols; i++) {
      const a = (i / p.cols) * Math.PI * 2;
      const sa = Math.sin(a); const ca = Math.cos(a);
      // Front hangs shorter than the back, and the edge scallops with the folds
      // rather than cutting a clean arc.
      YT[3][1] = pelvisY + 0.095 + 0.115 * ca + 0.035 * Math.sin(a * 7 + 1.4);
      const y = curve(YT, v)[0];
      const pleat = 1 + v * (0.062 * Math.sin(a * 7 + 1.4) + 0.026 * Math.sin(a * 11 + 3.0));

      const o = (j * p.cols + i) * 3;
      p.bindPos[o] = rx * sa * pleat;
      p.bindPos[o + 1] = y;
      p.bindPos[o + 2] = rz * ca * pleat - 0.012;
      p.bone[j * p.cols + i] = B_CHEST;
      p.pinRate[j * p.cols + i] = RATE[j];
    }
  }
  return p.finalise();
}

/**
 * A sleeve. Pinned tightly along the arm and genuinely loose only past the wrist,
 * where the cuff drapes. A fully free sleeve looks wonderful for about four
 * seconds and then slides off the elbow.
 */
function makeSleeve(rig, side) {
  const p = new ClothPanel({
    name: `sleeve${side}`, cols: 10, rows: 8, matId: M_ROBE,
    renderCols: 26, renderRows: 20,
    weaveU: 0.46, weaveV: 0.66,
    aoTop: 0.6, aoBottom: 0.5,
    collide: side === 0 ? C_ARM_L : C_ARM_R,
  });

  const upperBone = side === 0 ? B_UPPER_L : B_UPPER_R;
  const foreBone = side === 0 ? B_FORE_L : B_FORE_R;
  const handBone = side === 0 ? B_HAND_L : B_HAND_R;
  const UP = joint(rig, upperBone);
  const EL = joint(rig, foreBone);
  const WR = joint(rig, handBone);

  // Beyond the wrist, continuing the forearm's direction.
  let dx = WR[0] - EL[0]; let dy = WR[1] - EL[1]; let dz = WR[2] - EL[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;

  // (segment, t, radius) per row. Segment 0 = upper arm, 1 = forearm,
  // 2 = past the wrist.
  const ROWS = [
    [0, 0.00, 0.084], [0, 0.45, 0.076], [0, 1.00, 0.072],
    [1, 0.40, 0.068], [1, 0.75, 0.064], [1, 1.00, 0.061],
    [2, 0.045, 0.072], [2, 0.125, 0.098],
  ];
  const BONES = [
    upperBone, upperBone, upperBone,
    foreBone, foreBone, foreBone, foreBone, handBone,
  ];
  const RATE = [Infinity, 50, 26, 40, 18, 9, 5, 1.2];
  const slim = rig.profile.limbRadius;

  for (let j = 0; j < p.rows; j++) {
    const [seg, t, r] = ROWS[j];
    let cx; let cy; let cz;
    if (seg === 0) {
      cx = UP[0] + (EL[0] - UP[0]) * t;
      cy = UP[1] + (EL[1] - UP[1]) * t;
      cz = UP[2] + (EL[2] - UP[2]) * t;
    } else if (seg === 1) {
      cx = EL[0] + (WR[0] - EL[0]) * t;
      cy = EL[1] + (WR[1] - EL[1]) * t;
      cz = EL[2] + (WR[2] - EL[2]) * t;
    } else {
      cx = WR[0] + dx * t; cy = WR[1] + dy * t; cz = WR[2] + dz * t;
    }
    const radius = r * slim;
    for (let i = 0; i < p.cols; i++) {
      const a = (i / p.cols) * Math.PI * 2;
      const o = (j * p.cols + i) * 3;
      // The arm is near-vertical in the bind pose, so the ring lies in XZ.
      p.bindPos[o] = cx + Math.sin(a) * radius;
      p.bindPos[o + 1] = cy;
      p.bindPos[o + 2] = cz + Math.cos(a) * radius;
      p.bone[j * p.cols + i] = BONES[j];
      p.pinRate[j * p.cols + i] = RATE[j];
    }
  }
  return p.finalise();
}

/**
 * The hair.
 *
 * A drow's white hair is the loudest cue on the whole figure, and it has to move
 * or it reads as a moulded helmet. So it is a garment: the same verlet solve as
 * the robe, which buys gust, sway and the whip of a hard turn for nothing beyond
 * two hundred more particles.
 *
 * Not shell fur, deliberately — see the note at the top of `buildDrowFur.js`.
 * It is shaded as an anisotropic silver sheet with the streak running along V,
 * which is how hair cards have been shaded for twenty years and is far cheaper
 * than hanging twenty-two shells off a simulated grid.
 *
 * Cut as a closed tube like every other panel, with the length driven off the
 * angle: a hairline at the front where the scarf and cowl cover it, falling to
 * the mid-back behind. Same trick the robe's hem uses.
 */
function makeHair(rig, anatomy) {
  const p = new ClothPanel({
    name: 'hair', cols: 20, rows: 10, matId: M_FUR,
    renderCols: 40, renderRows: 24,
    weaveU: 0.9, weaveV: 0.55,
    // Dark at the crown, where it is under the cowl; bright at the tips, which
    // are the part that actually catches a low sun.
    aoTop: 0.40, aoBottom: 0.85,
    collide: C_TORSO,
  });

  const RATE = [Infinity, 45, 14, 5, 2.2, 1.2, 0.7, 0.5, 0.4, 0.35];
  // The upper rows grow out of the skull; the lower ones rest against the back,
  // so a head turn swings the fall without dragging the ends round with it.
  const BONE = [B_HEAD, B_HEAD, B_HEAD, B_HEAD, B_CHEST, B_CHEST, B_CHEST, B_CHEST, B_CHEST, B_CHEST];

  const { centre, radii } = anatomy.head;
  const crownY = centre[1] + 0.012;

  for (let j = 0; j < p.rows; j++) {
    const v = j / (p.rows - 1);
    for (let i = 0; i < p.cols; i++) {
      const a = (i / p.cols) * Math.PI * 2;
      const sa = Math.sin(a); const ca = Math.cos(a);
      // 0 at the face, 1 at the back of the skull.
      const back = 0.5 - 0.5 * ca;
      // A hairline at the front, mid-back behind.
      const length = 0.025 + 0.400 * back;
      // Sits just clear of the skull, and falls away from the neck as it drops.
      const out = 1.02 + back * 0.22 * v;

      const o = (j * p.cols + i) * 3;
      p.bindPos[o] = sa * radii[0] * out;
      p.bindPos[o + 1] = crownY - length * v;
      p.bindPos[o + 2] = centre[2] + ca * radii[2] * out - 0.012 * back * v;
      p.bone[j * p.cols + i] = BONE[j];
      p.pinRate[j * p.cols + i] = RATE[j];
    }
  }
  return p.finalise();
}

/**
 * @param {ReturnType<import('../characterBones.js').createRig>} rig
 * @param {ReturnType<import('../geometry/drowAnatomy.js').createAnatomy>} anatomy
 */
export function makeDrowPanels(rig, anatomy) {
  return [
    makeRobe(rig, anatomy),
    makeMantle(rig, anatomy),
    makeSleeve(rig, 0),
    makeSleeve(rig, 1),
    makeHair(rig, anatomy),
  ];
}
