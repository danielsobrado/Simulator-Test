import {
  abs,
  float,
  floor,
  int,
  length,
  max,
  min,
  mix,
  select,
  sin,
  uint,
  vec2,
} from 'three/tsl';
import { latticeHashBitsNode, latticeHashNode } from '../weather/wind/windNoise.js';
import { PATTERN_PERIOD } from './PatternOrigins.js';

/**
 * Value noise, FBM and voronoi whose lattice repeats every `PATTERN_PERIOD`
 * cells, for coordinates from PatternOrigins.
 *
 * A chunk's pattern origin is wrapped, so two neighbours can address the same
 * point by coordinates a whole number of periods apart; a periodic lattice
 * gives both the same value, which is what keeps the wrap seamless. Cells are
 * hashed as integers, exact at any cell index — the `fract(sin(…))` hashes
 * lose their low bits once a coordinate reaches the thousands.
 *
 * Each FBM octave doubles the frequency exactly, so every octave's lattice
 * closes over the same wrap and its period stays a power of two: a cell wraps
 * with one bit mask. (The 2.03 / 4.1209 / 8.365427 of `stylizedFbm` cannot
 * close.) The octave offsets are fractional, which is what keeps the lattices
 * from lining up.
 *
 * Every water chunk compiles its own copy of these graphs, so they are kept
 * small: a cell's wraps are shared between its corners, and a voronoi point
 * takes both coordinates from one hash.
 */

const OCTAVES = Object.freeze([
  Object.freeze({ frequency: 1, offset: [0, 0], weight: 0.5 }),
  Object.freeze({ frequency: 2, offset: [3.1, 7.7], weight: 0.25 }),
  Object.freeze({ frequency: 4, offset: [9.393, 23.331], weight: 0.125 }),
  Object.freeze({ frequency: 8, offset: [22.168, 55.062], weight: 0.0625 }),
]);

/** Cells each octave's lattice repeats over; powers of two by construction. */
export const PERIODIC_OCTAVE_PERIODS = Object.freeze(
  OCTAVES.map((octave) => octave.frequency * PATTERN_PERIOD),
);

const HALF_BITS = 65536;

/**
 * A whole-number cell coordinate wrapped into [0, period), as a uint. The
 * period is a power of two, and two's complement makes the mask a floored
 * modulo for negative cells too.
 */
function wrapCell(coordinate, period) {
  return uint(int(coordinate)).bitAnd(uint(period - 1));
}

function periodicValueNoise(position, period) {
  const integer = floor(position);
  const fraction = position.sub(integer);
  const curve = fraction.mul(fraction).mul(vec2(3).sub(fraction.mul(2)));
  const x0 = wrapCell(integer.x, period);
  const x1 = wrapCell(integer.x.add(1), period);
  const z0 = wrapCell(integer.y, period);
  const z1 = wrapCell(integer.y.add(1), period);
  const north = mix(latticeHashNode(x0, z0), latticeHashNode(x1, z0), curve.x);
  const south = mix(latticeHashNode(x0, z1), latticeHashNode(x1, z1), curve.x);
  return mix(north, south, curve.y);
}

function periodicFbmOctaves(position, count) {
  let sum = float(0);
  let weight = 0;
  for (let index = 0; index < count; index += 1) {
    const octave = OCTAVES[index];
    const point = octave.frequency === 1
      ? position
      : position.mul(octave.frequency).add(vec2(octave.offset[0], octave.offset[1]));
    sum = sum.add(periodicValueNoise(point, PERIODIC_OCTAVE_PERIODS[index]).mul(octave.weight));
    weight += octave.weight;
  }
  return sum.div(weight);
}

/** One octave of value noise in [0, 1], periodic over PATTERN_PERIOD: four hashes. */
export function periodicNoise(position, period = PATTERN_PERIOD) {
  if (!Number.isSafeInteger(period) || period < 2 || (period & (period - 1)) !== 0) {
    throw new Error('Periodic noise period must be a power of two of at least 2');
  }
  return periodicValueNoise(position, period);
}

/** Two-octave FBM in [0, 1], periodic over PATTERN_PERIOD. */
export function periodicFbm2(position) {
  return periodicFbmOctaves(position, 2);
}

/** Four-octave FBM in [0, 1], periodic over PATTERN_PERIOD. */
export function periodicFbm(position) {
  return periodicFbmOctaves(position, 4);
}

/** A cell's point, each coordinate circling on its own phase: the hash's two halves. */
function cellPoint(cellX, cellZ, time, cellSpeed) {
  const bits = latticeHashBitsNode(cellX, cellZ);
  const seed = vec2(
    float(bits.bitAnd(uint(HALF_BITS - 1))),
    float(bits.shiftRight(uint(16))),
  ).div(HALF_BITS);
  return float(0.5).add(float(0.5).mul(sin(time.mul(cellSpeed).add(seed.mul(6.2831)))));
}

/** Distances to the animated points of the 3×3 cells around `position`. */
export function periodicVoronoiDistances(position, time, cellSpeed) {
  const integer = floor(position);
  const fraction = position.sub(integer);
  const offsets = [-1, 0, 1];
  const cellsX = offsets.map((offset) => wrapCell(integer.x.add(offset), PATTERN_PERIOD));
  const cellsZ = offsets.map((offset) => wrapCell(integer.y.add(offset), PATTERN_PERIOD));
  const distances = [];
  offsets.forEach((offsetZ, indexZ) => {
    offsets.forEach((offsetX, indexX) => {
      const point = cellPoint(cellsX[indexX], cellsZ[indexZ], time, cellSpeed);
      distances.push(length(vec2(offsetX, offsetZ).add(point).sub(fraction)));
    });
  });
  return distances;
}

/**
 * A 0..1 value constant over each Voronoi cell (the nearest point's own hash),
 * so a threshold on it switches whole cells: floes, not contour lines.
 */
export function periodicVoronoiCellValue(position) {
  const integer = floor(position);
  const fraction = position.sub(integer);
  const offsets = [-1, 0, 1];
  const cellsX = offsets.map((offset) => wrapCell(integer.x.add(offset), PATTERN_PERIOD));
  const cellsZ = offsets.map((offset) => wrapCell(integer.y.add(offset), PATTERN_PERIOD));
  let nearest = float(8);
  let value = float(0);
  offsets.forEach((offsetZ, indexZ) => {
    offsets.forEach((offsetX, indexX) => {
      const distance = length(vec2(offsetX, offsetZ).add(cellPoint(cellsX[indexX], cellsZ[indexZ], float(0), 0)).sub(fraction));
      // Swapped axes: a hash apart from the one that placed the point.
      value = select(distance.lessThan(nearest), latticeHashNode(cellsZ[indexZ], cellsX[indexX]), value);
      nearest = min(nearest, distance);
    });
  });
  return value;
}

function smoothMin(a, b, k) {
  const h = max(k.sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(h).mul(k).div(6));
}

/** Distance to the nearest point. */
export function periodicVoronoiF1(position, time, cellSpeed) {
  const distances = periodicVoronoiDistances(position, time, cellSpeed);
  return distances.slice(1).reduce((nearest, distance) => min(nearest, distance), distances[0]);
}

/** The nearest distance and its smooth minimum, from one neighbourhood. */
export function periodicVoronoiMetrics(position, time, cellSpeed, smoothness) {
  const distances = periodicVoronoiDistances(position, time, cellSpeed);
  let nearest = distances[0];
  let smoothNearest = distances[0];
  for (let index = 1; index < distances.length; index += 1) {
    nearest = min(nearest, distances[index]);
    smoothNearest = smoothMin(smoothNearest, distances[index], smoothness);
  }
  return { nearest, smoothNearest };
}
