import {
  PLAYER_MODE_EDIT,
  PLAYER_MODE_WALK,
  PLAYER_POINTER_LOCK_MESSAGE,
  PLAYER_SPAWN_PICK_MESSAGE,
} from './playerConstants.js';

function collisionHelp(player) {
  const collision = player?.collision;
  if (!collision?.active || collision.ready || !collision.readiness) return null;
  const failure = collision.readiness.failed?.[0] ?? null;
  if (failure) {
    return `Collision failed in ${failure.chunkKey ?? 'the destination'}: ${failure.message}`;
  }
  const missing = collision.readiness.missing?.length ?? 0;
  return missing > 0
    ? `Loading collision safety data… ${missing} chunk${missing === 1 ? '' : 's'} remaining.`
    : 'Loading collision safety data…';
}

export class ViewModeUi {
  constructor({ root, controller }) {
    this.root = root;
    this.controller = controller;
    const topbar = root.querySelector('.topbar');
    const viewport = root.querySelector('[data-role="viewport"]');
    if (!topbar || !viewport) {
      throw new Error('View mode UI requires the editor topbar and viewport.');
    }

    this.viewport = viewport;
    this.switcher = document.createElement('div');
    this.switcher.className = 'view-mode-switcher';
    this.switcher.setAttribute('aria-label', 'Camera mode');
    this.switcher.innerHTML = `
      <button type="button" data-view-mode="${PLAYER_MODE_EDIT}">Edit / Orbit</button>
      <button type="button" data-view-mode="${PLAYER_MODE_WALK}">Player</button>
    `;
    topbar.prepend(this.switcher);

    this.hud = document.createElement('div');
    this.hud.className = 'player-hud';
    this.hud.hidden = true;
    this.hud.innerHTML = `
      <span class="player-crosshair" aria-hidden="true"></span>
      <div class="player-help" data-role="player-help"></div>
    `;
    viewport.append(this.hud);
    this.help = this.hud.querySelector('[data-role="player-help"]');
    this.crosshair = this.hud.querySelector('.player-crosshair');

    this.onClick = (event) => {
      const button = event.target.closest('[data-view-mode]');
      if (!button) {
        return;
      }
      controller.setMode(button.dataset.viewMode, {
        requestPointerLock: button.dataset.viewMode === PLAYER_MODE_WALK,
      });
    };
    this.switcher.addEventListener('click', this.onClick);
    this.unsubscribe = controller.subscribe((state) => this.render(state));
  }

  render(state) {
    const playerActive = state.mode === PLAYER_MODE_WALK || state.awaitingSpawn;
    this.root.dataset.viewMode = state.awaitingSpawn
      ? 'player-spawn'
      : state.mode;
    this.root.toggleAttribute('data-awaiting-spawn', state.awaitingSpawn);
    this.root.dataset.playerPaused = state.paused ? 'true' : 'false';

    for (const button of this.switcher.querySelectorAll('[data-view-mode]')) {
      const isPlayerButton = button.dataset.viewMode === PLAYER_MODE_WALK;
      button.classList.toggle(
        'is-active',
        isPlayerButton ? playerActive : button.dataset.viewMode === state.mode && !state.awaitingSpawn,
      );
    }

    this.hud.hidden = !playerActive;
    if (!playerActive) {
      return;
    }

    this.crosshair.hidden = state.awaitingSpawn;
    if (state.awaitingSpawn) {
      this.help.textContent = PLAYER_SPAWN_PICK_MESSAGE;
      return;
    }

    const readiness = collisionHelp(state.player);
    if (readiness) {
      this.help.textContent = readiness;
      return;
    }

    this.help.textContent = state.player.pointerLocked
      ? 'WASD move · Shift run · Space jump · Esc release mouse'
      : `${PLAYER_POINTER_LOCK_MESSAGE} WASD move · Shift run · Space jump.`;
  }

  dispose() {
    this.unsubscribe?.();
    this.switcher.removeEventListener('click', this.onClick);
    this.switcher.remove();
    this.hud.remove();
    delete this.root.dataset.viewMode;
    this.root.removeAttribute('data-awaiting-spawn');
  }
}
