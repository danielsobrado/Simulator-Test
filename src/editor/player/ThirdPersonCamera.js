/**
 * The over-the-shoulder camera.
 *
 * Walk mode was first-person only, which meant the drow — cloak, hair, ears and
 * all — was never on screen. This is a second camera for the same player state:
 * it reads the controller's pose and never writes to it, so movement, collision,
 * spell aiming and terrain picking all stay exactly as they were.
 *
 * The boom shortens when terrain would cross the actual shoulder-offset camera
 * path. Rotation stays immediate while boom length and pivot height are damped,
 * keeping mouse input responsive without making broken ground feel jittery.
 */

import * as THREE from 'three';

const MAX_OCCLUSION_SAMPLES = 64;
const OCCLUSION_REFINEMENT_STEPS = 3;

const DEFAULTS = Object.freeze({
  distance: 3.4,
  /** Pivot height above the player's soles. */
  pivotHeight: 1.45,
  /** Lateral offset, so the character sits off-centre and the view is clear. */
  shoulder: 0.42,
  /** Hard floor for the boom when terrain closes in. */
  minDistance: 0.85,
  /** Keep this much air between the camera and the ground. */
  clearance: 0.38,
  /** Exponential rate, 1/s. */
  damping: 11,
  /** Samples along the boom for the occlusion test. */
  occlusionSamples: 8,
});

function assertPositive(settings, name) {
  if (!Number.isFinite(settings[name]) || settings[name] <= 0) {
    throw new Error(`Third-person camera ${name} must be positive.`);
  }
}

export function createThirdPersonCameraSettings(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Third-person camera config must be an object.');
  }
  const settings = { ...DEFAULTS, ...config };
  for (const name of ['distance', 'pivotHeight', 'minDistance', 'clearance', 'damping']) {
    assertPositive(settings, name);
  }
  if (!Number.isFinite(settings.shoulder)) {
    throw new Error('Third-person camera shoulder must be finite.');
  }
  if (!Number.isInteger(settings.occlusionSamples)
      || settings.occlusionSamples < 1
      || settings.occlusionSamples > MAX_OCCLUSION_SAMPLES) {
    throw new Error(
      `Third-person camera occlusionSamples must be an integer from 1 to ${MAX_OCCLUSION_SAMPLES}.`,
    );
  }
  if (settings.minDistance > settings.distance) {
    throw new Error('Third-person camera minDistance must not exceed distance.');
  }
  return Object.freeze(settings);
}

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
    this.settings = createThirdPersonCameraSettings(config);
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
    // Shortening is immediate, lengthening is eased: easing into an obstruction
    // puts the camera inside it before the boom catches up.
    this._boom = wanted < this._boom ? wanted : damp(this._boom, wanted, s.damping, h);

    this._desired.copy(this._pivot)
      .addScaledVector(this._forward, -this._boom)
      .addScaledVector(this._right, s.shoulder * (this._boom / s.distance));

    const ground = this.terrain.heightAt(this._desired.x, this._desired.z);
    if (Number.isFinite(ground)) {
      const minimumY = ground + s.clearance;
      if (this._desired.y < minimumY) this._desired.y = minimumY;
    }

    this.camera.position.copy(this._desired);
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /** How far the boom can extend before terrain crosses its camera path. */
  _resolveBoom(s) {
    const min = s.minDistance;
    const full = s.distance;
    if (!this._isBoomPointClear(min, s)) return min;

    let safe = min;
    const span = full - min;
    for (let i = 1; i <= s.occlusionSamples; i += 1) {
      const distance = min + span * (i / s.occlusionSamples);
      if (this._isBoomPointClear(distance, s)) {
        safe = distance;
        continue;
      }

      let low = safe;
      let high = distance;
      for (let refinement = 0; refinement < OCCLUSION_REFINEMENT_STEPS; refinement += 1) {
        const middle = (low + high) * 0.5;
        if (this._isBoomPointClear(middle, s)) low = middle;
        else high = middle;
      }
      return low;
    }
    return full;
  }

  _isBoomPointClear(distance, s) {
    const ratio = distance / s.distance;
    const shoulder = s.shoulder * ratio;
    const x = this._pivot.x - this._forward.x * distance + this._right.x * shoulder;
    const y = this._pivot.y - this._forward.y * distance;
    const z = this._pivot.z - this._forward.z * distance + this._right.z * shoulder;
    const ground = this.terrain.heightAt(x, z);
    return Number.isFinite(ground) && y >= ground + s.clearance;
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

export {
  DEFAULTS as THIRD_PERSON_DEFAULTS,
  MAX_OCCLUSION_SAMPLES as THIRD_PERSON_MAX_OCCLUSION_SAMPLES,
};
