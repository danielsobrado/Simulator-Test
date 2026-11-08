/** Seconds for a bed to cover most of the way to its target level. */
export const FADE_SECONDS = 1.6;

/** Ease a gain toward a target, frame-rate independent. */
export function fadeGain(param, target, dt, seconds = FADE_SECONDS) {
  param.value += (target - param.value) * (1 - Math.exp(-dt * 3 / seconds));
}

/**
 * Looping beds by name, each faded toward `weight × volume`. A bed's loop is
 * started the first time it is asked to be heard, so beds nobody hears cost
 * nothing. Keyed like a Map: `get(name)` is the bed's `{ source, gain }`.
 */
export class BedSet extends Map {
  /**
   * @param {import('./sample_bank.js').SampleBank} bank
   * @param {Record<string, string>} paths bank path by bed name
   * @param {Record<string, number>} volumes full-weight gain by bed name
   */
  constructor(bank, paths, volumes) {
    super();
    this.bank = bank;
    this.paths = paths;
    this.volumes = volumes;
  }

  update(weights, destination, dt) {
    for (const [name, path] of Object.entries(this.paths)) {
      const target = (weights[name] ?? 0) * this.volumes[name];
      let voice = this.get(name);
      if (!voice) {
        if (target <= 0.001) continue;
        voice = this.bank.loop(path, destination);
        if (!voice) continue;
        this.set(name, voice);
      }
      fadeGain(voice.gain.gain, target, dt);
    }
  }

  dispose() {
    for (const voice of this.values()) {
      try { voice.source.stop(); } catch { /* already stopped */ }
    }
    this.clear();
  }
}
