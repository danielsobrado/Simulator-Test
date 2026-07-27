import './loadingOverlay.css';
import { STEP_STATES } from './LoadingTracker.js';

const STATE_MARK = {
  [STEP_STATES.PENDING]: '·',
  [STEP_STATES.ACTIVE]: '›',
  [STEP_STATES.DONE]: '✓',
  [STEP_STATES.FAILED]: '✕',
};

/**
 * Renders a `LoadingTracker` as a centred panel with a bar, the step list and a
 * detail line.
 *
 * The overlay never blocks input by itself — `pointer-events` stays off except on
 * the dismiss control — because two of the three flows it covers keep the editor
 * usable while they run. Walk-mode streaming in particular must not trap the
 * player behind a modal while the world fills in around them.
 */
export class LoadingOverlay {
  constructor(root) {
    this.element = document.createElement('div');
    this.element.className = 'loading-overlay';
    this.element.hidden = true;
    this.element.setAttribute('role', 'status');
    // The step list changes fast; announcing every line would flood a screen
    // reader. The title and detail carry the meaning, so only they are polite.
    this.element.setAttribute('aria-live', 'polite');
    this.element.innerHTML = `
      <div class="loading-panel">
        <div class="loading-heading">
          <h2 data-role="loading-title">Loading</h2>
          <span class="loading-percent" data-role="loading-percent">0%</span>
        </div>
        <div class="loading-bar"><div class="loading-bar-fill" data-role="loading-fill"></div></div>
        <p class="loading-detail" data-role="loading-detail"></p>
        <ol class="loading-steps" data-role="loading-steps" aria-hidden="true"></ol>
        <p class="loading-error" data-role="loading-error" hidden></p>
      </div>
    `;
    root.append(this.element);
    this.title = this.element.querySelector('[data-role="loading-title"]');
    this.percent = this.element.querySelector('[data-role="loading-percent"]');
    this.fill = this.element.querySelector('[data-role="loading-fill"]');
    this.detail = this.element.querySelector('[data-role="loading-detail"]');
    this.stepList = this.element.querySelector('[data-role="loading-steps"]');
    this.errorLine = this.element.querySelector('[data-role="loading-error"]');
    this.renderedSteps = null;
    this.rendered = {};
  }

  attach(tracker) {
    return tracker.subscribe((state) => this.render(state));
  }

  /**
   * Writes `value` to a property only when it changed.
   *
   * The streaming source emits every frame, and this panel is on screen precisely
   * when the main thread is busiest. Assigning identical text and identical widths
   * 144 times a second is layout and paint work charged against the load it is
   * supposed to be reporting on.
   */
  #set(key, target, property, value) {
    if (this.rendered[key] === value) return;
    this.rendered[key] = value;
    target[property] = value;
  }

  render(state) {
    if (!state.open) {
      this.element.hidden = true;
      this.renderedSteps = null;
      this.rendered = {};
      return;
    }
    this.element.hidden = false;
    this.#set('title', this.title, 'textContent', state.title);
    // Rounded first: the bar is 420 px wide, so sub-percent changes cannot move it
    // by a pixel and only exist to dirty the compositor.
    const percent = Math.round(state.ratio * 100);
    this.#set('percent', this.percent, 'textContent', `${percent}%`);
    this.#set('fill', this.fill.style, 'width', `${percent}%`);
    // The active step names the phase; the detail names the individual file or
    // chunk. Showing the phase when there is no detail keeps the line from
    // flickering empty between items.
    this.#set('detail', this.detail, 'textContent', state.detail || state.activeLabel || '');
    this.#set('errorHidden', this.errorLine, 'hidden', !state.error);
    this.#set('error', this.errorLine, 'textContent', state.error ?? '');

    // Rebuilding the list every emit would thrash the DOM at streaming rates, so
    // the structure is built once per session and only the changed marks update.
    const signature = state.steps.map((step) => step.id).join('|');
    if (this.renderedSteps !== signature) {
      this.stepList.replaceChildren(...state.steps.map((step) => {
        const item = document.createElement('li');
        item.dataset.stepId = step.id;
        item.innerHTML = '<span class="loading-step-mark"></span><span class="loading-step-label"></span>';
        item.querySelector('.loading-step-label').textContent = step.label;
        return item;
      }));
      this.renderedSteps = signature;
    }
    for (const step of state.steps) {
      const item = this.stepList.querySelector(`[data-step-id="${CSS.escape(step.id)}"]`);
      if (!item) continue;
      this.#set(`state:${step.id}`, item.dataset, 'state', step.state);
      this.#set(
        `mark:${step.id}`,
        item.querySelector('.loading-step-mark'),
        'textContent',
        STATE_MARK[step.state] ?? '·',
      );
      this.#set(
        `label:${step.id}`,
        item.querySelector('.loading-step-label'),
        'textContent',
        step.units ? `${step.label} (${step.units.done}/${step.units.total})` : step.label,
      );
    }
  }
}
