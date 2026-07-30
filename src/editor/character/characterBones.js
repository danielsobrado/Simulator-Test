/**
 * The skeleton: bone indices, and the bind pose derived from a body profile.
 *
 * Bone convention — a bone's local +Y runs from its own joint toward its child,
 * so a hanging arm has +Y pointing at the floor. Geometry is authored in
 * bind-pose world space and skinned by `world * inverseBind`.
 *
 * The bind pose is *computed*, not tabulated. In the source it was eighteen rows
 * of hand-matched literals in which each joint position had to agree with the
 * previous joint plus its direction times its length; the agreement was real but
 * nothing enforced it, and the geometry builder then repeated the same numbers a
 * third time. Here a joint further down a limb is defined as its parent plus the
 * bone vector, so the table cannot disagree with itself, and one profile change
 * moves the skeleton and the meshes together.
 *
 * With `HUMAN_PROFILE` this reproduces the original table to within a
 * millimetre, which is what `test/character-figure.test.js` pins.
 */

import { DROW_PROFILE } from './DrowFigureProfile.js';

// --------------------------------------------------------------- bone indices
export const B_ROOT = 0;
export const B_SPINE = 1;
export const B_CHEST = 2;
export const B_NECK = 3;
export const B_HEAD = 4;
export const B_HOOD = 5;
export const B_UPPER_L = 6;
export const B_FORE_L = 7;
export const B_HAND_L = 8;
export const B_UPPER_R = 9;
export const B_FORE_R = 10;
export const B_HAND_R = 11;
export const B_THIGH_L = 12;
export const B_SHIN_L = 13;
export const B_FOOT_L = 14;
export const B_THIGH_R = 15;
export const B_SHIN_R = 16;
export const B_FOOT_R = 17;
export const BONE_COUNT = 18;

/** Nine floats per bone: joint position, bone direction, front reference. */
export const BIND_STRIDE = 9;

/**
 * The human measurements the profile multiplies, metres. These are the numbers
 * the source figure was authored at and the only absolute lengths in the system.
 */
const BASE = Object.freeze({
  ankleY: 0.090,
  shinLength: 0.37,
  thighLength: 0.44,
  /** The pelvis rides slightly above the hip joints. */
  pelvisAboveHip: 0.05,
  hipHalfWidth: 0.100,
  spineAbovePelvis: 0.11,
  chestAbovePelvis: 0.31,
  neckAbovePelvis: 0.51,
  headAbovePelvis: 0.60,
  shoulderAbovePelvis: 0.45,
  shoulderHalfWidth: 0.185,
  upperLength: 0.28,
  foreLength: 0.26,
  /** Left-side bone directions; the right side mirrors X. */
  upperDir: Object.freeze([-0.16, -0.987, 0]),
  foreDir: Object.freeze([-0.05, -0.997, 0.06]),
  handDir: Object.freeze([-0.02, -0.992, 0.12]),
});

const FRONT = Object.freeze([0, 0, 1]);
const UP = Object.freeze([0, 1, 0]);

function normalized([x, y, z]) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

function writeBone(bind, bone, px, py, pz, dir, front) {
  const o = bone * BIND_STRIDE;
  bind[o] = px; bind[o + 1] = py; bind[o + 2] = pz;
  bind[o + 3] = dir[0]; bind[o + 4] = dir[1]; bind[o + 5] = dir[2];
  bind[o + 6] = front[0]; bind[o + 7] = front[1]; bind[o + 8] = front[2];
}

/**
 * The rig for a body profile: the bind table, the segment lengths implied by it,
 * and the handful of named heights the geometry builders need to place rings.
 *
 * Segment lengths are returned rather than re-declared as constants because the
 * IK solver needs exactly the lengths the bind table actually has — a solver
 * reaching for 0.44 m on a 0.46 m thigh locks the knee at the top of every
 * stride, which reads as a limp.
 *
 * @param {typeof DROW_PROFILE} [profile]
 */
export function createRig(profile = DROW_PROFILE) {
  const shinLength = BASE.shinLength * profile.legLength;
  const thighLength = BASE.thighLength * profile.legLength;
  const upperLength = BASE.upperLength * profile.armLength;
  const foreLength = BASE.foreLength * profile.armLength;

  const ankleY = BASE.ankleY;
  const kneeY = ankleY + shinLength;
  const hipY = kneeY + thighLength;
  const pelvisY = hipY + BASE.pelvisAboveHip;
  const hipHalfWidth = BASE.hipHalfWidth * profile.hipWidth;

  const above = (metres) => pelvisY + metres * profile.torsoHeight;
  const spineY = above(BASE.spineAbovePelvis);
  const chestY = above(BASE.chestAbovePelvis);
  const neckY = above(BASE.neckAbovePelvis);
  const headY = above(BASE.headAbovePelvis);
  const shoulderY = above(BASE.shoulderAbovePelvis);
  const shoulderHalfWidth = BASE.shoulderHalfWidth * profile.shoulderWidth;

  const upperDir = normalized(BASE.upperDir);
  const foreDir = normalized(BASE.foreDir);
  const handDir = normalized(BASE.handDir);

  const bind = new Float32Array(BONE_COUNT * BIND_STRIDE);

  writeBone(bind, B_ROOT, 0, pelvisY, 0, UP, FRONT);
  writeBone(bind, B_SPINE, 0, spineY, 0, UP, FRONT);
  writeBone(bind, B_CHEST, 0, chestY, 0, UP, FRONT);
  writeBone(bind, B_NECK, 0, neckY, 0, UP, FRONT);
  writeBone(bind, B_HEAD, 0, headY, 0, UP, FRONT);
  // The hood shares the skull's joint and is posed independently — it lags the
  // head by a few frames, which is what makes fabric read as fabric.
  writeBone(bind, B_HOOD, 0, headY, 0, UP, FRONT);

  for (let side = 0; side < 2; side++) {
    const s = side === 0 ? -1 : 1;
    // Mirroring is on X only: the left-side directions above are authored with a
    // negative X, so the right side flips that sign and keeps Y and Z.
    const mirror = (d) => (side === 0 ? d : [-d[0], d[1], d[2]]);
    const up = mirror(upperDir);
    const fo = mirror(foreDir);
    const ha = mirror(handDir);

    const shoulderX = s * shoulderHalfWidth;
    const elbowX = shoulderX + up[0] * upperLength;
    const elbowY = shoulderY + up[1] * upperLength;
    const elbowZ = up[2] * upperLength;
    const wristX = elbowX + fo[0] * foreLength;
    const wristY = elbowY + fo[1] * foreLength;
    const wristZ = elbowZ + fo[2] * foreLength;

    writeBone(bind, side === 0 ? B_UPPER_L : B_UPPER_R, shoulderX, shoulderY, 0, up, FRONT);
    writeBone(bind, side === 0 ? B_FORE_L : B_FORE_R, elbowX, elbowY, elbowZ, fo, FRONT);
    writeBone(bind, side === 0 ? B_HAND_L : B_HAND_R, wristX, wristY, wristZ, ha, FRONT);

    const legX = s * hipHalfWidth;
    writeBone(bind, side === 0 ? B_THIGH_L : B_THIGH_R, legX, hipY, 0, [0, -1, 0], FRONT);
    writeBone(bind, side === 0 ? B_SHIN_L : B_SHIN_R, legX, kneeY, 0, [0, -1, 0], FRONT);
    // The foot's axis is forward, not down, so the boot geometry runs along the
    // foot and swings with the ankle roll instead of being bolted to the shin.
    writeBone(bind, side === 0 ? B_FOOT_L : B_FOOT_R, legX, ankleY, 0, FRONT, UP);
  }

  return Object.freeze({
    profile,
    bind,
    lengths: Object.freeze({
      thigh: thighLength,
      shin: shinLength,
      upper: upperLength,
      fore: foreLength,
      /** Pelvis height above the soles in the bind pose. */
      hipHeight: pelvisY,
    }),
    /** Named heights the geometry builders place rings against. */
    anchors: Object.freeze({
      ankleY,
      kneeY,
      hipY,
      pelvisY,
      spineY,
      chestY,
      neckY,
      headY,
      shoulderY,
      shoulderHalfWidth,
      hipHalfWidth,
    }),
  });
}

/** World-space joint position of a bone in the bind pose. */
export function bindJoint(rig, bone, out = [0, 0, 0]) {
  const o = bone * BIND_STRIDE;
  out[0] = rig.bind[o];
  out[1] = rig.bind[o + 1];
  out[2] = rig.bind[o + 2];
  return out;
}
