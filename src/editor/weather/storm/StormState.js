/**
 * One storm value S ∈ [0, 1] that every weather consumer reads, eased so the
 * weather builds and breaks like a front instead of cutting between modes
 * (docs/plans/storm-weather-plan-2026-11-08.md §2). Pure: no three.js.
 *
 * Levels are keys on S: clear 0, light 0.25, moderate 0.5, heavy 0.75, storm 1.
 * Channels lag S in the order cloud → wind → precipitation, so the sky darkens
 * before the first drop and clears last.
 */
import { PRECIP_START } from './stormCurves.js';

/** Approach time constant (s) and rate limits (S per second) of §2.2. */
const APPROACH_TAU = 8;
const RISE_RATE = 1 / 90;
const FALL_RATE = 1 / 150;
const CLOUD_TAU = 20;
const WIND_TAU = 12;
const PRECIP_TAU = 10;
const CHANNEL_EPSILON = 1e-3;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/**
 * What the UI's weather mode asks of the storm. `kind` forces rain or snow
 * (an explicit mode); `auto` leaves it to the climate. `cloud` and `wind` are
 * floors for the dry modes; only `storm` brings `thunder`. `gain` keeps intensities above 1 (QA captures)
 * denser than a full storm, as they were before the ladder.
 */
export function stormTargetForSettings(settings, enabled = true) {
  const mode = enabled ? settings?.weatherMode : 'off';
  const intensity = Math.max(0, finite(settings?.weatherIntensity, 0));
  const level = Math.min(1, intensity);
  const target = { storm: 0, cloud: 0, wind: 0, kind: 'auto', thunder: false, gain: Math.max(1, intensity) };
  if (mode === 'rain') Object.assign(target, { storm: level, kind: 'rain' });
  else if (mode === 'snow') Object.assign(target, { storm: level, kind: 'snow' });
  else if (mode === 'storm') Object.assign(target, { storm: level, thunder: true });
  else if (mode === 'overcast') target.cloud = level;
  // A sandstorm's dust is its own system; the sky only dims under it.
  else if (mode === 'sandstorm') target.cloud = level * 0.4;
  else if (mode === 'wind') target.wind = level;
  return target;
}

/**
 * `?storm=<0..1>&stormSnap=1&stormKind=rain|snow` for captures and perf runs.
 * @returns {{ storm: number, kind: string, snap: boolean } | null}
 */
export function readStormOverride(search) {
  const params = new URLSearchParams(search ?? '');
  if (!params.has('storm')) return null;
  const kind = params.get('stormKind');
  return {
    storm: clamp01(finite(params.get('storm'), 0)),
    kind: kind === 'rain' || kind === 'snow' ? kind : 'auto',
    snap: params.get('stormSnap') === '1',
  };
}

export class StormState {
  storm = 0;
  cloud = 0;
  wind = 0;
  precip = 0;
  snowShare = 0;
  target = stormTargetForSettings(null);
  /** The frozen per-frame view every consumer reads. */
  frame = StormState.emptyFrame();

  static emptyFrame() {
    return Object.freeze({ storm: 0, cloud: 0, wind: 0, precip: 0, rain: 0, snow: 0, lightning: 0, snowShare: 0, gain: 1 });
  }

  /** @param {ReturnType<typeof stormTargetForSettings>} target */
  setTarget(target) {
    this.target = { ...target };
  }

  /** Climate's share of snow (0 rain … 1 snow); sleet in between. */
  setSnowShare(share) {
    this.snowShare = clamp01(finite(share, 0));
  }

  /** Jump every channel to its target: captures, QA, and the first frame. */
  snap() {
    this.storm = this.target.storm;
    this.cloud = this.cloudTarget();
    this.wind = this.windTarget();
    this.precip = this.precipTarget();
    this.publish();
    return this.frame;
  }

  step(deltaSeconds) {
    const dt = Math.max(0, Math.min(1, finite(deltaSeconds, 0)));
    if (dt > 0) {
      const rate = (this.target.storm - this.storm) / APPROACH_TAU;
      this.storm = clamp01(this.storm + Math.max(-FALL_RATE, Math.min(RISE_RATE, rate)) * dt);
      if (Math.abs(this.target.storm - this.storm) < 1e-4) this.storm = this.target.storm;
      this.cloud = lag(this.cloud, this.cloudTarget(), CLOUD_TAU, dt);
      this.wind = lag(this.wind, this.windTarget(), WIND_TAU, dt);
      this.precip = lag(this.precip, this.precipTarget(), PRECIP_TAU, dt);
    }
    this.publish();
    return this.frame;
  }

  cloudTarget() {
    // The sky leads the storm by 0.1, ramped in so a clear sky stays clear.
    const led = Math.min(1, this.storm + 0.1 * smoothstep(0, 0.1, this.storm));
    return Math.max(this.target.cloud, led);
  }

  windTarget() {
    return Math.max(this.target.wind, this.storm);
  }

  precipTarget() {
    // Nothing falls until the cloud is in.
    return smoothstep(PRECIP_START, 1, this.storm);
  }

  publish() {
    const share = this.target.kind === 'snow' ? 1 : this.target.kind === 'rain' ? 0 : this.snowShare;
    const precip = this.precip < CHANNEL_EPSILON ? 0 : this.precip;
    const { gain } = this.target;
    this.frame = Object.freeze({
      storm: this.storm,
      cloud: this.cloud < CHANNEL_EPSILON ? 0 : this.cloud,
      wind: this.wind < CHANNEL_EPSILON ? 0 : this.wind,
      precip,
      rain: precip * (1 - share) * gain,
      snow: precip * share * gain,
      // Real thunderstorms only. Earlier than the plan's 0.78 so the UI's
      // default storm (intensity 0.7) keeps its lightning.
      lightning: this.target.thunder ? smoothstep(0.6, 0.9, this.storm) * (1 - share) : 0,
      snowShare: share,
      gain,
    });
  }
}

function lag(value, target, tau, dt) {
  const next = target + (value - target) * Math.exp(-dt / tau);
  return Math.abs(next - target) < 1e-4 ? target : next;
}
