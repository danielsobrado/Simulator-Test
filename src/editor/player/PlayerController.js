import * as THREE from 'three';
import { registerCollisionPlayer } from '../collision/CollisionPlayerBridge.js';
import { createPlayerState, stepPlayerPhysics } from './PlayerPhysics.js';
import { createPlayerWaterEvents } from './PlayerWaterEvents.js';
import { isSwimmingWaterState } from './PlayerWaterState.js';
import { UnderwaterViewController } from '../water/UnderwaterViewController.js';

const MOVEMENT_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'KeyC',
  'Space',
]);

const INACTIVE_COLLISION_STATUS = Object.freeze({
  active: false,
  ready: true,
  blocked: false,
  stepped: false,
  supportSourceId: 'terrain',
  supportNormal: Object.freeze({ x: 0, y: 1, z: 0 }),
  contacts: Object.freeze([]),
});

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
    /** Walking is suspended for in-world editing; the pose is preserved. */
    this.paused = false;
    /** Set by the composition root; makes wall tops walkable. */
    this.constructionGround = null;
    this.uiBlocked = false;
    this.keys = new Set();
    this.jumpQueued = false;
    this.lastTimestamp = null;
    this.listeners = new Set();
    this.waterEventListeners = new Set();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.collisionRuntime = null;
    this.characterMotor = null;
    this.underwaterView = config.water?.underwater && terrainView.scene
      ? new UnderwaterViewController({
        terrainView,
        playerController: this,
        config: config.water.underwater,
      })
      : null;

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
    this.releaseCollisionPlayer = registerCollisionPlayer(this);
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  getStatus() {
    const collision = this.characterMotor?.getStatus() ?? INACTIVE_COLLISION_STATUS;
    return Object.freeze({
      enabled: this.enabled,
      harnessActive: this.harnessActive,
      uiBlocked: this.uiBlocked,
      pointerLocked: this.pointerLocked,
      grounded: this.state.grounded,
      running: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      position: Object.freeze({ x: this.state.x, y: this.state.y, z: this.state.z }),
      footY: this.state.footY,
      yaw: this.yaw,
      pitch: this.pitch,
      supportSourceId: this.state.supportSourceId,
      supportNormal: Object.freeze({ ...this.state.supportNormal }),
      collision: Object.freeze({
        ...collision,
        supportNormal: Object.freeze({ ...collision.supportNormal }),
        contacts: Object.freeze([...(collision.contacts ?? [])]),
        previousValidPosition: collision.previousValidPosition
          ? Object.freeze({ ...collision.previousValidPosition })
          : null,
      }),
      waterState: this.state.waterState,
      waterDepth: this.state.waterDepth,
      waterSurfaceHeight: this.state.waterSurfaceHeight,
      waterBodyId: this.state.waterBodyId,
      waterKind: this.state.waterKind,
      waterFlowX: this.state.waterFlowX,
      waterFlowZ: this.state.waterFlowZ,
      headSubmerged: this.state.headSubmerged,
    });
  }

  attachCollision({ runtime, motor }) {
    if (!runtime || !motor) throw new Error('Player collision attachment requires runtime and motor.');
    this.collisionRuntime = runtime;
    this.characterMotor = motor;
    this.collisionRuntime.resetTracking?.();
    this.resetCollision();
    this.emit();
  }

  detachCollision() {
    this.collisionRuntime = null;
    this.characterMotor = null;
    this.emit();
  }

  resetCollision() {
    if (!this.characterMotor) return;
    this.collisionRuntime?.resetTracking?.();
    const canonical = this.terrainView.floatingOrigin.toCanonical(this.state.x, this.state.z);
    this.characterMotor.reset({
      x: canonical.x,
      y: this.state.y - this.config.eyeHeight,
      z: canonical.z,
    });
  }

  resolveHorizontalMotion(request) {
    if (!this.characterMotor) return null;
    const canonical = this.terrainView.floatingOrigin.toCanonical(
      request.start.x,
      request.start.z,
    );
    const result = this.characterMotor.move({
      ...request,
      start: {
        x: canonical.x,
        y: request.start.y,
        z: canonical.z,
      },
    });
    const render = this.terrainView.floatingOrigin.toRender(
      result.position.x,
      result.position.z,
    );
    const previousRender = result.previousValidPosition
      ? this.terrainView.floatingOrigin.toRender(
        result.previousValidPosition.x,
        result.previousValidPosition.z,
      )
      : null;
    return {
      ...result,
      position: {
        x: render.x,
        y: result.position.y,
        z: render.z,
      },
      previousValidPosition: previousRender
        ? Object.freeze({
          x: previousRender.x,
          y: result.previousValidPosition.y,
          z: previousRender.z,
        })
        : null,
    };
  }

  setUiBlocked(blocked) {
    const next = Boolean(blocked);
    if (this.uiBlocked === next) return;
    this.uiBlocked = next;
    if (this.uiBlocked) this.resetInput();
    this.emit();
  }

  setHarnessActive(active) {
    this.harnessActive = Boolean(active);
    if (!this.harnessActive) this.resetInput();
    this.emit();
  }

  setHarnessKeys(codes = []) {
    this.keys = new Set(codes);
    this.jumpQueued = this.keys.has('Space')
      && this.state.grounded
      && !isSwimmingWaterState(this.state.waterState);
    this.emit();
  }

  createState(x, z) {
    return createPlayerState({
      x,
      z,
      groundHeight: this.terrainView.getWorldHeight(x, z),
      eyeHeight: this.config.eyeHeight,
    });
  }

  setPose({ x, z, yaw = this.yaw, pitch = this.pitch } = {}) {
    if (Number.isFinite(x) && Number.isFinite(z)) {
      const previous = this.state;
      this.state = this.createState(x, z);
      this.resetCollision();
      this.emitWaterEvents(previous, this.state, performance.now());
      this.underwaterView?.restoreSurfaceEnvironment();
    }
    if (Number.isFinite(yaw)) this.yaw = yaw;
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

  subscribeWaterEvents(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Water event listener must be a function.');
    }
    this.waterEventListeners.add(listener);
    return () => this.waterEventListeners.delete(listener);
  }

  /**
   * Pause walking without unloading the player.
   *
   * `setEnabled(false)` would discard the pose; pausing keeps it so resuming
   * puts the player exactly back where they stopped.
   */
  setPaused(paused) {
    const next = Boolean(paused);
    if (this.paused === next) return;
    this.paused = next;
    this.lastTimestamp = null;
    if (next) {
      this.resetInput();
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock?.();
      }
    }
    this.emit();
  }

  setEnabled(enabled, spawn = null) {
    this.enabled = Boolean(enabled);
    this.lastTimestamp = null;
    this.resetInput();

    if (this.enabled && spawn) {
      const previous = this.state;
      this.state = this.createState(spawn.x, spawn.z);
      this.resetCollision();
      this.emitWaterEvents(previous, this.state, performance.now());
      this.applyCameraState();
    }

    if (!this.enabled) {
      this.underwaterView?.restoreSurfaceEnvironment();
      if (this.pointerLocked) document.exitPointerLock();
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
    // Freeze the physics step while paused for editing. Left running, gravity
    // and ground-following would drift or settle the camera under the user
    // while they work, and the view has to hold still to edit against.
    if (this.paused) {
      this.lastTimestamp = null;
      return;
    }

    const current = Number.isFinite(timestamp) ? timestamp : performance.now();
    const deltaSeconds = this.lastTimestamp === null ? 0 : (current - this.lastTimestamp) / 1000;
    this.lastTimestamp = current;

    if (this.collisionRuntime) {
      const focus = this.terrainView.floatingOrigin.toCanonical(this.state.x, this.state.z);
      this.collisionRuntime.update(focus, current);
    }

    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() > 0) this.forward.normalize();
    this.right.crossVectors(this.forward, this.up).normalize();

    const acceptsMovement = !this.uiBlocked && (this.pointerLocked || this.harnessActive);
    const ascend = acceptsMovement && this.keys.has('Space') ? 1 : 0;
    const descend = acceptsMovement && (
      this.keys.has('ControlLeft')
      || this.keys.has('ControlRight')
      || this.keys.has('KeyC')
    ) ? 1 : 0;
    const previousState = this.state;
    const nextState = stepPlayerPhysics({
      state: previousState,
      input: {
        forward: acceptsMovement
          ? Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'))
          : 0,
        right: acceptsMovement
          ? Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'))
          : 0,
        running: acceptsMovement && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')),
        jump: acceptsMovement && this.jumpQueued,
        ascend,
        descend,
      },
      deltaSeconds,
      config: this.config,
      forward: this.forward,
      right: this.right,
      // Walls are part of the ground, not obstacles: a flat-topped wall is a
      // height field over a narrow ribbon, so it composes into the same
      // function rather than needing collision response.
      getGroundHeight: (x, z) => {
        const terrain = this.terrainView.getWorldHeight(x, z);
        if (!this.constructionGround) return terrain;
        const canonical = this.terrainView.floatingOrigin.toCanonical(x, z);
        const wall = this.constructionGround.heightAt(canonical.x, canonical.z);
        return wall === null ? terrain : Math.max(terrain, wall);
      },
      getWaterSample: typeof this.terrainView.getWorldWater === 'function'
        ? (x, z) => this.terrainView.getWorldWater(x, z)
        : null,
      resolveHorizontalMotion: this.characterMotor
        ? (request) => this.resolveHorizontalMotion(request)
        : null,
    });
    const waterChanged = nextState.waterState !== previousState.waterState
      || nextState.headSubmerged !== previousState.headSubmerged
      || nextState.waterBodyId !== previousState.waterBodyId;
    const collisionChanged = nextState.collisionReady !== previousState.collisionReady
      || nextState.collisionBlocked !== previousState.collisionBlocked
      || nextState.supportSourceId !== previousState.supportSourceId;
    this.state = nextState;
    this.jumpQueued = false;
    this.applyCameraState();
    this.underwaterView?.update(current);
    this.emitWaterEvents(previousState, nextState, current);
    if (waterChanged || collisionChanged) this.emit();
  }

  getFocusWorld() {
    return Object.freeze({ x: this.state.x, z: this.state.z });
  }

  shiftWorld(shiftX, shiftZ) {
    this.state = {
      ...this.state,
      x: this.state.x - shiftX,
      z: this.state.z - shiftZ,
      previousValidPosition: this.state.previousValidPosition
        ? Object.freeze({
          ...this.state.previousValidPosition,
          x: this.state.previousValidPosition.x - shiftX,
          z: this.state.previousValidPosition.z - shiftZ,
        })
        : null,
    };
    this.applyCameraState();
  }

  applyCameraState() {
    this.camera.position.set(this.state.x, this.state.y, this.state.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  onCanvasPointer(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || this.paused) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'pointerdown' && event.button === 0) this.requestPointerLock();
  }

  onContextMenu(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || this.paused) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  onKeyDown(event) {
    if (!this.enabled
        || this.harnessActive
        || this.uiBlocked
        || this.paused
        || event.target instanceof HTMLInputElement
        || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    // Escape is owned by `EscapeStack`, which listens on the capture phase at a
    // higher priority; everything else belongs to the player while walking.
    if (event.code !== 'Escape') event.stopImmediatePropagation();
    if (!MOVEMENT_CODES.has(event.code)) return;
    event.preventDefault();
    this.keys.add(event.code);
    if (event.code === 'Space'
        && !event.repeat
        && this.state.grounded
        && !isSwimmingWaterState(this.state.waterState)) {
      this.jumpQueued = true;
    }
  }

  onKeyUp(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || this.paused) return;
    if (event.code !== 'Escape') event.stopImmediatePropagation();
    if (MOVEMENT_CODES.has(event.code)) {
      event.preventDefault();
      this.keys.delete(event.code);
    }
  }

  onMouseMove(event) {
    if (!this.enabled || this.harnessActive || this.uiBlocked || !this.pointerLocked) return;
    this.yaw -= event.movementX * this.config.mouseSensitivity;
    this.pitch -= event.movementY * this.config.mouseSensitivity;
    const maxPitch = THREE.MathUtils.degToRad(this.config.maxPitchDegrees);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);
    this.applyCameraState();
  }

  resetInput() {
    if (this.harnessActive) return;
    this.keys.clear();
    this.jumpQueued = false;
  }

  emitWaterEvents(previousState, currentState, timestamp) {
    if (this.waterEventListeners.size === 0) return;
    for (const event of createPlayerWaterEvents(previousState, currentState, timestamp)) {
      for (const listener of this.waterEventListeners) listener(event);
    }
  }

  emit() {
    const state = this.getStatus();
    for (const listener of this.listeners) listener(state);
  }

  dispose() {
    this.releaseCollisionPlayer?.();
    for (const eventName of ['pointerdown', 'pointerup', 'pointermove']) {
      this.canvas.removeEventListener(eventName, this.boundHandlers.canvasPointer, true);
    }
    this.canvas.removeEventListener('contextmenu', this.boundHandlers.contextMenu, true);
    window.removeEventListener('keydown', this.boundHandlers.keyDown, true);
    window.removeEventListener('keyup', this.boundHandlers.keyUp, true);
    window.removeEventListener('blur', this.boundHandlers.blur);
    document.removeEventListener('mousemove', this.boundHandlers.mouseMove);
    document.removeEventListener('pointerlockchange', this.boundHandlers.pointerLockChange);
    this.underwaterView?.dispose();
    this.listeners.clear();
    this.waterEventListeners.clear();
  }
}
