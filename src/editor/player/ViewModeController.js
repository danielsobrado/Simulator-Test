import { PRIMARY_POINTER_BUTTON } from '../constants.js';
import { emitAudio } from '../audio/index.js';
import {
  PLAYER_MODE_EDIT,
  PLAYER_MODE_WALK,
  PLAYER_MODES,
} from './playerConstants.js';

export const CAMERA_VIEW_FIRST = 'first';
export const CAMERA_VIEW_THIRD = 'third';

/** The key that flips between them. Claimed on the capture phase — see below. */
export const CAMERA_VIEW_TOGGLE_CODE = 'KeyV';

export class ViewModeController {
  constructor({
    editorCamera, playerController, terrainView, thirdPersonCamera = null,
  }) {
    this.editorCamera = editorCamera;
    this.playerController = playerController;
    this.terrainView = terrainView;
    /**
     * Optional second camera for walk mode. Absent, the toggle is inert and walk
     * mode behaves exactly as it did before the character existed.
     */
    this.thirdPersonCamera = thirdPersonCamera;
    this.cameraView = CAMERA_VIEW_FIRST;
    this.canvas = terrainView.renderer.domElement;
    this.mode = PLAYER_MODE_EDIT;
    /**
     * Walking suspended for in-world editing.
     *
     * Deliberately a flag rather than a third entry in `PLAYER_MODES`: keeping
     * the mode set at two means `ViewModeUi`, every `playerMode.css` selector,
     * the perf harness and every `setMode` caller keep working untouched.
     */
    this.paused = false;
    this.awaitingSpawn = false;
    this.spacePressed = false;
    this._lastTimestamp = null;
    this.listeners = new Set();
    this.unsubscribePlayer = playerController.subscribe(() => this.emit());
    this.editorCamera.setEnabled(true);
    this.playerController.setEnabled(false);

    this.boundHandlers = {
      pointerDown: (event) => this.onSpawnPointerDown(event),
      keyDown: (event) => this.onSpawnKeyDown(event),
      keyUp: (event) => this.onSpawnKeyUp(event),
    };
    this.canvas.addEventListener('pointerdown', this.boundHandlers.pointerDown, true);
    window.addEventListener('keydown', this.boundHandlers.keyDown, true);
    window.addEventListener('keyup', this.boundHandlers.keyUp, true);
  }

  get camera() {
    if (this.mode !== PLAYER_MODE_WALK) return this.editorCamera.camera;
    if (!this.isThirdPerson) return this.playerController.camera;

    const camera = this.thirdPersonCamera.camera;
    const playerCamera = this.playerController.camera;
    // Far-terrain mode updates the player camera at runtime. Keep the optional
    // third-person camera on the same range without coupling the composition
    // root to every camera implementation.
    if (camera.far !== playerCamera.far) {
      camera.far = playerCamera.far;
      camera.updateProjectionMatrix();
    }
    return camera;
  }

  get isThirdPerson() {
    return this.cameraView === CAMERA_VIEW_THIRD && this.thirdPersonCamera !== null;
  }

  getState() {
    return Object.freeze({
      mode: this.mode,
      cameraView: this.cameraView,
      paused: this.paused,
      awaitingSpawn: this.awaitingSpawn,
      player: this.playerController.getStatus(),
    });
  }

  /**
   * Flip between first and third person.
   *
   * @returns {boolean} whether the view actually changed
   */
  toggleCameraView() {
    if (!this.thirdPersonCamera || this.mode !== PLAYER_MODE_WALK) return false;
    this.cameraView = this.cameraView === CAMERA_VIEW_THIRD
      ? CAMERA_VIEW_FIRST
      : CAMERA_VIEW_THIRD;
    if (this.isThirdPerson) {
      // The boom has no idea where the player is until it has run once; easing
      // in from wherever it was left flies the camera across the map.
      this.thirdPersonCamera.reset();
      this.thirdPersonCamera.update(0, this.playerController.getStatus());
    }
    this.onCameraViewChange?.(this.cameraView);
    this.emit();
    return true;
  }

  /**
   * Capture-phase key handler for the view toggle.
   *
   * `PlayerController` stops immediate propagation on every non-Escape key while
   * walking, so this has to be attached before it is constructed — see
   * `attachCaptureHotkey`. Returns true when the event was claimed.
   */
  handleCameraViewKey(event) {
    if (event.code !== CAMERA_VIEW_TOGGLE_CODE) return false;
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (this.mode !== PLAYER_MODE_WALK || this.paused || this.awaitingSpawn) return false;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false;
    event.preventDefault();
    return this.toggleCameraView();
  }

  /** Suspend walking so the world can be edited from the player's viewpoint. */
  pause() {
    if (this.mode !== PLAYER_MODE_WALK || this.paused) return false;
    this.paused = true;
    this.playerController.setPaused(true);
    // Only wall building is offered while paused; force the construction tool
    // so a leftover terrain/object tool cannot still paint from first person.
    this.onPausedEditing?.();
    this.emit();
    return true;
  }

  /** Resume walking. Clicking the viewport re-locks the pointer as before. */
  resume() {
    if (!this.paused) return false;
    this.paused = false;
    this.playerController.setPaused(false);
    this.emit();
    return true;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  setMode(mode, { requestPointerLock = false, spawn = null } = {}) {
    if (!PLAYER_MODES.includes(mode)) {
      return;
    }

    if (mode === PLAYER_MODE_WALK) {
      if (this.mode === PLAYER_MODE_WALK) {
        // Already walking, or paused mid-walk: re-entering resumes rather than
        // respawning, so clicking the viewport puts the player straight back.
        this.resume();
        if (requestPointerLock) {
          this.playerController.requestPointerLock();
        }
        return;
      }

      if (spawn) {
        this.enterWalkMode(spawn, { requestPointerLock });
        return;
      }

      if (this.awaitingSpawn) {
        return;
      }

      this.beginSpawnSelection();
      return;
    }

    this.cancelSpawnSelection();
    this.resume();
    if (this.mode === PLAYER_MODE_EDIT) {
      return;
    }

    const focus = this.playerController.getFocusWorld();
    this.mode = PLAYER_MODE_EDIT;
    this.playerController.setEnabled(false);
    this.editorCamera.setEnabled(true);
    this.editorCamera.focusWorld(focus.x, focus.z);
    emitAudio('camera.mode.orbit');
    this.emit();
  }

  beginSpawnSelection() {
    this.awaitingSpawn = true;
    this.spacePressed = false;
    // Drop orbit brush/object ghosts immediately — spawn hover must not keep
    // a raise/paint preview pinned to the ground under the cursor.
    this.onLeaveOrbitEditing?.();
    this.emit();
  }

  cancelSpawnSelection() {
    if (!this.awaitingSpawn) {
      return;
    }
    this.awaitingSpawn = false;
    this.spacePressed = false;
    this.emit();
  }

  enterWalkMode(spawn, { requestPointerLock = false } = {}) {
    this.awaitingSpawn = false;
    this.spacePressed = false;
    this.mode = PLAYER_MODE_WALK;
    this.editorCamera.setEnabled(false);
    this.playerController.setEnabled(true, spawn);
    // The boom carries the last walk's pose; entering somewhere else entirely
    // would otherwise be a long swoop across the world.
    this.thirdPersonCamera?.reset();
    this._lastTimestamp = null;
    if (requestPointerLock) {
      this.playerController.requestPointerLock();
    }
    // Direct spawn (world map / harness) skips beginSpawnSelection, so clear
    // here too — otherwise the last orbit brush stays rendered while walking.
    this.onLeaveOrbitEditing?.();
    emitAudio('camera.mode.player');
    this.emit();
  }

  onSpawnPointerDown(event) {
    if (!this.awaitingSpawn || event.button !== PRIMARY_POINTER_BUTTON || this.spacePressed) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const spawn = this.terrainView.pickWorld(
      event.clientX,
      event.clientY,
      this.editorCamera.camera,
    );
    if (!spawn) {
      return;
    }

    this.enterWalkMode(spawn, { requestPointerLock: true });
  }

  onSpawnKeyDown(event) {
    if (event.code === 'Space') {
      this.spacePressed = true;
    }

    if (!this.awaitingSpawn) {
      return;
    }

    if (event.code === 'Escape') {
      event.preventDefault();
      this.cancelSpawnSelection();
    }
  }

  onSpawnKeyUp(event) {
    if (event.code === 'Space') {
      this.spacePressed = false;
    }
  }

  resize(width, height) {
    this.editorCamera.resize(width, height);
    this.playerController.resize(width, height);
    this.thirdPersonCamera?.resize(width, height);
  }

  update(timestamp) {
    if (this.mode === PLAYER_MODE_WALK) {
      this.playerController.update(timestamp);
      if (this.isThirdPerson) {
        const deltaSeconds = this._lastTimestamp === null
          ? 0
          : (timestamp - this._lastTimestamp) / 1000;
        this.thirdPersonCamera.update(deltaSeconds, this.playerController.getStatus());
      }
      this._lastTimestamp = timestamp;
    } else {
      this._lastTimestamp = null;
      this.editorCamera.update();
    }
  }

  getFocusWorld() {
    return this.mode === PLAYER_MODE_WALK
      ? this.playerController.getFocusWorld()
      : this.editorCamera.getFocusWorld();
  }

  // Only the first-person view has a heading worth turning the minimap by; the
  // orbit view keeps it north-up so its click-to-recentre maths stays valid.
  getHeading() {
    return this.mode === PLAYER_MODE_WALK ? this.playerController.yaw : 0;
  }

  shiftWorld(shiftX, shiftZ) {
    this.editorCamera.shiftWorld(shiftX, shiftZ);
    this.playerController.shiftWorld(shiftX, shiftZ);
    this.thirdPersonCamera?.shiftWorld(shiftX, shiftZ);
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.boundHandlers.pointerDown, true);
    window.removeEventListener('keydown', this.boundHandlers.keyDown, true);
    window.removeEventListener('keyup', this.boundHandlers.keyUp, true);
    this.unsubscribePlayer?.();
    this.playerController.dispose();
    this.listeners.clear();
  }
}
