import { CONFIGURED_SKY_PRESET, DEFAULT_SKY_PRESET, SKY_PRESETS } from './SkyPresets.js';
import { mixSkyLooks, overcastSkyLook, resolveSkyLook } from './SkyLook.js';
import { bogMurkLook, regionalSkyLook } from './regionalSkyLook.js';
import { NEUTRAL_AIR, NEUTRAL_SKY_REGION, SKY_CLIMATES } from './skyRegionClimate.js';
import { snowCountryLook } from './snowCountryLook.js';
import { stormAirLook } from './stormAirLook.js';

/** Seconds a change of time of day takes to settle. */
const PRESET_TRANSITION_SECONDS = 2.5;
/** Overcast units per second: rain clouds gather and clear over a few seconds. */
const OVERCAST_RATE = 0.25;
/** Snow-country units per second: the air changes over a few seconds' walk. */
const SNOW_COUNTRY_RATE = 0.15;
/** Region units per second: a new country's air arrives over ten-odd seconds of travel. */
const REGION_RATE = 0.08;
const PERSONALITY_KEYS = Object.freeze(['haze', 'warmth', 'cloudiness', 'mist', 'cloudForm']);
const AIR_KEYS = Object.freeze(['moisture', 'temperature']);

function approach(value, target, maximumStep) {
  const delta = target - value;
  return value + Math.sign(delta) * Math.min(Math.abs(delta), maximumStep);
}

function cloneRegion(region) {
  return {
    weights: { ...region.weights },
    personality: { ...NEUTRAL_SKY_REGION.personality, ...region.personality },
    air: { ...NEUTRAL_AIR, ...region.air },
  };
}

/** How far a preset transition shows at linear `progress` (0..1). */
function easeTransition(progress) {
  return progress * progress * (3 - 2 * progress);
}

/**
 * Chooses the sky's look: a time-of-day preset, eased into over a couple of
 * seconds, given the air of the region below (regionalSkyLook), greyed by the
 * weather's overcast and cooled in snow country. The
 * sky is written only while something is changing, so capture tools that set
 * the lights directly keep their settings.
 */
/** How overcast a bog's own sky is (0..1), squared on its wetland weight. */
const BOG_OVERCAST = 0.8;

export class SkyLookController {
  /**
   * @param {object} options
   * @param {{ config: object, applyLook: Function }} options.skyView
   * @param {string} [options.preset]
   * @param {(look: object) => void} [options.onLook] after each applied look
   */
  constructor({ skyView, preset = DEFAULT_SKY_PRESET, onLook = null }) {
    this.skyView = skyView;
    this.onLook = onLook;
    this.preset = SKY_PRESETS[preset] ? preset : DEFAULT_SKY_PRESET;
    this.from = resolveSkyLook(skyView.config.sky, this.preset);
    this.to = this.from;
    this.progress = 1;
    this.overcast = 0;
    this.overcastTarget = 0;
    /** StormState's eased storm and snow share; already eased, so taken as given. */
    this.weather = { storm: 0, snowShare: 0 };
    this.snowCountry = 0;
    this.snowCountryTarget = 0;
    this.region = cloneRegion(NEUTRAL_SKY_REGION);
    this.regionTarget = NEUTRAL_SKY_REGION;
    this.dirty = this.preset !== CONFIGURED_SKY_PRESET;
    this.current = this.from;
  }

  get night() {
    return this.current.night;
  }

  /**
   * The running clock's time of day: the presets it lies between, blended by
   * their weights (DayNightCycle.weights), so the sun and light move on
   * continuously instead of stepping from one preset to the next. Written only
   * when the blend has moved.
   *
   * @param {Record<string, number>} weights preset name → weight, summing to 1
   */
  setTimeBlend(weights) {
    const active = Object.entries(weights ?? {})
      .filter(([name, weight]) => SKY_PRESETS[name] && weight > 1e-6)
      .sort((a, b) => b[1] - a[1]);
    if (active.length === 0) return;
    const key = active.map(([name, weight]) => `${name}:${weight.toFixed(4)}`).join('|');
    if (key === this.blendKey) return;
    this.blendKey = key;
    const [[first, firstWeight], second] = active;
    let look = this.presetLook(first);
    if (second) look = mixSkyLooks(look, this.presetLook(second[0]), second[1] / (firstWeight + second[1]));
    this.preset = first;
    this.from = look;
    this.to = look;
    this.progress = 1;
    this.dirty = true;
  }

  presetLook(name) {
    this.presetLooks ??= new Map();
    if (!this.presetLooks.has(name)) this.presetLooks.set(name, resolveSkyLook(this.skyView.config.sky, name));
    return this.presetLooks.get(name);
  }

  setPreset(name) {
    if (!SKY_PRESETS[name] || name === this.preset) return;
    this.blendKey = null;
    this.preset = name;
    // Start from the look on screen, which is the eased mix: re-basing at the
    // linear progress would jump when a transition is interrupted mid-way.
    this.from = mixSkyLooks(this.from, this.to, easeTransition(this.progress));
    this.to = resolveSkyLook(this.skyView.config.sky, name);
    this.progress = 0;
  }

  /** @param {number} amount 0 clear … 1 full overcast */
  setOvercast(amount) {
    this.overcastTarget = Math.max(0, Math.min(1, amount));
  }

  /**
   * The storm frame (StormState): its cloud is the overcast; the storm value
   * darkens past full cover and closes the fog.
   * @param {{ cloud: number, storm: number, snowShare: number }} frame
   */
  setStorm(frame) {
    this.setOvercast(frame?.cloud ?? 0);
    const storm = Math.max(0, Math.min(1, frame?.storm ?? 0));
    const snowShare = Math.max(0, Math.min(1, frame?.snowShare ?? 0));
    if (storm === this.weather.storm && snowShare === this.weather.snowShare) return;
    this.weather = { storm, snowShare };
    this.dirty = true;
  }

  /** @param {number} weight 0 lowland … 1 deep in snow country (SnowCountryWeight) */
  setSnowCountry(weight) {
    this.snowCountryTarget = Math.max(0, Math.min(1, weight));
  }

  /** @param {{weights: object, personality: object}} region from SkyRegionSampler */
  setRegion(region) {
    if (!region || region === this.regionTarget) return;
    this.regionTarget = region;
    if (region.jump) {
      this.region = cloneRegion(region);
      this.dirty = true;
    }
  }

  /** Ease the region toward its target; true while it is still moving. */
  stepRegion(step) {
    let moved = false;
    const limit = step * REGION_RATE;
    for (const climate of SKY_CLIMATES) {
      const from = this.region.weights[climate];
      const to = this.regionTarget.weights[climate] ?? 0;
      if (from !== to) {
        this.region.weights[climate] = approach(from, to, limit);
        moved = true;
      }
    }
    for (const key of PERSONALITY_KEYS) {
      const from = this.region.personality[key];
      const to = this.regionTarget.personality[key] ?? 0;
      if (from !== to) {
        this.region.personality[key] = approach(from, to, limit);
        moved = true;
      }
    }
    for (const key of AIR_KEYS) {
      const from = this.region.air[key];
      const to = this.regionTarget.air?.[key] ?? NEUTRAL_AIR[key];
      if (from !== to) {
        this.region.air[key] = approach(from, to, limit);
        moved = true;
      }
    }
    return moved;
  }

  /** @param {number} dt seconds */
  update(dt) {
    const step = Math.max(0, Math.min(dt, 0.25));
    let changed = this.dirty;
    this.dirty = false;
    if (this.progress < 1) {
      this.progress = Math.min(1, this.progress + step / PRESET_TRANSITION_SECONDS);
      changed = true;
    }
    if (this.overcast !== this.overcastTarget) {
      this.overcast = approach(this.overcast, this.overcastTarget, step * OVERCAST_RATE);
      changed = true;
    }
    if (this.snowCountry !== this.snowCountryTarget) {
      this.snowCountry = approach(this.snowCountry, this.snowCountryTarget, step * SNOW_COUNTRY_RATE);
      changed = true;
    }
    if (this.stepRegion(step)) changed = true;
    if (!changed) return false;
    const timeOfDay = mixSkyLooks(this.from, this.to, easeTransition(this.progress));
    // A bog wears its own low lid whatever the weather does; rain only adds to it.
    const bogOvercast = BOG_OVERCAST * (this.region.weights.wetland ?? 0) ** 2;
    this.current = stormAirLook(bogMurkLook(snowCountryLook(
      overcastSkyLook(regionalSkyLook(timeOfDay, this.region), Math.max(this.overcast, bogOvercast), this.weather.storm),
      this.snowCountry,
    ), this.region.weights.wetland ?? 0), this.weather, this.skyView.baseFogDensity ?? this.skyView.config.sky.fogDensity);
    this.skyView.applyLook(this.current);
    this.onLook?.(this.current);
    return true;
  }
}
