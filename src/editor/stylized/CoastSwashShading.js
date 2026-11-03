import {
  cos,
  float,
  max,
  mix,
  oneMinus,
  sin,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import { seaStateUniforms } from '../water/seaState.js';
import { periodicFbm, periodicFbm2 } from './PeriodicNoiseNodes.js';
import { PatternOrigins } from './PatternOrigins.js';
import { shoreContactDistance } from './ShoreContactNodes.js';
import { waterVisualClock } from '../water/WaterVisualClock.js';

/**
 * Swash on the ground at the sea's edge (after grass-test's coast field).
 *
 * grass-test learned to express the swash as a height above still water, not
 * a distance from the coast: the front forms `breakDepth` down in the
 * shallows, crosses the waterline and runs up the sand, and follows the actual
 * ground wherever the coast is. That is the only form that works here, where
 * coasts come from Azgaar rather than an analytic curve.
 *
 *   film     a thin sheet of water behind the front, glossy and faintly tinted;
 *   foam     a broken line riding the front;
 *   wet      wash memory (the last few fronts, decaying) plus a permanently
 *            damp band just above the waterline: darker and far less rough.
 *
 * A beach has one front per wave. Its timing drifts slowly along the shore
 * with a low-frequency noise, since there is no along-shore coordinate.
 * Everything is gated to ground within `band` of sea level, so inland ground
 * costs a few ALU ops and nothing changes there.
 *
 * Coasts lie millions of metres from the origin, so the drift noise and the
 * two breakup waves are addressed through per-chunk PatternOrigins rather than
 * canonical positions (`createCoastPatternOrigins`).
 */

export const DEFAULT_COAST_SWASH = Object.freeze({
  enabled: true,
  period: 7.5,
  runupHeight: 1.1,
  breakDepth: 0.5,
  frontBand: 0.08,
  foamCore: 0.02,
  foamWidth: 0.12,
  foamCoreMeters: 0.025,
  foamWidthMeters: 0.24,
  breakupStrength: 0.3,
  washDecay: 4,
  dampHeight: 0.9,
  wetDarkening: 0.5,
  wetRoughness: 0.42,
  filmRoughness: 0.3,
  filmTint: '#8ccad0',
  filmTintStrength: 0.18,
  foamColor: '#edf8fb',
  foamStrength: 0.85,
});

const TAU = Math.PI * 2;
const MEMORY_CYCLES = Object.freeze([0.15, 0.3, 0.45, 0.6]);
const DRIFT_SCALE = 0.021;
const FRONT_BREAKUP_WAVE = Object.freeze([0.13, 0.09]);

/** The per-chunk pattern origins the swash reads; re-centre them with the terrain chunk. */
export function createCoastPatternOrigins() {
  return new PatternOrigins(COAST_PATTERN_FRAMES);
}

export const COAST_SWASH_PATTERN_FRAMES = Object.freeze({
  drift: { scale: DRIFT_SCALE },
  frontBreakup: { wave: FRONT_BREAKUP_WAVE },
  foamLace: { scale: 0.85 },
});

export const COAST_PATTERN_FRAMES = Object.freeze({
  ...COAST_SWASH_PATTERN_FRAMES,
  sandMacro: { scale: 0.0225 },
  sandReef: { scale: 0.09 },
  sandMesoX: { wave: [0.558, 0] },
  sandMesoWarp: { wave: [0, 0.684] },
  sandMesoZ: { wave: [0, 0.846] },
  sandRippleX: { wave: [3.42, 0] },
  sandRippleWarp: { wave: [0, 1.26] },
  sandCaustics: { scale: 1, period: 5.5 },
});

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/** Shared by the ground and water front. Real gaps replace the old sine's
 * positive opacity floor, which painted a continuous stripe on flat beaches. */
export function createCoastFoamBreakup(patterns, localXZ, clock, strength) {
  if (!(strength > 0)) return float(1);
  const point = patterns.latticePoint('foamLace', localXZ)
    .add(vec2(clock.mul(.025).mod(512), clock.mul(-.017).mod(512)));
  const lace = periodicFbm2(point);
  const threshold = strength * .625;
  const footprint = lace.fwidth();
  const filter = footprint.min(.15);
  // A wide band: at ±0.1 the lace's threshold drew a dotted line along the shore up close.
  const laced = smoothstep(float(threshold - .22).sub(filter), float(threshold + .22).add(filter), lace);
  // Once the lace is finer than a pixel, thresholding it only draws a dotted
  // moiré along the shore: hand over to its average coverage instead.
  return mix(laced, float(0.5), smoothstep(.08, .25, footprint));
}

/**
 * @param {object} options
 * @param {object} options.localXZ vec2 node: metres from the chunk centre, canonical axes
 * @param {PatternOrigins} options.patternOrigins from `createCoastPatternOrigins`
 * @param {object} options.groundHeight float node, world height of the ground
 * @param {object} [options.config] `stylizedSurface.water.coast`
 * @returns {{ apply: (color: object, roughness: object) => { color: object, roughness: object } } | null}
 */
export function createCoastSwashNodes({
  localXZ,
  patternOrigins,
  groundHeight,
  config = DEFAULT_COAST_SWASH,
  clock = waterVisualClock,
  shorelineFadeDepth = 0.35,
  oceanMask = float(1),
}) {
  if (!config.enabled) return null;
  const height = groundHeight.sub(seaStateUniforms.seaLevel);
  const band = smoothstep(-config.breakDepth - 0.2, -config.breakDepth, height)
    .mul(oneMinus(smoothstep(config.runupHeight + 0.2, config.runupHeight + config.dampHeight + 0.4, height)))
    .mul(oceanMask);
  // Slow drift of the wave timing along the shore.
  const drift = periodicFbm(patternOrigins.latticePoint('drift', localXZ)).mul(TAU * 1.6);
  const frontBreakupPhase = patternOrigins.wavePhase('frontBreakup', localXZ);
  const phase = clock.mul(TAU / config.period).add(drift);
  const frontAt = (samplePhase) => {
    const excursion = oneMinus(cos(samplePhase)).mul(0.5);
    const breakup = sin(frontBreakupPhase.add(samplePhase.mul(0.17)))
      .mul(config.breakupStrength * config.frontBand);
    return excursion.mul(config.runupHeight + config.breakDepth).sub(config.breakDepth).add(breakup);
  };
  const coverageAt = (samplePhase) => {
    const front = frontAt(samplePhase);
    return oneMinus(smoothstep(front.sub(config.frontBand), front.add(config.frontBand), height));
  };
  const front = frontAt(phase);
  const film = coverageAt(phase).mul(band);
  const foamBreakup = createCoastFoamBreakup(patternOrigins, localXZ, clock, config.breakupStrength);
  const contact = shoreContactDistance(height.sub(front), localXZ);
  const foam = oneMinus(smoothstep(config.foamCoreMeters ?? DEFAULT_COAST_SWASH.foamCoreMeters,
    max(float(config.foamWidthMeters ?? DEFAULT_COAST_SWASH.foamWidthMeters), contact.footprint), contact.distance))
    .mul(foamBreakup)
    // Only where the wash actually runs: on nearly flat sand the foam contour
    // otherwise crossed dry ground several times, drawing parallel white wires.
    .mul(film)
    .mul(band);
  let memory = film;
  for (const cyclesAgo of MEMORY_CYCLES) {
    memory = max(memory, coverageAt(phase.sub(TAU * cyclesAgo)).mul(Math.exp(-cyclesAgo * config.washDecay)));
  }
  const damp = oneMinus(smoothstep(0, config.dampHeight, height));
  const wet = max(memory, damp).mul(band);
  const filmTint = colorNode(config.filmTint);
  const foamColor = colorNode(config.foamColor);
  // The same foam front crosses sand and water. The ground owns the portion
  // where the water sheet fades out; deeper water owns it through refraction.
  const groundHandoff = oneMinus(smoothstep(0, shorelineFadeDepth, height.negate()));

  return {
    film, foam, wet,
    apply(color, roughness) {
      let result = color.mul(mix(float(1), float(config.wetDarkening), wet));
      result = mix(result, result.mul(filmTint).mul(1.6), film.mul(config.filmTintStrength));
      result = mix(result, foamColor, foam.mul(config.foamStrength).mul(groundHandoff));
      let resultRoughness = mix(roughness, float(config.wetRoughness), wet);
      resultRoughness = mix(resultRoughness, float(config.filmRoughness), film);
      resultRoughness = mix(resultRoughness, float(0.72), foam);
      return { color: result, roughness: resultRoughness };
    },
  };
}
