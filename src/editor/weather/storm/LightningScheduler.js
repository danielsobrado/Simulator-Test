import { Rng } from '../../_clod_shims/seed.js';

/**
 * When and where the weather's lightning strikes (storm plan §4.3). Pure CPU,
 * deterministic from the seed and the sequence of `step` calls.
 *
 * API:
 * - `step(deltaSeconds, lightning)` advances the storm clock. `lightning` is
 *   `StormState.frame.lightning` (0..1; 0 emits nothing). Returns the sky flash
 *   0..1 for this frame (also on `flash`).
 * - `subscribe(listener)` → unsubscribe. `listener(event)` runs once per strike,
 *   inside `step`, with a frozen event:
 *   `{ time, bearing, distance, kind }` — `time` storm-clock seconds, `bearing`
 *   radians in the world XZ plane (direction `x = cos, z = sin` from the viewer),
 *   `distance` metres (400–8000, log-uniform), `kind` `'sheet'` (in-cloud) or
 *   `'bolt'`. Thunder belongs `distance / 343` s after `time`.
 * - `bolt` / `boltFlash`: the latest bolt event and its own 0..1 envelope, for
 *   the visible bolt (StormLightningSystem).
 */
const MAX_DISTANCE = 8000;
const MIN_DISTANCE = 400;
const FLASH_SECONDS = 0.25;

/** Double pulse, ~60–250 ms: the shape the old shader strikes used. */
export function flashEnvelope(t) {
  if (t < 0 || t > FLASH_SECONDS) return 0;
  const a = 1 - smoothstep(0, 0.09, t);
  const b = (1 - smoothstep(0, 0.04, Math.abs(t - 0.14))) * 0.48;
  return Math.max(a, b);
}

/** Strikes per minute: plan table 4.3, ~0.5 at heavy (lightning ≈ 0.65), 3 at a full storm. */
export function strikesPerMinute(lightning) {
  return 3 * Math.min(1, Math.max(0, lightning)) ** 4;
}

export class LightningScheduler {
  time = 0;
  flash = 0;
  bolt = null;
  boltFlash = 0;
  #rng;
  #hazard = 0;
  #threshold;
  #active = [];
  #listeners = new Set();

  constructor({ seed = 0x1a6e7b01 } = {}) {
    this.#rng = new Rng(seed);
    this.#threshold = this.#nextThreshold();
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  step(deltaSeconds, lightning) {
    const dt = Math.max(0, deltaSeconds || 0);
    this.time += dt;
    // Non-homogeneous Poisson process: a strike each time the integrated rate
    // crosses an exponential draw, so the rate can ease without bunching.
    this.#hazard += (strikesPerMinute(lightning) / 60) * dt;
    while (this.#hazard >= this.#threshold) {
      this.#hazard -= this.#threshold;
      this.#threshold = this.#nextThreshold();
      this.#emit(Math.min(1, Math.max(0, lightning)));
    }
    this.#active = this.#active.filter((event) => this.time - event.time <= FLASH_SECONDS);
    let flash = 0;
    for (const event of this.#active) {
      flash = Math.max(flash, flashEnvelope(this.time - event.time) / (1 + event.distance / 2000));
    }
    this.flash = flash;
    this.boltFlash = this.bolt ? flashEnvelope(this.time - this.bolt.time) : 0;
    return flash;
  }

  #nextThreshold() {
    return -Math.log(1 - this.#rng.float());
  }

  #emit(lightning) {
    const rng = this.#rng;
    const nearest = Math.max(MIN_DISTANCE, 1500 + (300 - 1500) * lightning);
    const distance = nearest * (MAX_DISTANCE / nearest) ** rng.float();
    const bearing = rng.range(0, Math.PI * 2);
    const kind = rng.float() < 0.1 + 0.1 * lightning ? 'bolt' : 'sheet';
    const event = Object.freeze({ time: this.time, bearing, distance, kind });
    this.#active.push(event);
    if (kind === 'bolt') this.bolt = event;
    for (const listener of this.#listeners) listener(event);
  }
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
