import {
  exp,
  float,
  floor,
  fract,
  fwidth,
  int,
  length,
  max,
  oneMinus,
  smoothstep,
  step,
  uint,
  vec2,
} from 'three/tsl';
import { latticeHashNode } from '../weather/wind/windNoise.js';

/**
 * Rain rings on a water chunk (after grass-test's rain ripples).
 *
 * Two lattices of different cell sizes each drop one ring per cell at a hashed
 * point; every ring has its own size, lifetime and phase, so the drops neither
 * line up nor pulse together. A pixel looks at the four cells nearest it in
 * each lattice. Rain decides how many cells are active and how strong the rings
 * are, so the cost is the same in calm weather but nothing shows.
 *
 * Each ring is a small travelling crest that widens and dies as it spreads, and
 * it is returned as a slope as well as a brightness: the slopes tilt the water's
 * normal, which is what roughens the reflection under rain. Rings are faded out
 * once a pixel is wider than the crest, so the distance reads as a roughened
 * sheet rather than a lattice of identical discs.
 *
 * The lattice must be exact at planet scale, where float32 cannot hold a
 * canonical position's fraction. Cells are therefore indexed by the chunk's
 * integer origin in metres (a per-chunk uniform, exact below 2^24 m) plus a
 * local offset, and hashed as integers, which also keeps them continuous
 * across chunk borders.
 */

export const RAIN_RIPPLE_CELL_METERS = 1;
// [cell metres, salt]. Cells divide the 1 m origin lattice, so every cell index
// stays an exact integer: the chunk origin in metres times cells per metre.
export const RAIN_RIPPLE_LAYERS = Object.freeze([[0.5, 11], [1 / 3, 23]]);
const RING_PERIOD_RANGE = [0.55, 1.35];
// Largest radius, as a share of the cell: the 2×2 neighbourhood holds it whole.
const RING_RADIUS_RANGE = [0.16, 0.42];
const RING_WIDTH = 0.022;

function cellHash(cellX, cellZ, salt) {
  return latticeHashNode(
    uint(int(cellX)).add(uint(salt * 7919)),
    uint(int(cellZ)).add(uint(salt * 104729)),
  );
}

function rippleLayer({ localMeters, originMeters, time, rain, cellMeters, salt }) {
  const perMetre = 1 / cellMeters;
  const point = localMeters.mul(perMetre);
  const cell = floor(point);
  const local = fract(point);
  const offset = step(0.5, local).mul(2).sub(1);
  const origin = originMeters.mul(perMetre);
  const width = float(RING_WIDTH * perMetre);
  // Crests narrower than about a pixel only alias: fade them to nothing.
  const resolved = oneMinus(smoothstep(width.mul(0.6), width.mul(2.2), fwidth(point.x).add(fwidth(point.y))));
  let ring = float(0);
  let slope = vec2(0);
  for (const [ox, oz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const neighbour = vec2(offset.x.mul(ox), offset.y.mul(oz));
    const id = cell.add(neighbour).add(origin);
    const hash = index => cellHash(id.x, id.y, salt + index);
    const period = hash(5).mul(RING_PERIOD_RANGE[1] - RING_PERIOD_RANGE[0]).add(RING_PERIOD_RANGE[0]);
    const age = fract(time.div(period).add(hash(3)));
    const reach = hash(6).mul(RING_RADIUS_RANGE[1] - RING_RADIUS_RANGE[0]).add(RING_RADIUS_RANGE[0]);
    const centre = neighbour.add(vec2(hash(1), hash(2)).mul(0.5).add(0.25));
    const active = step(hash(4), rain.mul(0.9));
    const toPixel = local.sub(centre);
    const distance = length(toPixel);
    // The crest runs out fast and slows, broadening as it spreads.
    const radius = reach.mul(oneMinus(age.oneMinus().mul(age.oneMinus())));
    const crestWidth = width.mul(age.mul(1.5).add(1));
    const x = distance.sub(radius).div(crestWidth);
    const crest = exp(x.mul(x).negate());
    const life = age.oneMinus().mul(age.oneMinus()).mul(active);
    ring = max(ring, crest.mul(life));
    // d(crest)/d(distance), along the ring's radius, in slope per metre.
    const fall = x.mul(crest).mul(-2).div(crestWidth).mul(life).mul(perMetre * 0.004);
    slope = slope.add(toPixel.div(max(distance, 1e-4)).mul(fall));
  }
  return { ring: ring.mul(resolved), slope: slope.mul(resolved) };
}

/**
 * @param {object} options
 * @param {object} options.localMeters vec2: metres from the chunk's origin corner, cell axes
 * @param {object} options.originMeters vec2 uniform: the chunk origin in whole metres, cell axes
 * @param {object} options.time seconds
 * @param {object} options.rain 0..1
 * @returns {{ ring: object, slope: object }} brightness 0..1 and dh/dx, dh/dz on canonical axes
 */
export function createRainRippleNode({ localMeters, originMeters, time, rain }) {
  let ring = float(0);
  let slope = vec2(0);
  for (const [cellMeters, salt] of RAIN_RIPPLE_LAYERS) {
    const layer = rippleLayer({ localMeters, originMeters, time, rain, cellMeters, salt });
    ring = max(ring, layer.ring);
    slope = slope.add(layer.slope);
  }
  // Cell axes run z the other way: hand the slope over on canonical axes.
  return { ring: ring.mul(rain), slope: vec2(slope.x, slope.y.negate()).mul(rain) };
}

/** Pixels too far for rings still lose their mirror finish to the rain. */
export function rainRoughness(rain) {
  return rain.mul(0.14);
}
