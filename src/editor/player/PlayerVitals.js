const RUN_STAMINA_DRAIN_PER_S = 0.08;
const STAMINA_REGEN_PER_S = 0.12;
const BOOST_ENERGY_DRAIN_PER_S = 0.1;
const ENERGY_REGEN_PER_S = 0.06;
const MANA_REGEN_PER_S = 0.05;
const LIFE_REGEN_PER_S = 0.01;
/** Mana per millisecond of cast: a 2 s spell costs a fifth of the bar. */
const MANA_PER_CAST_MS = 1 / 10000;
const SAFE_FALL_M = 6;
const LIFE_PER_FALL_M = 0.04;

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/**
 * The player's life, mana, stamina and energy as 0..1 levels. Listeners hear only
 * whole-percent changes, so a full or idle player costs the HUD nothing.
 *
 * shortcut: life reaching zero has no consequence yet; add it with a death flow.
 */
export class PlayerVitals {
  constructor() {
    this.levels = { life: 1, mana: 1, stamina: 1, energy: 1 };
    this.published = { ...this.levels };
    this.listeners = new Set();
    this.fallPeakY = null;
  }

  /** @param {(levels: Record<string, number>) => void} listener @returns {() => void} */
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.levels);
    return () => this.listeners.delete(listener);
  }

  canCast(castMs) {
    return this.levels.mana >= castMs * MANA_PER_CAST_MS;
  }

  spendCast(castMs) {
    this.adjust('mana', -castMs * MANA_PER_CAST_MS);
    this.publish();
  }

  /**
   * One walking frame.
   * @param {number} deltaSeconds
   * @param {{ running: boolean, explorationBoost: boolean, grounded: boolean, footY: number, waterDepth?: number, harnessActive?: boolean }} status
   */
  update(deltaSeconds, status) {
    this.adjust('mana', MANA_REGEN_PER_S * deltaSeconds);
    this.adjust('life', LIFE_REGEN_PER_S * deltaSeconds);
    this.adjust('stamina', (status.running ? -RUN_STAMINA_DRAIN_PER_S : STAMINA_REGEN_PER_S) * deltaSeconds);
    this.adjust('energy', (status.explorationBoost ? -BOOST_ENERGY_DRAIN_PER_S : ENERGY_REGEN_PER_S) * deltaSeconds);
    this.trackFall(status);
    this.publish();
  }

  trackFall({ grounded, footY, waterDepth = 0, harnessActive = false }) {
    if (!grounded) {
      this.fallPeakY = Math.max(this.fallPeakY ?? footY, footY);
      return;
    }
    if (this.fallPeakY === null) return;
    const drop = this.fallPeakY - footY - SAFE_FALL_M;
    this.fallPeakY = null;
    // Water breaks the fall, and scripted perf walks must not change the bars.
    if (drop > 0 && waterDepth <= 0 && !harnessActive) this.adjust('life', -drop * LIFE_PER_FALL_M);
  }

  adjust(id, delta) {
    this.levels[id] = clamp01(this.levels[id] + delta);
  }

  publish() {
    let changed = false;
    for (const id of Object.keys(this.levels)) {
      if (Math.round(this.levels[id] * 100) === Math.round(this.published[id] * 100)) continue;
      this.published[id] = this.levels[id];
      changed = true;
    }
    if (!changed) return;
    for (const listener of this.listeners) listener(this.levels);
  }
}
