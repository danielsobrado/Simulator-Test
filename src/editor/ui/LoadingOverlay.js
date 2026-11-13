import './loadingOverlay.css';
import { STEP_STATES } from './LoadingTracker.js';
import { tickerLayout } from './loadingTicker.js';
import { openIris } from './loadingIris.js';

const WORDMARK = 'Drusniel World';
const TRAVELLER = Object.freeze({ name: 'Drusniel', title: 'Dark elf in the wilds' });
/** The donor's line glyph for Drusniel, on a 24px grid. */
const TRAVELLER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 20 19 4"/>'
  + '<path d="M19 4c-4 1-8 5-9 9"/><path d="M5 20c1-4 5-8 9-9"/><path d="M15 4h4v4"/></svg>';
/** Top and bottom of the wordmark's glyphs within its box, percent. */
const GLYPH_BAND = Object.freeze([18, 82]);
/** A beat at 100% so the ring visibly closes before the world is revealed. */
const COMPLETE_HOLD_MS = 450;

const STEP_MARK = {
  [STEP_STATES.PENDING]: '',
  [STEP_STATES.ACTIVE]: '',
  [STEP_STATES.DONE]: '✓',
  [STEP_STATES.FAILED]: '✕',
};

const MARKUP = `
  <div class="loading-art" aria-hidden="true">
    <img class="loading-art-image" alt="" decoding="async" src="/assets/ui/loading-art.webp">
    <div class="loading-art-scrim"></div>
  </div>
  <div class="loading-logo" aria-hidden="true">
    <span class="logo-outline">${WORDMARK}</span>
    <span class="logo-fill" data-role="logo-fill">${WORDMARK}</span>
  </div>
  <div class="loading-progress">
    <div class="loading-progress-track"><i class="loading-progress-bar" data-role="bar"></i></div>
    <div class="loading-row"><span data-role="status"></span><strong data-role="percent">0%</strong></div>
    <div class="loading-detail" data-role="detail"></div>
  </div>
  <section class="loading-card">
    <h2 class="loading-card__eyebrow" data-role="title"></h2>
    <p class="loading-card__subtitle" data-role="subtitle" hidden></p>
    <div class="loading-card__body">
      <span class="loading-card__icon">${TRAVELLER_ICON}</span>
      <span class="loading-card__who"><strong>${TRAVELLER.name}</strong><span>${TRAVELLER.title}</span></span>
      <span class="loading-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="loading-ring__track" cx="60" cy="60" r="52" pathLength="100"/>
          <circle class="loading-ring__fill" data-role="ring" cx="60" cy="60" r="52" pathLength="100"/>
        </svg>
        <span class="loading-ring__percent" data-role="ring-percent">0%</span>
      </span>
    </div>
    <ol class="loading-ticker" data-role="ticker" aria-hidden="true"></ol>
    <p class="loading-error" data-role="error" hidden></p>
  </section>
  <p class="loading-tip" data-role="tip" hidden></p>
`;

/**
 * The loading screen, after grass-test's: key art under a scrim, the wordmark
 * filling with light as the load runs, a thin progress line, and the traveller's
 * card — translucent glass holding the character and a percentage ring. Under the
 * card the stages run as a ticker: the active one holds the bottom row, finished
 * ones rise above it and fade as they climb (`loadingTicker.js`).
 *
 * Two presentations:
 *  - `cinematic` (boot, map import): the full screen, opening onto the world with
 *    the donor's iris when the load finishes.
 *  - `compact` (walk-mode streaming): the card alone over the live world, which
 *    the player is already standing in.
 *
 * A session's optional `theme` (entering or leaving a location) swaps the key art
 * and wordmark for that location's gradient backdrop, accent and lines.
 *
 * Input is never captured: boot keeps the editor usable and walk-mode streaming
 * must never trap the player behind a modal.
 */
export class LoadingOverlay {
  constructor(root) {
    this.element = document.createElement('div');
    this.element.className = 'loading-overlay';
    this.element.hidden = true;
    this.element.setAttribute('role', 'status');
    // The ticker changes fast; announcing every line would flood a screen reader.
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = MARKUP;
    root.append(this.element);
    const role = (name) => this.element.querySelector(`[data-role="${name}"]`);
    this.nodes = {
      title: role('title'),
      logoFill: role('logo-fill'),
      bar: role('bar'),
      status: role('status'),
      percent: role('percent'),
      detail: role('detail'),
      ring: role('ring'),
      ringPercent: role('ring-percent'),
      ticker: role('ticker'),
      error: role('error'),
      subtitle: role('subtitle'),
      tip: role('tip'),
    };
    const art = this.element.querySelector('.loading-art-image');
    art.addEventListener('load', () => this.element.classList.add('is-art-loaded'), { once: true });
    this.rendered = {};
    this.tickerSignature = null;
    this.leaving = null;
    this.wasOpen = false;
    this.lastState = null;
  }

  dispose() {
    this.#cancelLeave(); this.unsubscribe?.(); this.element.remove();
  }

  attach(tracker) {
    this.unsubscribe?.();
    this.unsubscribe = tracker.subscribe((state) => this.render(state));
    return this.unsubscribe;
  }

  /**
   * Writes `value` to a property only when it changed: the streaming source emits
   * every frame, and this screen is up precisely when the main thread is busiest.
   */
  #set(key, target, property, value) {
    if (this.rendered[key] === value) return;
    this.rendered[key] = value;
    target[property] = value;
  }

  /** `#set` for a custom property, which is removed rather than left empty when absent. */
  #setVar(name, value) {
    if (this.rendered[name] === value) return;
    this.rendered[name] = value;
    if (value) this.element.style.setProperty(name, value);
    else this.element.style.removeProperty(name);
  }

  /** A location's backdrop and lines; written every session so none outlives its own. */
  #renderTheme(theme) {
    this.#set('theme', this.element.dataset, 'theme', theme?.key ?? '');
    this.#setVar('--loading-theme-color', theme?.color ?? '');
    this.#setVar('--loading-theme-accent', theme?.accent ?? '');
    this.#set('subtitle', this.nodes.subtitle, 'textContent', theme?.subtitle ?? '');
    this.#set('subtitleHidden', this.nodes.subtitle, 'hidden', !theme?.subtitle);
    this.#set('tip', this.nodes.tip, 'textContent', theme?.tip ?? '');
    this.#set('tipHidden', this.nodes.tip, 'hidden', !theme?.tip);
  }

  render(state) {
    if (!state.open) {
      if (this.wasOpen) this.#leave();
      this.wasOpen = false;
      return;
    }
    this.#cancelLeave();
    this.wasOpen = true;
    this.lastState = state;
    this.element.hidden = false;
    this.#set('presentation', this.element.dataset, 'presentation', state.presentation ?? 'cinematic');
    this.#renderTheme(state.theme);
    this.#set('title', this.nodes.title, 'textContent', state.title ?? '');
    this.#setPercent(Math.round((state.ratio ?? 0) * 100));
    this.#set('status', this.nodes.status, 'textContent', state.activeLabel || state.title || '');
    this.#set('detail', this.nodes.detail, 'textContent', state.detail || '');
    this.#set('errorHidden', this.nodes.error, 'hidden', !state.error);
    this.#set('error', this.nodes.error, 'textContent', state.error ?? '');
    this.#set('failed', this.element.dataset, 'failed', state.error ? 'true' : 'false');
    this.#renderTicker(state.steps ?? []);
  }

  #setPercent(percent) {
    const clamped = Math.max(0, Math.min(100, percent));
    this.#set('percent', this.nodes.percent, 'textContent', `${clamped}%`);
    this.#set('ringPercent', this.nodes.ringPercent, 'textContent', `${clamped}%`);
    // pathLength="100" makes the dash offset the percentage itself.
    this.#set('ring', this.nodes.ring.style, 'strokeDashoffset', String(100 - clamped));
    this.#set('bar', this.nodes.bar.style, 'transform', `scaleX(${clamped / 100})`);
    // The wordmark fills from its baseline up. Its glyphs occupy roughly the
    // middle band of the box (cap height at `line-height: 1`), so the fill runs
    // across that band — a linear map over the whole box read empty until ~70%.
    const top = GLYPH_BAND[1] - (GLYPH_BAND[1] - GLYPH_BAND[0]) * (clamped / 100);
    this.#set('logo', this.nodes.logoFill.style, 'clipPath', `inset(${top.toFixed(1)}% 0 0 0)`);
  }

  #renderTicker(steps) {
    const signature = steps.map((step) => step.id).join('|');
    if (this.tickerSignature !== signature) {
      this.nodes.ticker.replaceChildren(...steps.map((step) => {
        const item = document.createElement('li');
        item.dataset.stepId = step.id;
        item.innerHTML = '<span class="loading-ticker__mark"></span><span class="loading-ticker__label"></span>';
        return item;
      }));
      this.tickerSignature = signature;
    }
    const layout = tickerLayout(steps);
    steps.forEach((step, index) => {
      const item = this.nodes.ticker.children[index];
      if (!item) return;
      const { row, opacity } = layout[index];
      this.#set(`state:${step.id}`, item.dataset, 'state', step.state);
      this.#set(`row:${step.id}`, item.style, 'transform', `translateY(${row * 100}%)`);
      this.#set(`opacity:${step.id}`, item.style, 'opacity', String(opacity));
      this.#set(`mark:${step.id}`, item.firstElementChild, 'textContent', STEP_MARK[step.state] ?? '');
      this.#set(
        `label:${step.id}`,
        item.lastElementChild,
        'textContent',
        step.units ? `${step.label} (${step.units.done}/${step.units.total})` : step.label,
      );
    });
  }

  /** The closing beat: the ring fills, flares, then the world is revealed. */
  #leave() {
    this.#cancelLeave();
    const steps = (this.lastState?.steps ?? []).map((step) => ({ ...step, state: STEP_STATES.DONE, units: null }));
    this.#setPercent(100);
    this.#renderTicker(steps);
    this.element.classList.add('is-ready');
    const cinematic = this.element.dataset.presentation !== 'compact';
    const leaving = { cancelled: false, timer: 0, iris: null };
    this.leaving = leaving;
    leaving.timer = setTimeout(async () => {
      if (leaving.cancelled) return;
      this.element.classList.add('is-leaving');
      if (cinematic) {
        leaving.iris = openIris(this.element);
        await leaving.iris.done;
      } else {
        await new Promise((resolve) => { leaving.timer = setTimeout(resolve, 320); });
      }
      if (leaving.cancelled) return;
      this.#hide();
    }, COMPLETE_HOLD_MS);
  }

  #cancelLeave() {
    if (!this.leaving) return;
    this.leaving.cancelled = true;
    clearTimeout(this.leaving.timer);
    this.leaving.iris?.cancel();
    this.leaving = null;
    this.element.classList.remove('is-ready', 'is-leaving');
    this.element.style.removeProperty('--iris');
  }

  #hide() {
    this.leaving = null;
    this.element.hidden = true;
    this.element.classList.remove('is-ready', 'is-leaving');
    this.element.style.removeProperty('--iris');
    this.rendered = {};
    this.tickerSignature = null;
    this.lastState = null;
  }
}
