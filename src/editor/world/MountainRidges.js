import { valueNoise } from './valueNoise2d.js';

/**
 * Ridged mountain relief for high ground (after grass-test's MountainNoise and
 * AlpineRegion): crests, spurs and the gullies between them, where Azgaar's
 * smooth height field and the rolling local detail leave mountains as domes.
 *
 * A ridged multifractal: each octave folds value noise into sharp crests, and a
 * crest in one octave strengthens the next, so detail gathers along ridgelines
 * instead of spreading evenly. Wavelengths stay well above the 2 m cell, so no
 * octave aliases on the terrain grid.
 *
 * Two finer terms ride on top of that massif, both from the donor's alpine
 * landform:
 *  - couloirs, the steep rock chutes down a flank between its ribs; and
 *  - crest notches, the saddles cut into a ridge line.
 * Both are additive: a depth of zero, or a world imported before them, leaves
 * that term off without touching the crests underneath.
 */
const OCTAVES = Object.freeze([
  { cells: 384, amplitude: 1, seed: 7919 },
  { cells: 160, amplitude: 0.45, seed: 8123 },
  { cells: 64, amplitude: 0.18, seed: 8429 },
]);
/** The largest sum OCTAVES can reach, for normalizing to 0..1. */
const PEAK = OCTAVES.reduce((sum, octave) => sum + octave.amplitude, 0);
const WARP_CELLS = 170;
const WARP_REACH_CELLS = 48;
/** Broken faces for near terrain only: at the far mesh's spacing they would alias. */
const FINE_OCTAVES = Object.freeze([
  { cells: 26, amplitude: 1, seed: 9011 },
  { cells: 11, amplitude: 0.35, seed: 9103 },
]);

/*
 * Couloirs. One ridged octave finer than the crests, on a lattice rotated 37°
 * (the donor's rotation) so the chutes cut across the flanks instead of lining
 * up with the crest lattice: the chute is the low fold, the rib between two
 * chutes is the high one. The centre is the measured mean of a folded value
 * field, so the chutes cut down about as much as the ribs rise and the range's
 * mean height stays where Azgaar put it.
 */
const COULOIR_CELLS = 64;
const COULOIR_ROTATION_COS = 0.8;
const COULOIR_ROTATION_SIN = 0.6;
const COULOIR_SEED = 6151;
const COULOIR_CENTRE = 0.63;

/*
 * Crest notches. One ridged octave at the crest scale, on its own seed, so the
 * notches do not repeat the crest lattice. Gated to the ridge line, it breaks
 * the summit into saddles and pinnacles.
 */
const NOTCH_CELLS = 128;
const NOTCH_SEED = 7207;
const NOTCH_CENTRE = 0.64;

export const DEFAULT_MOUNTAIN_RIDGES = Object.freeze({
  /** Crest height over the gullies at full strength, metres. */
  heightMeters: 90,
  /** Land relief fraction (0 coast … 1 highest peak) where ridges begin and reach full strength. */
  startRelief: 0.3,
  fullRelief: 0.65,
  /**
   * Couloir depth below the ribs at full strength, metres. Conservative: a
   * chute in a 90 m ridge is fine detail, not a second range. 0 turns them off.
   */
  couloirMeters: 8,
  /** Crest-notch depth below the ridge line at full strength, metres. 0 turns them off. */
  notchMeters: 9,
  /** Height of the broken faces on near ground, metres. 0 turns them off. */
  fineMeters: 0,
});

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0 at the gully floor … 1 on the sharpest crest. */
export function ridgedField(x, z, seed) {
  // Off the lattice: folded value noise otherwise creases along straight cell lines.
  const warpedX = x + valueNoise(x / WARP_CELLS, z / WARP_CELLS, seed + 5101) * WARP_REACH_CELLS;
  const warpedZ = z + valueNoise(x / WARP_CELLS, z / WARP_CELLS, seed + 5233) * WARP_REACH_CELLS;
  let sum = 0;
  let weight = 1;
  for (const octave of OCTAVES) {
    const folded = 1 - Math.abs(valueNoise(warpedX / octave.cells, warpedZ / octave.cells, seed + octave.seed));
    const crest = folded * folded * weight;
    sum += crest * octave.amplitude;
    weight = Math.min(1, crest * 2);
  }
  return sum / PEAK;
}

/** How strongly ridges rise at a relief fraction, 0..1. Zero skips the noise entirely. */
export function ridgeStrength(reliefFraction, ridges) {
  return smoothstep(ridges.startRelief, ridges.fullRelief, reliefFraction);
}

/** The mid-flank only: 0 on the crest and in the gully floor, after the donor's flank gate. */
function flankStrength(ridge) {
  return smoothstep(0.12, 0.3, ridge) * (1 - 0.6 * smoothstep(0.75, 0.95, ridge));
}

/** The ridge line only: 0 in the gullies, 1 on the crests. */
function crestStrength(ridge) {
  return smoothstep(0.6, 0.9, ridge);
}

/** A finer folded field for the couloirs, on the rotated lattice. */
function couloirField(x, z, seed) {
  const rx = (x * COULOIR_ROTATION_COS - z * COULOIR_ROTATION_SIN) / COULOIR_CELLS;
  const rz = (x * COULOIR_ROTATION_SIN + z * COULOIR_ROTATION_COS) / COULOIR_CELLS;
  return 1 - Math.abs(valueNoise(rx, rz, seed + COULOIR_SEED));
}

/** A folded field at the crest scale for the notches. */
function notchField(x, z, seed) {
  return 1 - Math.abs(valueNoise(x / NOTCH_CELLS, z / NOTCH_CELLS, seed + NOTCH_SEED));
}

/** Chutes below the ribs at a point; the caller scales it by depth and strength. */
function couloirRelief(x, z, seed, ridge) {
  return (couloirField(x, z, seed) - COULOIR_CENTRE) * flankStrength(ridge);
}

/** Saddles below the ridge line at a point; the caller scales it. */
function notchRelief(x, z, seed, ridge) {
  return (notchField(x, z, seed) - NOTCH_CENTRE) * crestStrength(ridge);
}

/**
 * Couloir relief at a vertex, metres, centred and gated like the ridges: chutes
 * cut the mid-flank below the ribs and lowland pays nothing.
 */
export function couloirHeight(x, z, seed, reliefFraction, ridges, scale = 1) {
  const strength = ridgeStrength(reliefFraction, ridges) * scale;
  const depth = ridges.couloirMeters ?? 0;
  if (strength <= 0 || depth <= 0) return 0;
  return couloirRelief(x, z, seed, ridgedField(x, z, seed)) * depth * strength;
}

/**
 * Crest-notch relief at a vertex, metres: saddles cut down where the point is
 * on the ridge line, and nothing between ridges.
 */
export function crestNotchHeight(x, z, seed, reliefFraction, ridges, scale = 1) {
  const strength = ridgeStrength(reliefFraction, ridges) * scale;
  const depth = ridges.notchMeters ?? 0;
  if (strength <= 0 || depth <= 0) return 0;
  return notchRelief(x, z, seed, ridgedField(x, z, seed)) * depth * strength;
}

/**
 * Metres of mountain relief at a vertex, centred so the mean ground stays where
 * Azgaar put it: crests rise, gullies sink, couloirs cut the flanks and notches
 * saddle the ridge line. The three terms share one field evaluation.
 */
export function ridgeHeight(x, z, seed, reliefFraction, ridges, scale = 1) {
  const strength = ridgeStrength(reliefFraction, ridges) * scale;
  if (strength <= 0) return 0;
  const ridge = ridgedField(x, z, seed);
  // Couloirs and notches ride on the crests. A depth of zero — or a depth the
  // config never set, which is how a world imported before these terms keeps
  // its old mountains — skips the extra noise entirely, so that world pays
  // exactly what it did before.
  let relief = (ridge - 0.35) * ridges.heightMeters;
  const couloirMeters = ridges.couloirMeters ?? 0;
  if (couloirMeters > 0) relief += couloirRelief(x, z, seed, ridge) * couloirMeters;
  const notchMeters = ridges.notchMeters ?? 0;
  if (notchMeters > 0) relief += notchRelief(x, z, seed, ridge) * notchMeters;
  return relief * strength;
}

/**
 * Crags and ledges over the massif, for near terrain only, so a face is broken
 * rather than one plane between ridge lines. Centred, like the ridges.
 */
export function ridgeFineHeight(x, z, seed, reliefFraction, ridges, scale = 1) {
  const strength = ridgeStrength(reliefFraction, ridges) * scale;
  const depth = ridges.fineMeters ?? 0;
  if (strength <= 0 || depth <= 0) return 0;
  let relief = 0;
  for (const octave of FINE_OCTAVES) {
    const folded = 1 - Math.abs(valueNoise(x / octave.cells, z / octave.cells, seed + octave.seed));
    relief += (folded * folded - 0.45) * octave.amplitude;
  }
  return relief * depth * strength;
}

/** The import setting, resolved; null keeps ridges off. */
export function resolveMountainRidges(source) {
  if (source == null || source === false) return null;
  const ridges = { ...DEFAULT_MOUNTAIN_RIDGES, ...(source === true ? {} : source) };
  validateMountainRidges(ridges, 'import.azgaarRidges');
  return ridges;
}

export function validateMountainRidges(ridges, path) {
  if (!ridges || !Number.isFinite(ridges.heightMeters) || ridges.heightMeters < 0
      || !Number.isFinite(ridges.startRelief) || !Number.isFinite(ridges.fullRelief)
      || ridges.fullRelief <= ridges.startRelief) {
    throw new Error(`${path} needs heightMeters ≥ 0 and startRelief < fullRelief.`);
  }
  for (const name of ['couloirMeters', 'notchMeters']) {
    const value = ridges[name];
    // Absent on a world imported before couloirs and crest notches existed: a
    // missing depth leaves that term off, so those worlds are unchanged. A
    // present value must be a real, non-negative depth (config fills it in).
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${path}.${name} must be a number ≥ 0.`);
    }
  }
}
