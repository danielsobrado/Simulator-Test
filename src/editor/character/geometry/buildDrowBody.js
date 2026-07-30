/**
 * The drow under the garments: head, ears, eyes, scarf, cowl, torso, arms,
 * trousers, boots.
 *
 * Most of this is only seen in slivers — the robe covers the torso, the piwafwi
 * covers the shoulders. What is genuinely on screen is the hood silhouette, the
 * boots, the forearms, and the three things that make this a dark elf rather
 * than a hooded traveller: the ears, the hair line and the eyes. That is where
 * the ring counts go.
 */

import {
  Builder, ring, loft, limbRings, finishGeometry, makeSpineBones,
} from './GeometryBuilder.js';
import { buildDrowHood } from './buildDrowHood.js';
import {
  B_ROOT, B_SPINE, B_CHEST, B_NECK, B_HEAD,
  B_UPPER_L, B_FORE_L, B_HAND_L, B_UPPER_R, B_FORE_R, B_HAND_R,
  B_THIGH_L, B_SHIN_L, B_FOOT_L, B_THIGH_R, B_SHIN_R, B_FOOT_R,
  BIND_STRIDE,
} from '../characterBones.js';
import {
  M_ROBE, M_LEATHER, M_SKIN, M_TRIM, M_EYE,
} from '../materialSlots.js';

const SPINE_BONES = { B_ROOT, B_SPINE, B_CHEST, B_NECK };

function joint(rig, bone) {
  const o = bone * BIND_STRIDE;
  return [rig.bind[o], rig.bind[o + 1], rig.bind[o + 2]];
}

function direction(rig, bone) {
  const o = bone * BIND_STRIDE;
  return [rig.bind[o + 3], rig.bind[o + 4], rig.bind[o + 5]];
}

/**
 * @param {ReturnType<import('../characterBones.js').createRig>} rig
 * @param {ReturnType<import('./drowAnatomy.js').createAnatomy>} anatomy
 */
export function buildDrowBody(rig, anatomy) {
  const B = new Builder();
  const spineBones = makeSpineBones(rig, SPINE_BONES);

  addTorso(B, rig, anatomy, spineBones);
  addBelt(B, anatomy, spineBones);
  addNeck(B, anatomy);
  addSkull(B, anatomy);
  addEars(B, anatomy);
  addEyes(B, anatomy);
  addScarf(B, anatomy);
  buildDrowHood(B, anatomy);
  addArms(B, rig);
  addLegs(B, rig, anatomy);

  return finishGeometry('drow-body', B);
}

// -----------------------------------------------------------------------------
//  Torso
// -----------------------------------------------------------------------------

function addTorso(B, rig, anatomy, spineBones) {
  const { bottomY, topY, rows } = anatomy.torso;
  const scale = rig.profile.torsoRadius;
  const span = topY - bottomY;
  const rings = rows.map(([t, rx, rz]) => {
    const y = bottomY + span * t;
    return ring(0, y, 0, rx * scale, rz * scale, 0.72, spineBones(y));
  });
  loft(B, rings, M_TRIM, [0, 0, 1], true, false);
}

function addBelt(B, anatomy, spineBones) {
  const [a, b, c] = anatomy.belt.ys;
  const rings = [
    ring(0, a, 0, 0.153, 0.124, 0.62, spineBones(a)),
    ring(0, b, 0, 0.160, 0.130, 0.70, spineBones(b)),
    ring(0, c, 0, 0.152, 0.123, 0.62, spineBones(c)),
  ];
  loft(B, rings, M_LEATHER, [0, 0, 1], false, false);
}

// -----------------------------------------------------------------------------
//  Head
// -----------------------------------------------------------------------------

function addNeck(B, anatomy) {
  const [a, b, c] = anatomy.neck.ys;
  const rings = [
    ring(0, a, -0.005, 0.062, 0.058, 0.35, [B_NECK, 1, B_HEAD, 0]),
    ring(0, b, 0.000, 0.058, 0.055, 0.30, [B_NECK, 0.5, B_HEAD, 0.5]),
    ring(0, c, 0.002, 0.062, 0.060, 0.28, [B_HEAD, 1, 0, 0]),
  ];
  loft(B, rings, M_SKIN, [0, 0, 1], false, false);
}

/**
 * The skull.
 *
 * Deliberately featureless apart from the eyes. The face stays in the cowl's
 * shadow, and a half-finished face is far worse than a silhouette — the source
 * figure made that call and it is even more right for a drow, where the read is
 * "two lights in a dark hood". It carries a heavy baked occlusion so the cavity
 * stays dark even when the sun swings round to face it.
 */
function addSkull(B, anatomy) {
  const { centre, radii } = anatomy.head;
  const rings = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    const y = centre[1] - Math.cos(a) * radii[1];
    const r = Math.sin(a);
    rings.push(ring(
      0, y, centre[2] + r * 0.006,
      radii[0] * r + 0.004, radii[2] * r + 0.004,
      0.22, [B_HEAD, 1, 0, 0],
    ));
  }
  loft(B, rings, M_SKIN, [0, 0, 1], true, true);
}

/** Rings across an ear blade: root to tip, thickness and width. */
const EAR_ROWS = Object.freeze([
  // t, half-width (leading to trailing edge), half-thickness
  Object.freeze([0.00, 0.030, 0.011]),
  Object.freeze([0.28, 0.034, 0.010]),
  Object.freeze([0.55, 0.028, 0.008]),
  Object.freeze([0.78, 0.018, 0.006]),
  Object.freeze([1.00, 0.005, 0.003]),
]);

/**
 * Ears.
 *
 * Long, swept back and up, and emerging through the cowl rather than hidden by
 * it — the cowl's rim passes below where these sit, which is the whole reason
 * the hood opening was left as wide as it is.
 *
 * They are blades, not cones: flattened across the head so they catch a rim
 * light along their leading edge. A round taper reads as a horn.
 */
function addEars(B, anatomy) {
  const { centre, radii, scale } = anatomy.head;
  const length = 0.132 * scale;

  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? -1 : 1;
    // Root sits on the skull surface, a little behind the widest point.
    const rootX = centre[0] + s * radii[0] * 0.92;
    const rootY = centre[1] + 0.004;
    const rootZ = centre[2] - radii[2] * 0.16;

    // Out, up and back. The back-sweep is what makes it read as elven rather
    // than as a spike glued to the temple.
    let dx = s * 0.55; let dy = 0.62; let dz = -0.56;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl; dy /= dl; dz /= dl;

    const rings = EAR_ROWS.map(([t, wide, thin]) => ring(
      rootX + dx * length * t,
      rootY + dy * length * t,
      rootZ + dz * length * t,
      wide * scale, thin * scale,
      // Darker toward the root, where the ear sits in the hair and the hood.
      0.30 + 0.34 * t,
      [B_HEAD, 1, 0, 0],
    ));
    // Ref along X: the loft's first section axis then lies in the YZ plane, so
    // `rx` spans the blade's width and `rz` its thickness.
    loft(B, rings, M_SKIN, [1, 0, 0], true, true);
  }
}

/** Almond outline, as (across, up) at eight points around the rim. */
const EYE_RIM = 8;

/**
 * Eyes.
 *
 * Two small emissive almonds on the skull, and the single highest-impact thing
 * in this whole build: the cowl bakes a deep occlusion into everything under it,
 * so a surface that emits instead of reflecting is the only thing in the cavity
 * that reads at all. The bloom pass halates them for free.
 *
 * They are geometry rather than a texture because the head has no UV layout
 * worth speaking of — it is a lofted ellipsoid with UVs in metres of surface.
 */
function addEyes(B, anatomy) {
  const { centre, radii, scale } = anatomy.head;
  const halfWidth = 0.017 * scale;
  const halfHeight = 0.0062 * scale;

  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? -1 : 1;
    // Outward-forward-slightly-up on the skull, then pushed clear of it so the
    // emissive surface is never z-fighting the face it sits on.
    let nx = s * 0.36; let ny = 0.10; let nz = 0.93;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;

    const cx = centre[0] + nx * (radii[0] + 0.0015);
    const cy = centre[1] + ny * (radii[1] + 0.0015);
    const cz = centre[2] + nz * (radii[2] + 0.0015);

    // Frame on the eye's plane: `up` is world up orthogonalised against the
    // outward normal, `across` completes it.
    let ux = -nx * ny; let uy = 1 - ny * ny; let uz = -nz * ny;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const ax = uy * nz - uz * ny;
    const ay = uz * nx - ux * nz;
    const az = ux * ny - uy * nx;

    const centreIndex = B.vert(cx, cy, cz, 0.5, 0.5, M_EYE, 1, B_HEAD, 1, 0, 0);
    const rim = [];
    for (let i = 0; i < EYE_RIM; i++) {
      const a = (i / EYE_RIM) * Math.PI * 2;
      // Canted: a drow eye is drawn with a lift at the outer corner. `across` is
      // outward on the right and inward on the left — the frame flips with the
      // normal — so the sign has to come off the side, not off `across` alone.
      const across = Math.cos(a) * halfWidth;
      const up = Math.sin(a) * halfHeight + across * 0.20 * s;
      rim.push(B.vert(
        cx + ax * across + ux * up,
        cy + ay * across + uy * up,
        cz + az * across + uz * up,
        0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5,
        // The rim falls off so the almond has a soft edge rather than a hard
        // cut-out; the material reads `aux.y` as the emissive mask.
        M_EYE, 0.15,
        B_HEAD, 1, 0, 0,
      ));
    }
    for (let i = 0; i < EYE_RIM; i++) {
      B.tri(centreIndex, rim[i], rim[(i + 1) % EYE_RIM]);
    }
  }
}

/**
 * A scarf across the lower face. It is what stops the shadowed skull reading as
 * an empty hood, and on a drow it carries the house sigil — see the trim mask in
 * `materials/drowFabricNodes.js`.
 */
function addScarf(B, anatomy) {
  const [a, b, c] = anatomy.scarf.ys;
  const scale = anatomy.head.scale;
  const rings = [
    ring(0, a, 0.010, 0.086 * scale, 0.092 * scale, 0.30, [B_HEAD, 1, 0, 0]),
    ring(0, b, 0.012, 0.094 * scale, 0.100 * scale, 0.34, [B_HEAD, 1, 0, 0]),
    ring(0, c, 0.008, 0.092 * scale, 0.098 * scale, 0.30, [B_HEAD, 1, 0, 0]),
  ];
  loft(B, rings, M_TRIM, [0, 0, 1], false, false);
}

// -----------------------------------------------------------------------------
//  Limbs
// -----------------------------------------------------------------------------

/** Hand rings: distance along the hand axis, then the two section radii. */
const HAND_ROWS = Object.freeze([
  Object.freeze([0.000, 0.044, 0.038]),
  Object.freeze([0.046, 0.050, 0.040]),
  Object.freeze([0.087, 0.046, 0.036]),
  Object.freeze([0.115, 0.030, 0.026]),
]);

function addArms(B, rig) {
  const r = rig.profile.limbRadius;

  for (let a = 0; a < 2; a++) {
    const up = a === 0 ? B_UPPER_L : B_UPPER_R;
    const fo = a === 0 ? B_FORE_L : B_FORE_R;
    const hd = a === 0 ? B_HAND_L : B_HAND_R;

    const shoulder = joint(rig, up);
    const elbow = joint(rig, fo);
    const wrist = joint(rig, hd);

    loft(B, limbRings(
      shoulder[0], shoulder[1], shoulder[2], elbow[0], elbow[1], elbow[2],
      0.064 * r, 0.050 * r, 4, up, fo, 0.55, 0.72, 1.0,
    ), M_ROBE, [0, 0, 1], true, false);

    loft(B, limbRings(
      elbow[0], elbow[1], elbow[2], wrist[0], wrist[1], wrist[2],
      0.050 * r, 0.042 * r, 4, fo, hd, 0.62, 0.75, 1.0,
    ), M_ROBE, [0, 0, 1], false, false);

    // The hand is a mitt. Fingers at this distance are three pixels of noise; a
    // clean silhouette reads better and costs nothing.
    const dir = direction(rig, hd);
    const hand = HAND_ROWS.map(([t, rx, rz]) => ring(
      wrist[0] + dir[0] * t, wrist[1] + dir[1] * t, wrist[2] + dir[2] * t,
      rx * r, rz * r, 0.55, [hd, 1, 0, 0],
    ));
    loft(B, hand, M_LEATHER, [0, 0, 1], false, true);
  }
}

/** Shin rows: t from knee to cuff, radius, z offset, ao, weight on the shin. */
const SHIN_ROWS = Object.freeze([
  Object.freeze([0.0000, 0.086, 0.000, 0.55, 1.00]),
  Object.freeze([0.2778, 0.076, 0.004, 0.55, 1.00]),
  Object.freeze([0.5278, 0.070, 0.006, 0.52, 1.00]),
  Object.freeze([0.7222, 0.0755, 0.006, 0.48, 0.60]),
  Object.freeze([0.8889, 0.081, 0.004, 0.44, 0.25]),
  Object.freeze([1.0000, 0.076, 0.000, 0.42, 0.00]),
]);

/** Boot rings: offset below the ankle, z along the foot, and the two radii. */
const BOOT_ROWS = Object.freeze([
  Object.freeze([-0.035, -0.088, 0.046, 0.052, 0.35]),
  Object.freeze([-0.032, -0.050, 0.056, 0.066, 0.38]),
  Object.freeze([-0.036, 0.010, 0.058, 0.060, 0.42]),
  Object.freeze([-0.042, 0.078, 0.056, 0.050, 0.45]),
  Object.freeze([-0.047, 0.142, 0.050, 0.043, 0.48]),
  Object.freeze([-0.050, 0.190, 0.033, 0.031, 0.48]),
]);

function addLegs(B, rig, anatomy) {
  const r = rig.profile.limbRadius;
  const { hipY, kneeY, ankleY, cuffY } = anatomy.leg;
  const shinSpan = kneeY - cuffY;

  for (let l = 0; l < 2; l++) {
    const s = l === 0 ? -1 : 1;
    const th = l === 0 ? B_THIGH_L : B_THIGH_R;
    const sh = l === 0 ? B_SHIN_L : B_SHIN_R;
    const ft = l === 0 ? B_FOOT_L : B_FOOT_R;
    const x = s * rig.anchors.hipHalfWidth;

    loft(B, limbRings(
      x, hipY, 0, x, kneeY, 0,
      0.114 * r, 0.086 * r, 5, th, sh, 0.5, 0.74, 1.0,
    ), M_ROBE, [0, 0, 1], true, false);

    // Trousers narrow to the ankle then flare into the boot shaft.
    const shin = SHIN_ROWS.map(([t, radius, z, ao, wShin]) => ring(
      x, kneeY - shinSpan * t, z, radius * r, radius * r, ao,
      [sh, wShin, ft, 1 - wShin],
    ));
    loft(B, shin, M_ROBE, [0, 0, 1], false, false);

    // The boot runs along the foot's own axis, so it swings with the ankle roll
    // rather than being a block bolted to the shin. Its sole sits at y = 0 in
    // the bind pose, which is what lets `SOLE_SINK` in the figure be a plain
    // offset from the ground rather than a fudge factor.
    const boot = BOOT_ROWS.map(([dy, z, rx, rz, ao]) => ring(
      x, ankleY + dy, z, rx, rz, ao, [ft, 1, 0, 0],
    ));
    loft(B, boot, M_LEATHER, [0, 1, 0], true, true);
  }
}
