import { PLAYER_MODE_EDIT, PLAYER_MODE_WALK, PLAYER_MODE_FLY } from './playerConstants.js';
import { hudIcon } from './hud/hudIcons.js';
import { PlayerHud } from './hud/PlayerHud.js';
import { HUD_PHASE } from './hud/hudState.js';

const MAX_VITALS_STEP_S = 0.1;

/**
 * The Edit / Play / Fly switch and navigation hints.
 *
 * The switch floats over the viewport rather than living in the topbar, which
 * the editor chrome hides; it stays reachable in every mode. The mode is also
 * mirrored onto the editor root as `data-view-mode`, which `playerMode.css`
 * uses to clear the editing chrome away while walking.
 */
export class ViewModeUi {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root editor root holding the viewport
   * @param {import('./ViewModeController.js').ViewModeController} options.controller
   * @param {{ minimap?: object, vitals?: import('./PlayerVitals.js').PlayerVitals, getRenderer?: Function, getSceneLabel?: Function }} [options.hud]
   */
  constructor({ root, controller, hud = {} }) {
    this.root = root;
    this.controller = controller;
    const viewport = root.querySelector('[data-role="viewport"]');
    if (!viewport) {
      throw new Error('View mode UI requires the editor viewport.');
    }

    this.viewport = viewport;
    this.switcher = document.createElement('div');
    this.switcher.className = 'view-mode-switcher';
    this.switcher.setAttribute('role', 'group');
    this.switcher.setAttribute('aria-label', 'Camera mode');
    this.switcher.innerHTML = `
      <button type="button" data-view-mode="${PLAYER_MODE_EDIT}" title="Edit / Orbit">
        ${hudIcon('edit')}<span>Edit</span>
      </button>
      <button type="button" data-view-mode="${PLAYER_MODE_WALK}" title="Walk the world as the player">
        ${hudIcon('play')}<span>Play</span>
      </button>
      ${controller.freeFly.settings.enabled ? `<button type="button" data-view-mode="${PLAYER_MODE_FLY}" title="Free flight (F)">
        ${hudIcon('fly')}<span>Fly</span>
      </button>` : ''}
    `;
    viewport.append(this.switcher);
    this.flightHints = document.createElement('div'); this.flightHints.className = 'free-flight-hints';
    this.flightHints.textContent = 'Free flight · WASD move · Mouse look · Space / Ctrl rise / descend · Shift faster · F / Esc return';
    this.flightHints.hidden = true; viewport.append(this.flightHints);

    this.vitals = hud.vitals ?? null;
    this.respawnPoint = null;
    this.unsubscribeTeleport = controller.playerController?.subscribeTeleports?.((pose) => {
      this.respawnPoint = { x: pose.x, z: pose.z };
    });
    this.frameStatus = {};
    this.lastUpdateMs = null;
    this.hud = new PlayerHud({
      viewport,
      canToggleCamera: Boolean(controller.thirdPersonCamera),
      canBoost: controller.playerController.speedMode?.enabled ?? false,
      minimap: hud.minimap ?? null,
      vitals: hud.vitals ?? null,
      getRenderer: hud.getRenderer,
      getSceneLabel: hud.getSceneLabel,
    });

    this.onClick = (event) => {
      const button = event.target.closest('[data-view-mode]');
      if (!button) {
        return;
      }
      controller.setMode(button.dataset.viewMode, {
        requestPointerLock: button.dataset.viewMode !== PLAYER_MODE_EDIT,
      });
    };
    this.switcher.addEventListener('click', this.onClick);
    this.unsubscribe = controller.subscribe((state) => this.render(state));
  }

  render(state) {
    if (state.mode === PLAYER_MODE_WALK && !this.respawnPoint) {
      const { x, z } = this.controller.playerController.state;
      this.respawnPoint = { x, z };
    } else if (state.mode !== PLAYER_MODE_WALK) {
      this.respawnPoint = null;
    }
    const playerActive = state.mode === PLAYER_MODE_WALK || state.awaitingSpawn;
    this.root.dataset.viewMode = state.awaitingSpawn
      ? 'player-spawn'
      : state.mode;
    this.root.toggleAttribute('data-awaiting-spawn', state.awaitingSpawn);
    this.root.dataset.playerPaused = state.paused ? 'true' : 'false';
    this.flightHints.hidden = state.mode !== PLAYER_MODE_FLY;

    for (const button of this.switcher.querySelectorAll('[data-view-mode]')) {
      const isPlayerButton = button.dataset.viewMode === PLAYER_MODE_WALK;
      const active = isPlayerButton
        ? playerActive
        : button.dataset.viewMode === state.mode && !state.awaitingSpawn;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    this.hud.render(state);
  }

  /** Per-frame: runs the vitals while walking and keeps the minimap turned with the camera. */
  update(nowMs = performance.now()) {
    const deltaSeconds = Math.min(MAX_VITALS_STEP_S, (nowMs - (this.lastUpdateMs ?? nowMs)) / 1000);
    this.lastUpdateMs = nowMs;
    if (this.vitals && this.hud.phase === HUD_PHASE.walking) {
      const player = this.controller.playerController;
      player.readFrameStatus(this.frameStatus);
      this.vitals.update(deltaSeconds, this.frameStatus);
      player.applyExertion(this.vitals);
      this.respawnIfDead(player);
    }
    this.hud.update(this.controller.getHeading());
  }

  respawnIfDead(player) {
    if (!this.vitals.dead) return;
    this.vitals.revive();
    player.setPose(this.respawnPoint ?? player.state);
    this.hud.announce('You fell. Back at your start.');
  }

  dispose() {
    this.unsubscribeTeleport?.();
    this.unsubscribe?.();
    this.switcher.removeEventListener('click', this.onClick);
    this.switcher.remove();
    this.flightHints.remove();
    this.hud.dispose();
    delete this.root.dataset.viewMode;
    this.root.removeAttribute('data-awaiting-spawn');
  }
}
