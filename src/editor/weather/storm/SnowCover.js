/**
 * Snow a storm leaves on the ground, 0..1 (docs/plans/storm-weather-plan-2026-11-08.md
 * §5.2). It builds up under `stormFrame.snow` over minutes and melts slowly once
 * the fall stops — but only outside snow country, where snow lies for good.
 * Pure: no three.js; main writes `value` into `stormSnowCoverUniform`.
 */

export const DEFAULT_SNOW_COVER = Object.freeze({
  /** Seconds of full snowfall to whiten bare ground. */
  buildSeconds: 360,
  /** Seconds for full storm snow to melt once the fall stops. */
  meltSeconds: 600,
  /** Snow share (StormState frame) at or above which nothing melts. */
  holdShare: 0.3,
});

export function resolveSnowCoverConfig(source = {}) {
  const config = { ...DEFAULT_SNOW_COVER, ...source };
  for (const key of Object.keys(DEFAULT_SNOW_COVER)) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      throw new Error(`Invalid editor configuration: stylizedSurface.snowCover.${key} must be a positive number.`);
    }
  }
  return Object.freeze(config);
}

export class SnowCover {
  value = 0;

  constructor(config = DEFAULT_SNOW_COVER) {
    this.config = config;
  }

  /**
   * @param {number} dt seconds
   * @param {number} snow this frame's snowfall (StormState frame `snow`; above 1 is a QA gain)
   * @param {number} snowShare the climate's share of snow; at `holdShare` and above, snow stays
   */
  update(dt, snow, snowShare = 0) {
    if (!(dt > 0) || !Number.isFinite(dt) || !Number.isFinite(snow)) return this.value;
    const goal = Math.max(0, Math.min(1, snow));
    if (this.value < goal) this.value = Math.min(goal, this.value + dt / this.config.buildSeconds);
    else if (snowShare < this.config.holdShare) this.value = Math.max(goal, this.value - dt / this.config.meltSeconds);
    return this.value;
  }

  /** Steady state for this snowfall at once: snapped storms (QA captures). */
  snap(snow) {
    if (Number.isFinite(snow)) this.value = Math.max(0, Math.min(1, snow));
    return this.value;
  }
}
