/**
 * Progress model for the loading overlay.
 *
 * Deliberately DOM-free: the overlay is a view over this, and the phases that
 * report into it (boot, map import, walk-mode streaming) run in very different
 * places. Keeping the state here means none of them has to know what the overlay
 * looks like, and the sequencing can be tested without a browser.
 *
 * Two kinds of progress are mixed, because the three flows genuinely differ:
 *
 * - **Steps** are named units of work declared up front. They give the bar a
 *   denominator and the panel its list, and they are what makes boot legible —
 *   "Tree impostors" means something to a reader, "43%" does not.
 * - **Units** are sub-progress inside the active step, for work whose size is only
 *   known once it starts: chunks streaming in, bytes of a map arriving. A step
 *   with units contributes fractionally, so the bar keeps moving through a long
 *   step instead of sitting still and looking hung.
 *
 * A step with neither is still fine — it just contributes nothing until it
 * completes, which is the honest representation of work we cannot measure.
 */

const PENDING = 'pending';
const ACTIVE = 'active';
const DONE = 'done';
const FAILED = 'failed';

export const STEP_STATES = Object.freeze({ PENDING, ACTIVE, DONE, FAILED });

function normalizeSteps(steps) {
  return steps.map((step, index) => {
    const id = typeof step === 'string' ? step : step.id;
    const label = typeof step === 'string' ? step : (step.label ?? step.id);
    if (!id) throw new Error(`Loading step ${index} has no id.`);
    return { id, label, state: PENDING, units: null };
  });
}

export class LoadingSession {
  constructor(tracker, { title, steps = [], detail = '' }) {
    this.tracker = tracker;
    this.title = title;
    this.steps = normalizeSteps(steps);
    this.detailText = detail;
    this.error = null;
    this.closed = false;
    this.startedAt = tracker.clock();
    this.endedAt = null;
  }

  #find(id) {
    const step = this.steps.find((candidate) => candidate.id === id);
    if (!step) throw new Error(`Unknown loading step: ${id}.`);
    return step;
  }

  /**
   * Marks a step active. Any earlier step still pending is completed, so a flow
   * that skips work — a cached map, an import with no settings to apply — does not
   * strand a half-finished bar behind it.
   */
  start(id, detail = '') {
    const target = this.#find(id);
    for (const step of this.steps) {
      if (step === target) break;
      if (step.state === PENDING || step.state === ACTIVE) step.state = DONE;
    }
    target.state = ACTIVE;
    if (detail) this.detailText = detail;
    this.tracker.emit();
    return this;
  }

  /** Free-text line under the bar: the file, chunk or record being worked on. */
  detail(text) {
    this.detailText = text ?? '';
    this.tracker.emit();
    return this;
  }

  /** Sub-progress within the active step. Pass `total` 0 to clear it. */
  units(done, total) {
    const active = this.steps.find((step) => step.state === ACTIVE);
    if (!active) return this;
    active.units = total > 0
      ? { done: Math.max(0, Math.min(done, total)), total }
      : null;
    this.tracker.emit();
    return this;
  }

  complete(id) {
    const step = this.#find(id);
    step.state = DONE;
    step.units = null;
    this.tracker.emit();
    return this;
  }

  /**
   * Records a failure without closing: a map that will not load still leaves a
   * usable editor behind, and the reader needs to see which step died.
   */
  fail(error) {
    const active = this.steps.find((step) => step.state === ACTIVE);
    if (active) {
      active.state = FAILED;
      active.units = null;
    }
    this.error = String(error?.message ?? error ?? 'Loading failed.');
    this.tracker.emit();
    return this;
  }

  finish() {
    if (this.closed) return this;
    for (const step of this.steps) {
      if (step.state === PENDING || step.state === ACTIVE) step.state = DONE;
    }
    this.closed = true;
    this.endedAt = this.tracker.clock();
    this.tracker.close(this);
    return this;
  }

  /** Fraction complete in [0, 1], counting a units-bearing step fractionally. */
  get ratio() {
    if (this.steps.length === 0) return this.closed ? 1 : 0;
    let done = 0;
    for (const step of this.steps) {
      if (step.state === DONE || step.state === FAILED) done += 1;
      else if (step.state === ACTIVE && step.units) {
        done += step.units.done / step.units.total;
      }
    }
    return Math.max(0, Math.min(1, done / this.steps.length));
  }

  getState() {
    const active = this.steps.find((step) => step.state === ACTIVE) ?? null;
    return {
      title: this.title,
      steps: this.steps.map((step) => ({ ...step, units: step.units ? { ...step.units } : null })),
      activeLabel: active?.label ?? '',
      detail: this.detailText,
      ratio: this.ratio,
      error: this.error,
      closed: this.closed,
      elapsedMs: (this.endedAt ?? this.tracker.clock()) - this.startedAt,
    };
  }
}

export class LoadingTracker {
  constructor({ clock = () => performance.now() } = {}) {
    this.clock = clock;
    this.session = null;
    this.listeners = new Set();
  }

  /**
   * Opens a session. A second `begin` while one is open replaces it rather than
   * queueing — these flows are user-initiated and the newest one is the one being
   * waited on, so showing the stale phase would be actively misleading.
   */
  begin(options) {
    this.session = new LoadingSession(this, options);
    this.emit();
    return this.session;
  }

  close(session) {
    if (this.session !== session) return;
    this.session = null;
    this.emit();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error('Loading tracker listener failed.', error);
      }
    }
  }

  getState() {
    if (!this.session) return { open: false };
    return { open: true, ...this.session.getState() };
  }
}
