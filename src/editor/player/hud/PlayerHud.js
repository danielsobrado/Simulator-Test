import { HudCompass } from './HudCompass.js';
import { HudKeyHints } from './HudKeyHints.js';
import { HudMetrics } from './HudMetrics.js';
import { HudMinimap } from './HudMinimap.js';
import { HudStatus } from './HudStatus.js';
import { HudVitals } from './HudVitals.js';
import { HUD_PHASE, isPlayerEngaged, resolveHudPhase } from './hudState.js';

const NOTICE_MS = 3000;

function createNotice() {
  const notice = document.createElement('p');
  notice.className = 'hud-notice';
  notice.setAttribute('role', 'status');
  return notice;
}

function createReticle() {
  const reticle = document.createElement('span');
  reticle.className = 'hud-reticle';
  reticle.setAttribute('aria-hidden', 'true');
  return reticle;
}

/**
 * The walking HUD: a status line, the compass ribbon, the reticle, the vitals, the
 * heading-up minimap with the frame-rate readout beside it, and the scene legend
 * with the controls — laid out as grass-test's cinematic HUD. Spells keep their
 * own dock (`spell_menu.js`).
 *
 * `render` follows view-mode state changes; `update` runs every frame and only
 * moves the compass and minimap, so it stays cheap while walking and free otherwise.
 */
export class PlayerHud {
  /**
   * @param {object} options
   * @param {HTMLElement} options.viewport
   * @param {boolean} [options.canToggleCamera] whether V switches to third person
   * @param {ConstructorParameters<typeof HudMinimap>[0] | null} [options.minimap]
   * @param {import('../PlayerVitals.js').PlayerVitals | null} [options.vitals]
   * @param {() => object | null} [options.getRenderer] for the FPS / TRIS / DRAWS readout
   * @param {() => string} [options.getSceneLabel] the legend's title (time of day)
   */
  constructor({
    viewport, canToggleCamera = false, canBoost = false, minimap = null, vitals = null, getRenderer = () => null, getSceneLabel = () => '',
  }) {
    this.element = document.createElement('div');
    this.element.className = 'player-hud';
    this.element.hidden = true;
    this.phase = HUD_PHASE.hidden;

    this.status = new HudStatus();
    this.reticle = createReticle();
    this.notice = createNotice();
    this.compass = new HudCompass(minimap ?? {});
    this.vitals = new HudVitals();
    this.unsubscribeVitals = vitals?.subscribe((levels) => this.vitals.show(levels));
    this.minimap = minimap ? new HudMinimap(minimap) : null;
    this.hints = new HudKeyHints({ canToggleCamera, canBoost, getSceneLabel });
    this.metrics = new HudMetrics({ getRenderer });
    this.element.append(
      this.compass.element,
      this.status.element,
      this.reticle,
      this.notice,
      this.vitals.element,
      ...(this.minimap ? [this.minimap.element] : []),
      this.metrics.element,
      this.hints.element,
    );
    viewport.append(this.element);
  }

  /** Shows a line mid-screen for a moment; a new one restarts the fade. */
  announce(text) {
    this.notice.textContent = text;
    this.notice.animate?.(
      [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }],
      { duration: NOTICE_MS, easing: 'ease-out' },
    );
  }

  render(state) {
    const phase = resolveHudPhase(state);
    this.phase = phase;
    this.element.hidden = phase === HUD_PHASE.hidden;
    this.element.dataset.hudPhase = phase;
    this.reticle.hidden = phase !== HUD_PHASE.walking;
    this.status.render(state);
    this.compass.render(phase);
    this.vitals.render(phase);
    this.minimap?.render(phase);
    this.hints.render(phase, { engaged: isPlayerEngaged(state) });
    this.metrics.setVisible(phase === HUD_PHASE.walking);
  }

  update(heading, nowMs = performance.now()) {
    if (this.phase !== HUD_PHASE.walking) return;
    this.compass.update(heading, nowMs);
    this.minimap?.update(heading, nowMs);
    this.metrics.update(nowMs);
    this.hints.refreshScene();
  }

  dispose() {
    this.unsubscribeVitals?.();
    this.compass.dispose();
    this.vitals.dispose();
    this.minimap?.dispose();
    this.hints.dispose();
    this.metrics.dispose();
    this.status.dispose();
    this.element.remove();
  }
}
