import { HUD_PHASE } from './hudState.js';

const VITALS = Object.freeze([
  { id: 'life', label: 'Life' },
  { id: 'mana', label: 'Mana' },
  { id: 'stamina', label: 'Stamina' },
  { id: 'energy', label: 'Energy' },
]);
const LOW_PERCENT = 25;

/**
 * The vitals under the spell dock: horizontal life and mana bars, with thin
 * stamina and energy bars beneath them.
 *
 * shortcut: nothing in the game tracks these yet, so they sit full; call `set`
 * from the system that introduces them.
 */
export class HudVitals {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'hud-vitals';
    this.element.hidden = true;

    this.bars = new Map(VITALS.map(({ id, label }) => {
      const bar = document.createElement('div');
      bar.className = `hud-vital hud-vital--${id}`;
      bar.setAttribute('role', 'meter');
      bar.setAttribute('aria-label', label);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.append(document.createElement('i'));
      this.element.append(bar);
      return [id, bar];
    }));
    for (const { id } of VITALS) this.set(id, 1);
  }

  render(phase) {
    this.element.hidden = phase !== HUD_PHASE.walking;
  }

  /** @param {'mana' | 'stamina' | 'life' | 'energy'} id @param {number} level 0..1 */
  set(id, level) {
    const percent = Math.round(Math.min(1, Math.max(0, level)) * 100);
    const bar = this.bars.get(id);
    bar.style.setProperty('--level', `${percent}%`);
    bar.setAttribute('aria-valuenow', String(percent));
    bar.dataset.value = String(percent);
    bar.classList.toggle('is-low', percent <= LOW_PERCENT);
  }

  dispose() {
    this.element.remove();
  }
}
