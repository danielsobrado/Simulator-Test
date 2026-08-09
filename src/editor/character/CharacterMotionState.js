/**
 * Player status → figure motion state.
 *
 * The source repo shipped its own locomotion controller and the figure read it
 * directly. We already have one — `PlayerController` plus `PlayerPhysics` own
 * movement, collision, jumping, stepping and the whole water/swimming state
 * machine — so the controller was dropped and this adapter took its place. It
 * derives only what the figure needs and cannot itself move the player.
 *
 * Two things are computed here rather than read, because `PlayerController`
 * does not publish them:
 *
 *   speed / acceleration   differentiated from the published position. Cheaper
 *                          and less invasive than widening the status object,
 *                          and it stays correct if physics changes how it
 *                          integrates.
 *   gaitPhase              accumulated *distance*, never time. This is the
 *                          property the whole no-sliding-feet design rests on:
 *                          phase and ground speed are the same number, so a
 *                          frame-rate change cannot desynchronise the stride
 *                          from the travel.
 *
 * Allocation: none per update.
 */

import { isSwimmingWaterState } from '../player/PlayerWaterState.js';
import { angleDamp, createGait } from './gait.js';

/** Below this the figure is standing, whatever the input says. */
const STEP_SPEED = 0.2;

/** Speed differentiation is noisy at a single frame; smooth it this hard. */
const SPEED_DAMP = 14;
const ACCEL_DAMP = 9;

/**
 * A rebase moves the world by a chunk, which differentiates into an absurd
 * speed. Anything past this in one frame is a teleport or a rebase, not motion.
 */
const TELEPORT_METRES = 8;

function damp(cur, target, rate, dt) {
  return target + (cur - target) * Math.exp(-rate * dt);
}

export class CharacterMotionState {
  /**
   * @param {ReturnType<typeof createGait>} [gait] must be the same object the
   *   figure places its footfalls with
   */
  constructor(gait = createGait()) {
    this.gait = gait;

    // ---- what the figure reads ------------------------------------------
    this.x = 0;
    this.z = 0;
    this.footY = 0;
    this.grounded = true;
    /** Body heading. `(sin facing, cos facing)` is forward, per the figure. */
    this.facing = 0;
    this.speed = 0;
    /** 0 at a standstill, 1 at a full run. */
    this.speed01 = 0;
    this.accelerationX = 0;
    this.accelerationZ = 0;
    this.gaitPhase = 0;
    this.stepping = false;
    /** Signed turn rate, roughly -1..1. Drives body roll and head yaw. */
    this.lean = 0;
    /** 0 to 1 blend into the casting stance. */
    this.cast = 0;
    this.castAimX = 0;
    this.castAimY = 0;
    this.castAimZ = 1;

    this._initialised = false;
    this._prevX = 0;
    this._prevZ = 0;
    this._velX = 0;
    this._velZ = 0;
    this._prevVelX = 0;
    this._prevVelZ = 0;
    this._prevFacing = 0;
    this._castUntil = 0;
    this._castNow = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {ReturnType<import('../player/PlayerController.js').PlayerController['getStatus']>} status
   * @param {number} nowMs
   */
  update(dt, status, nowMs) {
    const px = status.position.x;
    const pz = status.position.z;
    this.footY = Number.isFinite(status.footY) ? status.footY : status.position.y;
    this.grounded = status.grounded === true;

    if (!this._initialised) {
      this._initialised = true;
      this._prevX = px;
      this._prevZ = pz;
      // Camera-forward is -Z at yaw 0; the figure's forward is +Z. Half a turn
      // between the two conventions, and getting it wrong makes the character
      // moonwalk, which is exactly as obvious as it sounds.
      this.facing = status.yaw + Math.PI;
      this._prevFacing = this.facing;
    }

    const h = Math.max(1e-4, Math.min(dt, 1 / 15));
    const dx = px - this._prevX;
    const dz = pz - this._prevZ;
    const stepDistance = Math.hypot(dx, dz);

    if (stepDistance > TELEPORT_METRES) {
      // Teleport or an un-shifted rebase: adopt the new position without
      // differentiating the discontinuity into a fake sprint or acceleration.
      this._velX = 0;
      this._velZ = 0;
      this._prevVelX = 0;
      this._prevVelZ = 0;
      this.speed = 0;
      this.accelerationX = 0;
      this.accelerationZ = 0;
    } else {
      this._velX = damp(this._velX, dx / h, SPEED_DAMP, h);
      this._velZ = damp(this._velZ, dz / h, SPEED_DAMP, h);
      // Acceleration of the velocity vector, smoothed. Only its component along
      // the facing is used, to lean the torso into a push or a stop.
      this.accelerationX = damp(this.accelerationX, (this._velX - this._prevVelX) / h, ACCEL_DAMP, h);
      this.accelerationZ = damp(this.accelerationZ, (this._velZ - this._prevVelZ) / h, ACCEL_DAMP, h);
      this._prevVelX = this._velX;
      this._prevVelZ = this._velZ;
      this.speed = Math.hypot(this._velX, this._velZ);
    }

    this._prevX = px;
    this._prevZ = pz;
    this.x = px;
    this.z = pz;
    this.speed01 = this.gait.runFactor(this.speed);

    // ---- facing ---------------------------------------------------------
    // Face the way we are travelling while moving, and the way the camera looks
    // while standing. Turning on the spot then still turns the body, and
    // strafing does not leave the figure walking sideways with a fixed stare.
    const cameraFacing = status.yaw + Math.PI;
    const wantFacing = this.speed > STEP_SPEED
      ? Math.atan2(this._velX, this._velZ)
      : cameraFacing;
    this._prevFacing = this.facing;
    this.facing = angleDamp(this.facing, wantFacing, 9, h);

    // Turn rate, normalised to something the roll and head-yaw terms can scale.
    const turn = (this.facing - this._prevFacing) / h;
    this.lean = damp(this.lean, Math.max(-1, Math.min(1, turn * 0.45 * this.speed01)), 8, h);

    // ---- gait -----------------------------------------------------------
    this.stepping = this.grounded
      && this.speed > STEP_SPEED
      && !isSwimmingWaterState(status.waterState);
    if (this.stepping) {
      const stride = 2 * this.gait.strideHalfLength(this.speed);
      this.gaitPhase = (this.gaitPhase + Math.min(stepDistance, stride) / stride) % 1;
    }

    // ---- cast -----------------------------------------------------------
    const casting = nowMs < this._castUntil;
    this._castNow = damp(this._castNow, casting ? 1 : 0, casting ? 16 : 6, h);
    this.cast = this._castNow;
  }

  /**
   * Raise the arms into a cast for `durationMs`, aiming along `direction`.
   *
   * Called from the spell runtime rather than sampled from it, so the pose
   * starts on the same frame the effect does. The aim is a unit vector in render
   * space — normally the camera's forward at the moment of the cast.
   */
  beginCast(durationMs, direction, nowMs) {
    this._castUntil = nowMs + Math.max(0, durationMs);
    if (direction) {
      const l = Math.hypot(direction.x, direction.y, direction.z) || 1;
      this.castAimX = direction.x / l;
      this.castAimY = direction.y / l;
      this.castAimZ = direction.z / l;
    }
  }

  /** Rebase after a floating-origin shift; see `CharacterFigure.shiftWorld`. */
  shiftWorld(shiftX, shiftZ) {
    this.x -= shiftX;
    this.z -= shiftZ;
    this._prevX -= shiftX;
    this._prevZ -= shiftZ;
  }

  /** Drop differentiated state after a teleport so the figure does not lurch. */
  reset(status) {
    this._initialised = false;
    this._velX = 0;
    this._velZ = 0;
    this._prevVelX = 0;
    this._prevVelZ = 0;
    this.speed = 0;
    this.speed01 = 0;
    this.accelerationX = 0;
    this.accelerationZ = 0;
    this.lean = 0;
    this.stepping = false;
    if (status) {
      this.x = status.position.x;
      this.z = status.position.z;
    }
  }
}
