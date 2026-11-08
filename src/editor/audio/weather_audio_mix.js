/**
 * Pure maths of the weather sound (storm plan §6): which storm beds play how
 * loud, how shelter muffles the weather sub-bus, and how a lightning strike's
 * distance becomes the delay, loudness and darkness of its thunder.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
/** Interpolate frequencies on a log scale, which is how the ear hears them. */
const logLerp = (from, to, t) => from * (to / from) ** clamp01(t);

export const SPEED_OF_SOUND = 343;
/** Strikes nearer than this get a crack; further ones only rumble. */
export const NEAR_THUNDER_METERS = 800;
export const OPEN_CUTOFF_HZ = 18000;

/**
 * Storm bed weights 0..1 from the eased storm channels and the listener's
 * shelter. Under a roof the roof-rain bed replaces the ground rain.
 *
 * @param {{ rain: number, snow: number, wind: number }} storm
 * @param {number} roofed 0..1
 */
export function stormBedWeights({ rain = 0, snow = 0, wind = 0 }, roofed = 0) {
  const open = 1 - clamp01(roofed);
  return {
    rainStorm: smoothstep(0.85, 1, rain) * open,
    rainRoof: clamp01(rain) * clamp01(roofed),
    windStrong: smoothstep(0.5, 0.9, wind),
    blizzard: clamp01(snow) * smoothstep(0.6, 1, wind),
  };
}

/** How much the ground-rain beds keep under a roof. */
export const groundRainShare = (roofed) => 1 - clamp01(roofed);

/**
 * Lowpass cutoff and gain of the weather sub-bus. A roof takes it to 900 Hz
 * and −8 dB; a canopy only dulls it, to 4 kHz.
 */
export function shelterMuffle(roofed = 0, canopy = 0) {
  const cutoff = Math.min(logLerp(OPEN_CUTOFF_HZ, 900, roofed), logLerp(OPEN_CUTOFF_HZ, 4000, canopy));
  return { cutoff, gain: 10 ** (-8 * clamp01(roofed) / 20) };
}

/**
 * Thunder for a strike `distance` metres away: heard `d / 343` s after the
 * flash, quieter with distance, and darker — far thunder is rumble only.
 */
export function thunderVoice(distance) {
  const d = Math.max(0, distance);
  const far = clamp01((Math.log(Math.max(d, 300)) - Math.log(300)) / (Math.log(4000) - Math.log(300)));
  return {
    delay: d / SPEED_OF_SOUND,
    gain: Math.max(0.08, Math.min(1, 1 / (1 + d / 600))),
    cutoff: logLerp(8000, 250, far),
    near: d < NEAR_THUNDER_METERS,
  };
}

/** Gust swells: armed below `rearm`, fired when the gust rises through `fire`. */
export class GustTrigger {
  constructor({ fire = 0.55, rearm = 0.35, minSeconds = 2.5 } = {}) {
    Object.assign(this, { fire, rearm, minSeconds });
    this.armed = true;
    this.since = Infinity;
  }

  /** @returns {boolean} whether a swell starts this frame */
  update(gust, dt) {
    this.since += dt;
    if (gust < this.rearm) this.armed = true;
    if (!this.armed || gust < this.fire || this.since < this.minSeconds) return false;
    this.armed = false;
    this.since = 0;
    return true;
  }
}
