import { mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * The wall-top height function, in arc length.
 *
 * `record.top.profile` stores control points anchored per segment (like
 * `features`) so that moving one anchor cannot slide every control point along
 * the wall. This module resolves them onto the arc table and interpolates.
 *
 * Interpolation is monotone cubic (Fritsch–Carlson PCHIP), not Catmull-Rom:
 * Catmull-Rom overshoots between control points, which would push a raised
 * section above its own control points and make raise/lower feel unpredictable.
 *
 * Outside the outermost control point the profile holds that point's value.
 * The raise/lower gesture writes bracketing control points at the falloff edge,
 * so in practice that value is `top.base` — but clamping to the point rather
 * than jumping back to `top.base` keeps the profile continuous even for a
 * hand-authored or clipped profile.
 */

const MERLON_DUTY = 0.55;
const DEFAULT_MERLON_HEIGHT = 0.72;
const IRREGULAR_AMPLITUDE = 0.16;
const IRREGULAR_WAVELENGTH = 4.7;
const RUIN_WAVELENGTH = 6.3;
const EPSILON = 1e-9;

function hashUnit(seed, value) {
  return mixSeed(seed, value) / 0x100000000;
}

/** Deterministic C1 value noise over arc length; no allocation per query. */
function valueNoise(seed, s, wavelength) {
  const scaled = s / wavelength;
  const cell = Math.floor(scaled);
  const t = scaled - cell;
  const a = hashUnit(seed, cell);
  const b = hashUnit(seed, cell + 1);
  const smooth = t * t * (3 - 2 * t);
  return a + (b - a) * smooth;
}

function solvePchipSlopes(xs, ys) {
  const n = xs.length;
  const slopes = new Array(n).fill(0);
  if (n < 2) return slopes;
  const h = new Array(n - 1);
  const delta = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    h[i] = Math.max(EPSILON, xs[i + 1] - xs[i]);
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  slopes[0] = delta[0];
  slopes[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (delta[i - 1] * delta[i] <= 0) {
      slopes[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    slopes[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
  }
  return slopes;
}

function evaluateHermite(xs, ys, slopes, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let low = 0;
  let high = xs.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (xs[middle] <= x) low = middle;
    else high = middle;
  }
  const h = Math.max(EPSILON, xs[high] - xs[low]);
  const t = (x - xs[low]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[low]
    + (t3 - 2 * t2 + t) * h * slopes[low]
    + (-2 * t3 + 3 * t2) * ys[high]
    + (t3 - t2) * h * slopes[high];
}

export function createWallTopProfile(record, arcTable, { style = null } = {}) {
  const top = record.top;
  const base = top.base;
  const seed = record.seed >>> 0;
  const merlonSpacing = style?.merlonSpacing ?? 1.18;

  const resolved = top.profile
    .map((entry) => ({
      s: arcTable.toArc(entry.segmentId, entry.arcFraction),
      height: entry.height,
    }))
    .sort((a, b) => a.s - b.s);

  // Two control points at the same arc position would divide by zero in the
  // slope solve; the later one wins, matching last-write in the edit gesture.
  const xs = [];
  const ys = [];
  for (const entry of resolved) {
    if (xs.length > 0 && entry.s - xs[xs.length - 1] < EPSILON) {
      ys[ys.length - 1] = entry.height;
      continue;
    }
    xs.push(entry.s);
    ys.push(entry.height);
  }
  const slopes = solvePchipSlopes(xs, ys);

  function profileHeight(s) {
    if (xs.length === 0) return base;
    if (xs.length === 1) return ys[0];
    return evaluateHermite(xs, ys, slopes, s);
  }

  function ruinFactorAt(s) {
    if (top.style !== 'ruined') return 0;
    const low = valueNoise(mixSeed(seed, 0x72), s, RUIN_WAVELENGTH);
    const fine = valueNoise(mixSeed(seed, 0x73), s, RUIN_WAVELENGTH * 0.31);
    return Math.max(0, Math.min(1, low * 0.72 + fine * 0.38 - 0.12));
  }

  function heightAt(s) {
    const height = profileHeight(s);
    if (top.style === 'irregular') {
      const wobble = valueNoise(mixSeed(seed, 0x70), s, IRREGULAR_WAVELENGTH) - 0.5;
      const fine = valueNoise(mixSeed(seed, 0x71), s, IRREGULAR_WAVELENGTH * 0.37) - 0.5;
      return Math.max(0.2, height + (wobble * 1.4 + fine * 0.6) * IRREGULAR_AMPLITUDE);
    }
    if (top.style === 'ruined') {
      // Sag toward a low stub rather than to zero, so a ruin keeps a footing.
      return Math.max(0.2, height * (1 - ruinFactorAt(s) * 0.82));
    }
    return Math.max(0.2, height);
  }

  function slopeAt(s, delta = 0.15) {
    const half = Math.max(EPSILON, delta / 2);
    const before = Math.max(0, s - half);
    const after = Math.min(arcTable.totalLength, s + half);
    const measured = after - before;
    if (measured <= EPSILON) return 0;
    return Math.atan2(heightAt(after) - heightAt(before), measured);
  }

  /**
   * Merlons over an arc range. The rhythm is phase-locked to absolute arc
   * length so adjacent modules agree at their shared boundary.
   */
  function crenellationsOver(s0, s1, { merlonHeight = DEFAULT_MERLON_HEIGHT } = {}) {
    if (top.style !== 'crenellated') return [];
    const merlons = [];
    const width = merlonSpacing * MERLON_DUTY;
    const first = Math.floor(s0 / merlonSpacing);
    const last = Math.ceil(s1 / merlonSpacing);
    for (let cell = first; cell <= last; cell += 1) {
      const center = (cell + 0.5) * merlonSpacing;
      if (center + width / 2 <= s0 || center - width / 2 >= s1) continue;
      merlons.push(Object.freeze({
        s: center,
        width,
        base: heightAt(center),
        height: merlonHeight,
      }));
    }
    return Object.freeze(merlons);
  }

  return Object.freeze({
    style: top.style,
    base,
    controlCount: xs.length,
    heightAt,
    slopeAt,
    ruinFactorAt,
    crenellationsOver,
  });
}
