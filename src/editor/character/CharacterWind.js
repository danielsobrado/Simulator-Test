/**
 * The wind the garments feel.
 *
 * A thin adapter over the weather system rather than a reader of it: the solver
 * takes `{ sample(out, seconds) }` so it can be driven from a fixed vector in a
 * headless test, and so the weather panel stays the single owner of what the
 * wind is actually doing.
 *
 * There is always *some* wind, even with weather switched off. A robe that is
 * perfectly still reads as a statue, and the cost of the ambient breeze is three
 * sines a frame.
 */

/** Field wind at full weather intensity, m/s. */
const WIND_SCALE = 3.2;
/** What blows when the weather system is off or absent. */
const AMBIENT = 0.35;

export class CharacterWind {
  /**
   * @param {() => ({ enabled: boolean, intensity: number, windX: number, windZ: number } | null)}
   *   [getSettings] the live weather settings, if the weather system is present
   */
  constructor(getSettings = null) {
    this.getSettings = getSettings;
  }

  /**
   * @param {Float32Array} out three floats, m/s
   * @param {number} seconds
   */
  sample(out, seconds) {
    const settings = this.getSettings?.() ?? null;
    const active = settings?.enabled === true;
    const strength = WIND_SCALE * (AMBIENT + (active ? (settings.intensity ?? 0) : 0));
    // A light default breeze off the north-west, so a garment has a direction to
    // hang in before anyone touches the weather panel.
    const dirX = active ? (settings.windX ?? -0.42) : -0.42;
    const dirZ = active ? (settings.windZ ?? 0.18) : 0.18;

    // Gusts, so a standing figure's robe is never dead still.
    const gust = 1
      + 0.35 * Math.sin(seconds * 0.7)
      + 0.18 * Math.sin(seconds * 2.3 + 1.1);

    out[0] = dirX * strength * gust;
    out[1] = 0.35 * Math.sin(seconds * 1.9);
    out[2] = dirZ * strength * gust;
  }
}
