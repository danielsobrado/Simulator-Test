import * as THREE from 'three';
import { createPlayerState, stepPlayerPhysics } from './PlayerPhysics.js';

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ShiftLeft',
  'ShiftRight',
  'Space',
]);

export class PlayerController {
  constructor({ canvas, terrainView, config, farPlane = 5000 }) {
    this.canvas = canvas;
    this.terrainView = terrainView;
    this.config = config;
    this.camera = new THREE.PerspectiveCamera(config.fovDegrees, 1, 0.5, farPlane);
    this.camera.rotation.order = 'YXZ';
    this.state = createPlayerState({
      x: 0,
      z: 0,
      groundHeight: terrainView.getWorldHeight(0, 0),
      eyeHeight: config.eyeHeight,
    });
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = false;
    this.harnessActive = false;
    this.uiBlocked = false;
    this.keys = new Set();
    this.jumpQueued = false;
    this.lastTimestamp = null;
    this.listeners = new Set();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);

    this.boundHandlers = {
      canvasPointer: (event) => this.onCanvasPointer(event),
      contextMenu: (event) => this.onContextMenu(event),
      keyDown: (event) => this.onKeyDown(event),
      keyUp: (event) => this.onKeyUp(event),
      mouseMove: (event) => this.onMouseMove(event),
      pointerLockChange: () => this.emit(),
      blur: () => this.resetInput(),
    };

    for (const eventName of ['pointerdown', 'pointerup', 'pointermove']) {
      canvas.addEventListener(eventName, this.boundHandlers.canvasPointer, true);
    }
    canvas.addEventListener('contextmenu', this.boundHandlers.contextMenu, true);
    window.addEventListener('keydown', this.boundHandlers.keyDown, true);
    window.addEventListener('keyup', this.boundHandlers.keyUp, true);
    window.addEventListener('blur', this.boundHandlers.blur);
    document.addEventListener('mousemove', this.boundHandlers.mouseMove);
    document.addEventListener('pointerlockchange', this.boundHandlers.pointerLockChange);
    this.applyCameraState();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  getStatus() {
    return Object.freeze({
      enabled: this.enabled,
      harnessActive: this.harnessActive,
      uiBlocked: this.uiBlocked,
      pointerLocked: this.pointerLocked,
      grounded: this.state.grounded,
      running: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      position: Object.freeze({ x: this.state.x, y: this.state.y, z: this.state.z }),
      yaw: this.yaw,
      pitch: this.pitch,
    });
  }

  /**
   * Explicit overlay block. Clears held movement and rejects look / lock / keys
   * while active. The perf QA harness still bypasses pointer-lock requirements
   * but respects this block unless the harness itself clears it.
   */
  setUiBlocked(blocked) {
    const next = Boolean(blocked);
    if (this.uiBlocked === next) return;
    this.uiBlocked = next;
    if (this.uiBlocked) {
      this.resetInput();
    }
    this.emit();
  }

  setHarnessActive(active) {
    this.harnessActive = Boolean(active);
    if (!this.harnessActive) {
      this.resetInput();
    }
    this.emit();
  }

  setHarnessKeys(codes = []) {
    this.keys = new Set(codes);
    this.jumpQueued = this.keys.has('Space') && this.state.grounded;
    this.emit();
  }

  setPose({ x, z, yaw = this.yaw, pitch = this.pitch } = {}) {
    if (Number.isFinite(x) && Number.isFinite(z)) {
      this.state = createPlayerState({
        x,
        z,
        groundHeight: this.terrainView.getWorldHeight(x, z),
        eyeHeight: this.config.eyeHeight,
      });
    }
    if (Number.isFinite(yaw)) {
      this.yaw = yaw;
    }
    if (Number.isFinite(pitch)) {
      const maxPitch = THREE.MathUtils.degToRad(this.config.maxPitchDegrees);
      this.pitch = THREE.MathUtils.clamp(pitch, -maxPitch, maxPitch);
    }
    this.applyCameraState();
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled, spawn = null) {
    this.enabled = Boolean(enabled);
    this.lastTimestamp = null;
    this.resetInput();

    if (this.enabled && spawn) {
      this.state = createPlayerState({
        x: spawn.x,
        z: spawn.z,
        groundHeight: this.terrainView.getWorldHeight(spawn.x, spawn.z),
        eyeHeight: this.config.eyeHeight,
      });
      this.applyCameraState();
    }

    if (!this.enabled && this.pointerLocked) {
      document.exitPointerLock();
    }
    this.emit();
  }

  requestPointerLock() {
    if (this.enabled && !this.uiBlocked && !this.pointerLocked) {
      this.canvas.requestPointerLock();
    }
  }

  resize(width, height) {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  update(timestamp) {
    if (!this.enabled) {
      this.lastTimestamp = null;
      return;
    }

    const current = Number.isFinite(timestamp) ? timestamp : performance.now();
    const deltaSeconds = this.lastTimestamp === null ? 0 : (current - this.lastTimestamp) / 1000;
    this.lastTimestamp = current;

    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 0) {
      this.forward.normalize();
    }
    this.right.crossVectors(this.forward, this.up).normalize();

    const acceptsMovement = !this.uiBlocked && (this.pointerLocked || this.harnessActive);
    this.state = stepPlayerPhysics({
      state: this.state,
      input: {
        forward: acceptsMovement
          ? Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))
          : 0,
        right: acceptsMovement
          ? Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'))
          : 0,
        running: acceptsMovement && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
        jump: acceptsMovement && this.jumpQueued,
      },
      deltaSeconds,
      config: this.config,
      forward: this.forward,
      right: this.right,
      getGroundHeight: (x, z) => this.terrainView.getWorldHeight(x, z),
    });
    this.jumpQueued = false;
    this.applyCameraState();
  }

  getFocusWorld() {
    return Object.freeze({ x: this.state.x, z: this.state.z });
  }

  shiftWorld(shiftX, shiftZ) {
    this.state = {
      ...this.state,
      x: this.state.x - shiftX,
      z: this.state.z - shiftZ,
    };
    this.applyCameraState();
  }

  applyCameraState() {
    this.camera.position.set(this.state.x, this.state.y, this.state.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  onCanvasPointer(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' && event.button === 0) {
      this.requestPointerLock();
    }
  }

  onContextMenu(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  onKeyDown(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.code !== 'Escape') {
      event.stopImmediatePropagation();
    }
    if (!MOVEMENT_CODES.has(event.code)) {
      return;
    }
    event.preventDefault();
    this.keys.add(event.code);
    if (event.code === 'Space' && !event.repeat && this.state.grounded) {
      this.jumpQueued = true;
    }
  }

  onKeyUp(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked) {
      return;
    }
    if (event.code !== 'Escape') {
      event.stopImmediatePropagation();
    }
    if (MOVEMENT_CODES.has(event.code)) {
      event.preventDefault();
      this.keys.delete(event.code);
    }
  }

  onMouseMove(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || !this.pointerLocked) {
      return;
    }
    this.yaw -= event.movementX * this.config.mouseSensitivity;
    this.pitch -= event.movementY * this.config.mouseSensitivity;
    const maxPitch = THREE.MathUtils.degToRad(this.config.maxPitchDegrees);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);
    this.applyCameraState();
  }

  resetInput() {
    if (this.harnessActive) {
      return;
    }
    this.keys.clear();
    this.jumpQueued = false;
  }

  emit() {
    const state = this.getStatus();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  dispose() {
    for (const eventName of ['pointerdown', 'pointerup', 'pointermove']) {
      this.canvas.removeEventListener(eventName, this.boundHandlers.canvasPointer, true);
    }
    this.canvas.removeEventListener('contextmenu', this.boundHandlers.contextMenu, true);
    window.removeEventListener('keydown', this.boundHandlers.keyDown, true);
    window.removeEventListener('keyup', this.boundHandlers.keyUp, true);
    window.removeEventListener('blur', this.boundHandlers.blur);
    document.removeEventListener('mousemove', this.boundHandlers.mouseMove);
    document.removeEventListener('pointerlockchange', this.boundHandlers.pointerLockChange);
    this.listeners.clear();
  }
}
