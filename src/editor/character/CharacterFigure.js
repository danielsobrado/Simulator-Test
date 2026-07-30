/**
 * The figure — bind pose, and the procedural locomotion that poses it.
 *
 * There is no rig file and no animation data. Everything here is solved from the
 * motion state `CharacterMotionState` derives from the player controller. The one
 * thing that buys has to be paid for in exchange: **feet plant rather than
 * slide**.
 *
 * Planting is not approximated. When a foot enters stance its world position is
 * recorded and then held absolutely fixed while the body travels over it; the leg
 * is solved by two-bone IK to reach that fixed point. A foot in this rig cannot
 * slide, because during stance nothing in the code is capable of moving it. The
 * gait phase itself is driven by distance travelled, not by a clock, so stride
 * length and ground speed are the same number by construction.
 *
 * Ported from the source repo's `figure.js`. The snow-surf mode is gone — there
 * is no board in this game — which removes the `surf`/`carve` blends from the
 * attitude, the feet and the arms. What remains is walk, run, idle and cast.
 *
 * Allocation: none per frame. Everything lives in flat arrays sized at
 * construction.
 */

import { setFrameFromDir, invertRigid, mul, xformPoint } from './boneMath.js';
import {
  BONE_COUNT,
  BIND_STRIDE,
  B_ROOT, B_SPINE, B_CHEST, B_NECK, B_HEAD, B_HOOD,
  B_UPPER_L, B_FORE_L, B_HAND_L, B_UPPER_R, B_FORE_R, B_HAND_R,
  B_THIGH_L, B_SHIN_L, B_FOOT_L, B_THIGH_R, B_SHIN_R, B_FOOT_R,
  createRig,
} from './characterBones.js';
import { createGait } from './gait.js';

/**
 * How far the soles settle below the ground sample, metres.
 *
 * The source used a much larger value to sit the figure in snow. Here it does a
 * different job: the ground is a smooth height field and the boot sole is flat,
 * so without a little bite the sole hovers over every ripple it crosses and the
 * contact shadow — the one that says the character is standing on the ground
 * rather than above it — detaches.
 *
 * The boot geometry is authored so its sole is at y = 0 in the bind pose, which
 * is what lets this be a plain offset rather than a fudge factor.
 */
const SOLE_SINK = 0.012;

// ------------------------------------------------------- module-scope scratch
const _axes = new Float32Array(9);
const _p = new Float32Array(3);
const _knee = new Float32Array(3);
const _hip = new Float32Array(3);
const _sh = new Float32Array(3);

/**
 * Compose an orthonormal basis from yaw, then pitch about its own right axis,
 * then roll about its own forward axis. Writes X, Y, Z into `_axes`.
 *
 * Positive pitch leans forward, positive roll tips the figure to its own right —
 * the sign `CharacterMotionState.lean` already uses.
 */
function composeBasis(yaw, pitch, roll) {
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  let xx = cy; let xy = 0; let xz = -sy;
  let yx = 0; let yy = 1; let yz = 0;
  let zx = sy; let zy = 0; let zz = cy;

  if (pitch !== 0) {
    const c = Math.cos(pitch); const s = Math.sin(pitch);
    const nyx = yx * c + zx * s; const nyy = yy * c + zy * s; const nyz = yz * c + zz * s;
    const nzx = zx * c - yx * s; const nzy = zy * c - yy * s; const nzz = zz * c - yz * s;
    yx = nyx; yy = nyy; yz = nyz; zx = nzx; zy = nzy; zz = nzz;
  }
  if (roll !== 0) {
    const c = Math.cos(roll); const s = Math.sin(roll);
    const nxx = xx * c - yx * s; const nxy = xy * c - yy * s; const nxz = xz * c - yz * s;
    const nyx = yx * c + xx * s; const nyy = yy * c + xy * s; const nyz = yz * c + xz * s;
    xx = nxx; xy = nxy; xz = nxz; yx = nyx; yy = nyy; yz = nyz;
  }

  _axes[0] = xx; _axes[1] = xy; _axes[2] = xz;
  _axes[3] = yx; _axes[4] = yy; _axes[5] = yz;
  _axes[6] = zx; _axes[7] = zy; _axes[8] = zz;
}

/**
 * Two-bone IK. Given a root joint, an end target and a pole direction, writes the
 * middle joint's world position into `out`.
 *
 * The target is pulled inside reach rather than clamped at it: a fully extended
 * leg reads as a stiff peg, and the last centimetre of reach is where all the
 * knee-lock artefacts live.
 */
export function solveTwoBone(rx, ry, rz, tx, ty, tz, px, py, pz, l1, l2, out) {
  let dx = tx - rx; let dy = ty - ry; let dz = tz - rz;
  let dist = Math.hypot(dx, dy, dz);
  const maxReach = (l1 + l2) * 0.995;
  if (dist < 1e-4) { dx = 0; dy = -1; dz = 0; dist = 1e-4; }
  if (dist > maxReach) dist = maxReach;
  const inv = 1 / Math.hypot(dx, dy, dz);
  dx *= inv; dy *= inv; dz *= inv;

  // Cosine rule: how far along the root→target axis the middle joint projects.
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));

  // Pole, orthogonalised against the axis — this is what decides which way the
  // knee or elbow bends, and it has to be re-derived every frame because the
  // axis swings through it during a stride.
  const d = px * dx + py * dy + pz * dz;
  let ox = px - dx * d; let oy = py - dy * d; let oz = pz - dz * d;
  let ol = Math.hypot(ox, oy, oz);
  if (ol < 1e-5) { ox = 0; oy = 0; oz = 1; ol = 1; }
  ox /= ol; oy /= ol; oz /= ol;

  out[0] = rx + dx * a + ox * h;
  out[1] = ry + dy * a + oy * h;
  out[2] = rz + dz * a + oz * h;
}

/** Framerate-independent exponential approach. */
function damp(cur, target, rate, dt) {
  return target + (cur - target) * Math.exp(-rate * dt);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CharacterFigure {
  /**
   * @param {{heightAt(x:number, z:number):number}} terrain
   * @param {ReturnType<typeof createRig>} [rig]
   * @param {ReturnType<typeof createGait>} [gait] must be the same object the
   *   motion state advances its phase with
   */
  constructor(terrain, rig = createRig(), gait = createGait({
    legLengthScale: rig.profile.legLength,
  })) {
    this.terrain = terrain;
    this.rig = rig;
    this.gait = gait;

    /** World matrix per bone. */
    this.world = new Float32Array(BONE_COUNT * 16);
    /** Bind-pose world matrix per bone. */
    this.bind = new Float32Array(BONE_COUNT * 16);
    /** Inverse of the above. */
    this.invBind = new Float32Array(BONE_COUNT * 16);
    /** `world * invBind` — the matrix geometry is actually skinned by. */
    this.skin = new Float32Array(BONE_COUNT * 16);

    /** World joint positions. Cloth collision reads these. */
    this.joint = new Float32Array(BONE_COUNT * 3);

    const b = rig.bind;
    for (let i = 0; i < BONE_COUNT; i++) {
      const o = i * BIND_STRIDE;
      setFrameFromDir(
        this.bind, i * 16,
        b[o], b[o + 1], b[o + 2],
        b[o + 3], b[o + 4], b[o + 5],
        b[o + 6], b[o + 7], b[o + 8],
      );
      invertRigid(this.invBind, i * 16, this.bind, i * 16);
    }

    // ------------------------------------------------------------- gait
    /** Where each foot is planted, world. Frozen for the whole stance phase. */
    this.plant = new Float32Array(6);
    /** Live foot position (equals `plant` during stance). */
    this.footPos = new Float32Array(6);
    /** 1 while the foot carries weight, 0 mid-swing. Eased. */
    this.footWeight = new Float32Array([1, 1]);
    this._wasStance = [true, true];
    /** Set for one frame when a foot touches down. Drives footfall events. */
    this.touchdown = [false, false];

    // ------------------------------------------------- smoothed pose state
    this.hipY = rig.lengths.hipHeight;
    this.pitch = 0;
    this.roll = 0;
    this.bob = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.hoodYaw = 0;
    this.hoodPitch = 0;
    /** 0 on the ground, 1 fully airborne. Eased both ways. */
    this.air = 0;

    this._t = 0;
  }

  /**
   * Pose the skeleton for this frame.
   *
   * @param {number} dt
   * @param {import('./CharacterMotionState.js').CharacterMotionState} ch
   */
  update(dt, ch) {
    const h = Math.min(dt, 1 / 30);
    this._t += h;

    const run = this.gait.runFactor(ch.speed);

    // ---------------------------------------------------------- footfalls
    // Stance/swing derives from the same distance-driven phase the motion state
    // uses to fire footfall events, so the visual plant and any effect hung off
    // the footfall are the same instant by construction.
    this._updateFeet(h, ch, run);

    // -------------------------------------------------------- body attitude
    // Lean forward with speed, and *into* acceleration — the classic read that a
    // figure is pushing rather than being dragged. Clamped, because a landing or
    // a hard stop produces accelerations an order of magnitude larger than
    // walking, which unclamped throws the torso far enough back to read as a
    // fall.
    const fwdAcc = ch.accelerationX * Math.sin(ch.facing) + ch.accelerationZ * Math.cos(ch.facing);
    const pitchWant = 0.10 * run + 0.012 * clamp(fwdAcc, -9, 22);
    this.pitch = damp(this.pitch, pitchWant, 7, h);
    this.roll = damp(this.roll, ch.lean * 0.16, 8, h);

    // Vertical bob: the pelvis drops through each stance and rises over the
    // supporting leg, twice per stride.
    const bobWant = -0.028 * run * (0.5 - 0.5 * Math.cos(4 * Math.PI * ch.gaitPhase));
    this.bob = damp(this.bob, bobWant, 18, h);
    this.hipY = damp(this.hipY, this.rig.lengths.hipHeight - 0.035 * run, 9, h);

    // ------------------------------------------------------------- spine
    // The pelvis rides the player's own sole height, not a fresh terrain sample.
    // They agree while walking on ground, and they have to — a second sample
    // would put the figure back on the terrain during a jump, on a wall top or
    // while swimming, all of which the player controller already resolves.
    const gx = ch.x;
    const gz = ch.z;
    const rootY = ch.footY + this.hipY + this.bob;

    composeBasis(ch.facing, this.pitch, this.roll);
    const rX = _axes[0]; const rY = _axes[1]; const rZ = _axes[2];
    const uX = _axes[3]; const uY = _axes[4]; const uZ = _axes[5];
    const fX = _axes[6]; const fY = _axes[7]; const fZ = _axes[8];

    // Pelvis. Its yaw counter-rotates against the shoulders during a stride,
    // which is most of what stops a procedural walk reading as a shop dummy.
    const twist = 0.13 * run * Math.sin(2 * Math.PI * ch.gaitPhase);
    composeBasis(ch.facing + twist, this.pitch, this.roll);
    this._setBone(B_ROOT, gx, rootY, gz, _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]);

    // Spine and chest lift along the pelvis up-axis, with the chest twisting the
    // opposite way and leaning a little further forward.
    const spineUp = this.rig.anchors.spineY - this.rig.anchors.pelvisY;
    const chestUp = this.rig.anchors.chestY - this.rig.anchors.pelvisY;
    const neckUp = this.rig.anchors.neckY - this.rig.anchors.chestY;
    const headUp = this.rig.anchors.headY - this.rig.anchors.neckY;

    this._setBone(
      B_SPINE, gx + uX * spineUp, rootY + uY * spineUp, gz + uZ * spineUp,
      uX, uY, uZ, fX, fY, fZ,
    );

    const chestTwist = -twist * 1.5;
    const chestPitch = this.pitch + 0.05 * run;
    composeBasis(ch.facing + chestTwist, chestPitch, this.roll * 1.15);
    const cUx = _axes[3]; const cUy = _axes[4]; const cUz = _axes[5];
    const cFx = _axes[6]; const cFy = _axes[7]; const cFz = _axes[8];
    const cRx = _axes[0]; const cRy = _axes[1]; const cRz = _axes[2];

    const chestX = gx + uX * chestUp;
    const chestY = rootY + uY * chestUp;
    const chestZ = gz + uZ * chestUp;
    this._setBone(B_CHEST, chestX, chestY, chestZ, cUx, cUy, cUz, cFx, cFy, cFz);

    const neckX = chestX + cUx * neckUp;
    const neckY = chestY + cUy * neckUp;
    const neckZ = chestZ + cUz * neckUp;
    this._setBone(B_NECK, neckX, neckY, neckZ, cUx, cUy, cUz, cFx, cFy, cFz);

    // ------------------------------------------------------------- head
    // Head stabilisation: the head stays much closer to level than the chest it
    // sits on. Real necks do this and it is very obvious when missing.
    this.headPitch = damp(this.headPitch, -chestPitch * 0.62, 9, h);
    this.headYaw = damp(this.headYaw, ch.lean * -0.22, 6, h);
    composeBasis(ch.facing + chestTwist + this.headYaw, chestPitch + this.headPitch, this.roll * 0.5);
    const headX = neckX + cUx * headUp;
    const headY = neckY + cUy * headUp;
    const headZ = neckZ + cUz * headUp;
    this._setBone(B_HEAD, headX, headY, headZ, _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]);

    // The hood is a lagged copy. A hood that tracks the skull exactly reads as a
    // helmet; a few frames of lag reads as fabric.
    this.hoodYaw = damp(this.hoodYaw, ch.facing + chestTwist + this.headYaw, 11, h);
    this.hoodPitch = damp(this.hoodPitch, chestPitch + this.headPitch + 0.05, 9, h);
    composeBasis(this.hoodYaw, this.hoodPitch, this.roll * 0.5);
    this._setBone(B_HOOD, headX, headY, headZ, _axes[3], _axes[4], _axes[5], _axes[6], _axes[7], _axes[8]);

    // -------------------------------------------------------------- limbs
    this._poseArms(ch, run, chestX, chestY, chestZ, cRx, cRy, cRz, cUx, cUy, cUz, cFx, cFy, cFz);
    this._poseLeg(0, gx, rootY, gz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ);
    this._poseLeg(1, gx, rootY, gz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ);

    // ------------------------------------------------------------- skin
    for (let b = 0; b < BONE_COUNT; b++) {
      mul(this.skin, b * 16, this.world, b * 16, this.invBind, b * 16);
      this.joint[b * 3] = this.world[b * 16 + 12];
      this.joint[b * 3 + 1] = this.world[b * 16 + 13];
      this.joint[b * 3 + 2] = this.world[b * 16 + 14];
    }
  }

  _setBone(b, px, py, pz, yx, yy, yz, zx, zy, zz) {
    setFrameFromDir(this.world, b * 16, px, py, pz, yx, yy, yz, zx, zy, zz);
  }

  /**
   * Advance the stance/swing state machine and place both ankles.
   *
   * Stance is the whole point. `plant` is written exactly once, on touchdown, and
   * read unchanged for the rest of the stance — so no amount of body motion,
   * camera motion or frame-rate variation can move a planted foot.
   */
  _updateFeet(h, ch, run) {
    // Duty factor: a walk keeps both feet down for a moment, a run has a flight
    // phase. Interpolating between them makes the walk→run transition read as a
    // gait change and not a speed change.
    const duty = 0.66 - 0.20 * run;

    const fwdX = Math.sin(ch.facing); const fwdZ = Math.cos(ch.facing);
    const rgtX = Math.cos(ch.facing); const rgtZ = -Math.sin(ch.facing);

    // Half a stride ahead — the same function the motion state divides distance
    // by to advance `gaitPhase`, which is what keeps the feet from skating.
    const half = this.gait.strideHalfLength(ch.speed);
    const side = this.rig.anchors.hipHalfWidth + 0.005;
    // The motion state owns this decision. Re-deriving it here is how the feet
    // and the footfall events end up disagreeing about whether we are walking.
    const moving = ch.speed > 0.2 && ch.stepping;

    for (let f = 0; f < 2; f++) {
      const lateral = f === 0 ? -side : side;
      // Left foot leads; the right is half a cycle behind.
      const ph = (ch.gaitPhase + (f === 0 ? 0 : 0.5)) % 1;
      const stance = !moving || ph < duty;

      // Where this foot would land if it touched down right now.
      const nx = ch.x + fwdX * half + rgtX * lateral;
      const nz = ch.z + fwdZ * half + rgtZ * lateral;

      if (stance) {
        if (!this._wasStance[f]) {
          // Touchdown. The only line in this file that writes a plant position.
          this.plant[f * 3] = nx;
          this.plant[f * 3 + 1] = this.terrain.heightAt(nx, nz) - SOLE_SINK;
          this.plant[f * 3 + 2] = nz;
          this.touchdown[f] = true;
        } else {
          this.touchdown[f] = false;
        }
        if (!moving) {
          // Standing: ease the feet back under the hips rather than leaving them
          // wherever the last stride dropped them.
          const sx = ch.x + rgtX * lateral + fwdX * 0.02;
          const sz = ch.z + rgtZ * lateral + fwdZ * 0.02;
          this.plant[f * 3] = damp(this.plant[f * 3], sx, 7, h);
          this.plant[f * 3 + 2] = damp(this.plant[f * 3 + 2], sz, 7, h);
          this.plant[f * 3 + 1] = damp(
            this.plant[f * 3 + 1],
            this.terrain.heightAt(this.plant[f * 3], this.plant[f * 3 + 2]) - SOLE_SINK,
            7, h,
          );
        }
        this.footPos[f * 3] = this.plant[f * 3];
        this.footPos[f * 3 + 1] = this.plant[f * 3 + 1];
        this.footPos[f * 3 + 2] = this.plant[f * 3 + 2];
        this.footWeight[f] = damp(this.footWeight[f], 1, 22, h);
      } else {
        this.touchdown[f] = false;
        // Swing: from the plant it is leaving to the plant it is heading for, on
        // an arc. `nx/nz` keeps updating as the body moves, so the foot is always
        // aimed at where the body will actually be.
        const s = (ph - duty) / (1 - duty);
        const e = s * s * (3 - 2 * s);
        const ny = this.terrain.heightAt(nx, nz) - SOLE_SINK;
        const px = this.plant[f * 3];
        const py = this.plant[f * 3 + 1];
        const pz = this.plant[f * 3 + 2];
        this.footPos[f * 3] = px + (nx - px) * e;
        this.footPos[f * 3 + 2] = pz + (nz - pz) * e;
        this.footPos[f * 3 + 1] = py + (ny - py) * e + Math.sin(Math.PI * s) * (0.055 + 0.12 * run);
        this.footWeight[f] = damp(this.footWeight[f], 0, 22, h);
      }

      this._wasStance[f] = stance;
    }

    // ---- airborne ---------------------------------------------------------
    // The gait means nothing with no ground under it. Draw both feet in under
    // the hips and let the legs hang, staggered so the pose reads as a jump
    // rather than a parade rest. Blended in and out, because a short hop that
    // snapped between the two poses would look like a glitch rather than a jump.
    //
    // The source figure had no jump, so this has no counterpart there; without
    // it a leap leaves both feet welded to the ground and the legs stretch to
    // their reach limit, which is the most conspicuous artefact the port can
    // produce.
    this.air = damp(this.air, ch.grounded ? 0 : 1, 12, h);
    if (this.air > 0.001) {
      for (let f = 0; f < 2; f++) {
        const lateral = f === 0 ? -side : side;
        // Leading leg tucks up and forward, trailing leg hangs back and lower.
        const along = f === 0 ? 0.13 : -0.07;
        const hang = f === 0 ? 0.30 : 0.17;
        const sx = ch.x + rgtX * lateral + fwdX * along;
        const sz = ch.z + rgtZ * lateral + fwdZ * along;
        const sy = ch.footY + hang;
        const o = f * 3;
        this.footPos[o] += (sx - this.footPos[o]) * this.air;
        this.footPos[o + 1] += (sy - this.footPos[o + 1]) * this.air;
        this.footPos[o + 2] += (sz - this.footPos[o + 2]) * this.air;
        this.footWeight[f] = Math.min(this.footWeight[f], 1 - this.air);
      }
    }
  }

  /**
   * Solve one leg. `f` is 0 for left, 1 for right.
   *
   * The knee pole tilts outward as well as forward, because a knee that bends in
   * a perfectly sagittal plane looks mechanical — real legs track slightly wide
   * of the hip.
   */
  _poseLeg(f, rootX, rootY, rootZ, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ) {
    const side = (f === 0 ? -1 : 1) * this.rig.anchors.hipHalfWidth;
    const hipB = f === 0 ? B_THIGH_L : B_THIGH_R;
    const shinB = f === 0 ? B_SHIN_L : B_SHIN_R;
    const footB = f === 0 ? B_FOOT_L : B_FOOT_R;

    // Hip joint, carried by the pelvis frame.
    _hip[0] = rootX + rX * side - uX * 0.05;
    _hip[1] = rootY + rY * side - uY * 0.05;
    _hip[2] = rootZ + rZ * side - uZ * 0.05;

    const ax = this.footPos[f * 3];
    const ay = this.footPos[f * 3 + 1] + this.rig.anchors.ankleY; // ankle above the sole
    const az = this.footPos[f * 3 + 2];

    const outward = f === 0 ? -0.22 : 0.22;
    solveTwoBone(
      _hip[0], _hip[1], _hip[2], ax, ay, az,
      fX + rX * outward, fY + rY * outward, fZ + rZ * outward,
      this.rig.lengths.thigh, this.rig.lengths.shin, _knee,
    );

    this._setBone(
      hipB, _hip[0], _hip[1], _hip[2],
      _knee[0] - _hip[0], _knee[1] - _hip[1], _knee[2] - _hip[2],
      fX, fY, fZ,
    );
    this._setBone(
      shinB, _knee[0], _knee[1], _knee[2],
      ax - _knee[0], ay - _knee[1], az - _knee[2],
      fX, fY, fZ,
    );

    // The foot rolls: flat while loaded, toe-down through the swing.
    const toeDown = (1 - this.footWeight[f]) * 0.55;
    const c = Math.cos(toeDown); const s = Math.sin(toeDown);
    const dx = fX * c - uX * s; const dy = fY * c - uY * s; const dz = fZ * c - uZ * s;
    this._setBone(footB, ax, ay, az, dx, dy, dz, uX, uY, uZ);
  }

  /**
   * Arms. Counter-swing against the legs while walking, blended toward a raised
   * casting stance when a spell is being cast.
   */
  _poseArms(ch, run, cx, cy, cz, rX, rY, rZ, uX, uY, uZ, fX, fY, fZ) {
    const swing = Math.sin(2 * Math.PI * ch.gaitPhase) * (0.20 + 0.42 * run);
    // Slow idle drift so a standing figure is never perfectly still.
    const idle = Math.sin(this._t * 0.9) * 0.02 + Math.sin(this._t * 1.7 + 1.3) * 0.012;
    const shoulderHalf = this.rig.anchors.shoulderHalfWidth;
    const reach = this.rig.lengths.upper + this.rig.lengths.fore;

    for (let a = 0; a < 2; a++) {
      const sgn = a === 0 ? -1 : 1;
      const upperB = a === 0 ? B_UPPER_L : B_UPPER_R;
      const foreB = a === 0 ? B_FORE_L : B_FORE_R;
      const handB = a === 0 ? B_HAND_L : B_HAND_R;

      // Shoulder, on the chest frame.
      const lift = this.rig.anchors.shoulderY - this.rig.anchors.chestY;
      _sh[0] = cx + rX * (sgn * shoulderHalf) + uX * lift;
      _sh[1] = cy + rY * (sgn * shoulderHalf) + uY * lift;
      _sh[2] = cz + rZ * (sgn * shoulderHalf) + uZ * lift;

      // ---- walk target: hand swings fore and aft below the hip --------
      //
      // Every offset is kept comfortably inside the arm's reach. Put the target
      // at or past full extension and the IK solver does exactly what it is told
      // — locks the elbow — and the figure walks around with two straight poles
      // for arms.
      const sw = swing * -sgn;
      const drop = reach * 0.80;
      let tx = _sh[0] + fX * (sw * 0.38) - uX * drop + rX * (sgn * 0.11);
      let ty = _sh[1] + fY * (sw * 0.38) - uY * drop + rY * (sgn * 0.11);
      let tz = _sh[2] + fZ * (sw * 0.38) - uZ * drop + rZ * (sgn * 0.11);
      ty += idle * sgn;

      // ---- cast target: both hands up and out along the aim -----------
      //
      // The leading hand reaches along the aim, the trailing one sits low and
      // inboard, cocked back, so the arms describe the arc the spell is about to
      // take. Blended, not switched, and it composes with the walk swing rather
      // than replacing it — a character casting while walking still walks.
      if (ch.cast > 0.001) {
        const lead = a === 1 ? 1 : 0;
        const outward = lead ? 0.30 : -0.16;
        const along = (lead ? 0.52 : 0.16) * (reach / 0.54);
        const rise = lead ? 0.26 : 0.02;
        const kx = _sh[0] + rX * (sgn * 0.30 + outward * sgn) + ch.castAimX * along + uX * rise;
        const ky = _sh[1] + rY * (sgn * 0.30) + ch.castAimY * along + uY * rise + rise * 0.6;
        const kz = _sh[2] + rZ * (sgn * 0.30 + outward * sgn) + ch.castAimZ * along + uZ * rise;
        tx += (kx - tx) * ch.cast;
        ty += (ky - ty) * ch.cast;
        tz += (kz - tz) * ch.cast;
      }

      // Elbows point back and out.
      const px = -fX + rX * (sgn * 0.55);
      const py = -fY + rY * (sgn * 0.55) - 0.35;
      const pz = -fZ + rZ * (sgn * 0.55);
      solveTwoBone(
        _sh[0], _sh[1], _sh[2], tx, ty, tz, px, py, pz,
        this.rig.lengths.upper, this.rig.lengths.fore, _p,
      );

      this._setBone(
        upperB, _sh[0], _sh[1], _sh[2],
        _p[0] - _sh[0], _p[1] - _sh[1], _p[2] - _sh[2],
        fX, fY, fZ,
      );
      this._setBone(
        foreB, _p[0], _p[1], _p[2],
        tx - _p[0], ty - _p[1], tz - _p[2],
        fX, fY, fZ,
      );
      // The hand continues the forearm.
      let hx = tx - _p[0]; let hy = ty - _p[1]; let hz = tz - _p[2];
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl; hy /= hl; hz /= hl;
      this._setBone(handB, tx, ty, tz, hx, hy, hz, fX, fY, fZ);
    }
  }

  /**
   * Plant both feet under the hips immediately, and drop the smoothed pose.
   *
   * Called when the drow appears somewhere new — a spawn, a teleport, coming
   * back from a hidden view. Without it the plants start at the array's zeroes
   * and the standing branch eases them toward the ground at 7/s, so the first
   * half-second of every spawn has the feet climbing up out of the terrain from
   * the world origin. Damping is the right behaviour for a figure that is
   * already somewhere; it is the wrong behaviour for one that has just arrived.
   */
  resetStance(ch) {
    const fwdX = Math.sin(ch.facing);
    const fwdZ = Math.cos(ch.facing);
    const rgtX = Math.cos(ch.facing);
    const rgtZ = -Math.sin(ch.facing);
    const side = this.rig.anchors.hipHalfWidth + 0.005;

    for (let f = 0; f < 2; f++) {
      const lateral = f === 0 ? -side : side;
      const x = ch.x + rgtX * lateral + fwdX * 0.02;
      const z = ch.z + rgtZ * lateral + fwdZ * 0.02;
      const y = this.terrain.heightAt(x, z) - SOLE_SINK;
      const o = f * 3;
      this.plant[o] = x; this.plant[o + 1] = y; this.plant[o + 2] = z;
      this.footPos[o] = x; this.footPos[o + 1] = y; this.footPos[o + 2] = z;
      this.footWeight[f] = 1;
      this._wasStance[f] = true;
      this.touchdown[f] = false;
    }

    this.hipY = this.rig.lengths.hipHeight;
    this.bob = 0;
    this.pitch = 0;
    this.roll = 0;
    this.air = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.hoodYaw = ch.facing;
    this.hoodPitch = 0;
  }

  /**
   * Rebase after a floating-origin shift.
   *
   * Planted feet are absolute render-space positions held across frames, so a
   * rebase that moved the world under them without moving them would drag both
   * feet to the reach limit on the frame it happened — the one way a plant is
   * allowed to move, and only because the ground moved with it.
   */
  shiftWorld(shiftX, shiftZ) {
    for (let f = 0; f < 2; f++) {
      this.plant[f * 3] -= shiftX;
      this.plant[f * 3 + 2] -= shiftZ;
      this.footPos[f * 3] -= shiftX;
      this.footPos[f * 3 + 2] -= shiftZ;
    }
  }

  /** World position of a hand, for spell emitters. Writes 3 floats to `out`. */
  handPosition(which, out, od = 0) {
    const b = which === 0 ? B_HAND_L : B_HAND_R;
    xformPoint(this.world, b * 16, 0, 0.09, 0, out, od);
  }
}

export { SOLE_SINK };
