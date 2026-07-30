/**
 * The over-the-shoulder camera.
 *
 * Walk mode was first-person only, which meant the drow — cloak, hair, ears and
 * all — was never on screen. This is a second camera for the same player state:
 * it reads the controller's pose and never writes to it, so movement, collision,
 * spell aiming and terrain picking all stay exactly as they were.
 *
 * Two things it has to get right, and both are about not putting the camera
 * somewhere the player cannot see from:
 *
 *   occlusion   The boom shortens when the ground would come between the camera
 *               and the character. Sampled along the boom rather than just at the
 *               end, or walking up to a bank pops the camera through it.
 *   damping     The boom length and the pivot are damped, the *angles* are not.
 *               A damped yaw makes the mouse feel like it is dragging treacle;
 *               a snapping boom makes every step down a slope a jolt.
 */

import * as THREE from 'three';

const DEFAULTS = Object.freeze({
  distance: 3.4,
  /** Pivot height above the player's soles. */
  pivotHeight: 1.45,
  /** Lateral offset, so the character sits off-centre and the view is clear. */
  shoulder: 0.42,
  /** How close the boom may be pulled before the character is simply skipped. */
  minDistance: 0.85,
  /** Keep this much air between the camera and the ground. */
  clearance: 0.38,
  /** Exponential rate, 1/s. */
  damping: 11,
  /** Samples along the boom for the occlusion test. */
  occlusionSamples: 6,
});

function damp(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

export class ThirdPersonCamera {
  /**
   * @param {object} options
   * @param {{ heightAt(x: number, z: number): number }} options.terrain
   * @param {number} options.fovDegrees
   * @param {number} options.farPlane
   * @param {object} [options.config]
   */
  constructor({ terrain, fovDegrees, farPlane, config = {} }) {
    this.terrain = terrain;
    this.settings = { ...DEFAULTS, ...config };
    this.camera = new THREE.PerspectiveCamera(fovDegrees, 1, 0.12, farPlane);
    this.camera.name = 'third-person';
    this.camera.rotation.order = 'YXZ';

    this._pivot = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._boom = this.settings.distance;
    this._initialised = false;
  }

  resize(width, height) {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} dt seconds
   * @param {ReturnType<import('./PlayerController.js').PlayerController['getStatus']>} status
   */
  update(dt, status) {
    const s = this.settings;
    const yaw = status.yaw;
    const pitch = status.pitch;

    const footY = Number.isFinite(status.footY) ? status.footY : status.position.y;
    const targetPivotY = footY + s.pivotHeight;
    if (!this._initialised) {
      this._initialised = true;
      this._pivot.set(status.position.x, targetPivotY, status.position.z);
    } else {
      const h = Math.max(1e-4, Math.min(dt, 1 / 15));
      // X and Z track the player exactly — a damped horizontal pivot lags the
      // character out of frame during a sprint. Only the height is smoothed,
      // which is what takes the jitter out of walking over broken ground.
      this._pivot.x = status.position.x;
      this._pivot.z = status.position.z;
      this._pivot.y = damp(this._pivot.y, targetPivotY, s.damping, h);
    }

    // Camera-forward for a YXZ rotation with -Z as the default facing.
    const cp = Math.cos(pitch);
    this._forward.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));

    const wanted = this._resolveBoom(s);
    const h = Math.max(1e-4, Math.min(dt, 1 / 15));
    // Shortening is immediate, lengthening is eased: a boom that eases *into* an
    // obstruction has already put the camera inside the hillside by the time it
    // arrives.
    this._boom = wanted < this._boom ? wanted : damp(this._boom, wanted, s.damping, h);

    this._desired.copy(this._pivot)
      .addScaledVector(this._forward, -this._boom)
      .addScaledVector(this._right, s.shoulder * (this._boom / s.distance));

    // Last resort: never end up under the ground, however the boom resolved.
    const ground = this.terrain.heightAt(this._desired.x, this._desired.z) + s.clearance;
    if (this._desired.y < ground) this._desired.y = ground;

    this.camera.position.copy(this._desired);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /** How far the boom can extend before the ground gets in the way. */
  _resolveBoom(s) {
    const full = s.distance;
    const steps = s.occlusionSamples;
    for (let i = steps; i >= 1; i--) {
      const t = (i / steps) * full;
      const x = this._pivot.x - this._forward.x * t;
      const y = this._pivot.y - this._forward.y * t;
      const z = this._pivot.z - this._forward.z * t;
      if (y >= this.terrain.heightAt(x, z) + s.clearance) {
        return Math.max(s.minDistance, t);
      }
    }
    return s.minDistance;
  }

  shiftWorld(shiftX, shiftZ) {
    this._pivot.x -= shiftX;
    this._pivot.z -= shiftZ;
    this.camera.position.x -= shiftX;
    this.camera.position.z -= shiftZ;
    this.camera.updateMatrixWorld();
  }

  /** Forget the smoothed state, so a teleport does not fly the camera there. */
  reset() {
    this._initialised = false;
    this._boom = this.settings.distance;
  }
}

export { DEFAULTS as THIRD_PERSON_DEFAULTS };
