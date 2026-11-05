import { Color } from 'three/webgpu';
import { Fn, If, bool, float, fract, mix, oneMinus, select, sin, smoothstep, vec2, vec3, vec4 } from 'three/tsl';
import { heightRelief } from './heightRelief.js';
import { DEFAULT_DUNE } from '../biomes/BiomeSurfaceLooks.js';
import { periodicFbm2, periodicNoise } from '../stylized/PeriodicNoiseNodes.js';
import { PATTERN_PERIOD } from '../stylized/PatternOrigins.js';

const DEFAULT_ARID = Object.freeze({ sand: [1], mineral: [2] });
const pigment = hex => { const color = new Color(hex); return vec3(color.r, color.g, color.b); };

/** Loose sand and frost-broken mineral ground; canonical IDs remain unchanged. */
const anyOf = (tileId, ids) => ids.map((id) => tileId.equal(id)).reduce((a, b) => a.or(b), bool(false));

const duneVector = (dune) => vec4(dune.a, dune.b, dune.height, dune.sharpness);
/** Lattice cells per metre of the terrain's `broad` frame (TerrainTransitionNodes). */
const BROAD_LATTICE_SCALE = 0.35;
/** Metres between the long dune swells that carry a desert past the fine ripples' reach. */
const SWELL_METRES = 14;
/** Metres between the dune ridges that still shade the sand from the air, past the swells. */
const RIDGE_METRES = 48;

/**
 * The swell's frequency on the broad lattice, across the same wind as the
 * ripples. Multiples of 1/PATTERN_PERIOD still close over the pattern's wrap.
 */
function swellVector(dune, metres = SWELL_METRES) {
  const length = Math.hypot(dune.a, dune.b) || 1;
  const cycles = 1 / (BROAD_LATTICE_SCALE * metres);
  const snap = (value) => Math.round(value * cycles * PATTERN_PERIOD) / PATTERN_PERIOD;
  return vec2(snap(dune.a / length), snap(dune.b / length));
}

/** A per-sand-tile choice between vectors, the default for every other tile. */
function perDune(tileId, dunes, vector) {
  return Object.entries(dunes).reduce((chosen, [id, dune]) => select(tileId.equal(Number(id)), vector(dune), chosen),
    vector(DEFAULT_DUNE));
}

/** Each sand tile's dune (biome-looks `dunes`) as vec4(lattice a, lattice b, height, sharpness). */
const duneAt = (tileId, dunes) => perDune(tileId, dunes, duneVector);

/**
 * A wind ripple: a gentle windward slope up to a crest and a steep lee face
 * (after the dune shader of a WebGPU water demo), blended from a plain sine
 * by `sharpness`. Range −1..1, like the sine.
 */
function duneProfile(phase, sharpness) {
  const s = fract(phase.div(Math.PI * 2));
  const lee = mix(float(0.5), float(0.12), sharpness);
  const rise = s.div(oneMinus(lee)), fall = oneMinus(s).div(lee);
  const shaped = select(s.lessThan(oneMinus(lee)), rise, fall);
  return mix(sin(phase), shaped.mul(shaped).mul(float(3).sub(shaped.mul(2))).mul(2).sub(1), sharpness);
}

/**
 * `arid` lists the sand and mineral tiles (biome-looks `arid`); Azgaar's hot and
 * cold deserts by default. `dunes` shapes each sand tile's wind ripples.
 */
export function createAridSubstrateNodes({ tileId, bare, patterns, localXZ, cameraDistance, arid = DEFAULT_ARID, dunes = {},
  crust = float(0) }) {
  const hot = anyOf(tileId, arid.sand ?? []), cold = anyOf(tileId, arid.mineral ?? []);
  const amount = hot.or(cold).select(bare.clamp(0, 1), float(0));
  const reach = oneMinus(smoothstep(8, 30, cameraDistance));
  const sample = Fn(() => {
    const result = vec4(0).toVar();
    If(amount.greaterThan(.001), () => {
      const p = patterns.latticePoint('fine', localXZ).toVar();
      const macro = periodicFbm2(patterns.latticePoint('broad', localXZ));
      const grain = periodicNoise(p.mul(8).add(31.7));
      const warp = periodicNoise(p.add(17.3));
      const drift = periodicNoise(p.div(8).add(7.3), PATTERN_PERIOD / 8);
      // Integer lattice frequencies close over PatternOrigins' 512-cell wrap.
      const dune = duneAt(tileId, dunes).toVar();
      // A coarser warp too, so crests wander and fork instead of running ruler-straight.
      const bend = periodicNoise(p.div(4).add(41.9), PATTERN_PERIOD / 4);
      const phase = p.x.mul(dune.x).add(p.y.mul(dune.y)).mul(Math.PI * 2).add(warp.mul(2)).add(bend.mul(2.6));
      // Ripples come and go in drifts a few metres across: one even stripe ran over the whole erg.
      const drifts = smoothstep(.28, .72, periodicNoise(p.div(4).add(63.1), PATTERN_PERIOD / 4)).mul(.8).add(.2);
      // Fine ripples hand over to the swells by ~20 m: further out a full-strength
      // sine reads as zebra stripes across the whole middle distance.
      const filtered = oneMinus(smoothstep(.6, 2.4, phase.fwidth())).mul(oneMinus(smoothstep(6, 20, cameraDistance)));
      const secondaryPhase = p.x.mul(3).sub(p.y.mul(2)).mul(Math.PI * 2).add(warp.mul(1.7));
      // Two coherent ripple districts with quiet ground between them. Integer
      // lattice frequencies preserve the bounded pattern's chunk/rebase seams.
      const direction = smoothstep(.3, .7, drift);
      const ripple = mix(duneProfile(phase, dune.w), sin(secondaryPhase), direction)
        .mul(mix(float(.1), float(1), smoothstep(.3, .7, macro))).mul(filtered).mul(dune.z).mul(drifts);
      // Long swells across the same wind, kept to ~300 m where the ripples stop at 30.
      const broad = patterns.latticePoint('broad', localXZ);
      const swellPhase = broad.dot(perDune(tileId, dunes, swellVector)).mul(Math.PI * 2).add(macro.sub(.5).mul(3));
      const swell = duneProfile(swellPhase, dune.w).mul(dune.z.min(1.5))
        .mul(oneMinus(smoothstep(160, 320, cameraDistance))).mul(oneMinus(smoothstep(.6, 2.4, swellPhase.fwidth())));
      // Dune ridges: relief for the air and the far plain, out to ~900 m. Faded in past
      // ~60 m: up close a lit normal with no shape under it read as dark wet streaks.
      const ridgePhase = broad.dot(perDune(tileId, dunes, (d) => swellVector(d, RIDGE_METRES)))
        .mul(Math.PI * 2).add(macro.sub(.5).mul(4)).add(bend.mul(1.5));
      const ridge = duneProfile(ridgePhase, dune.w.mul(.6)).mul(smoothstep(.25, .6, macro))
        .mul(smoothstep(30, 90, cameraDistance)).mul(oneMinus(smoothstep(600, 900, cameraDistance)))
        .mul(oneMinus(smoothstep(.6, 2.4, ridgePhase.fwidth())));
      const sandMean = mix(pigment('#b39a72'), pigment('#d6be96'), .5);
      const mineralMean = mix(pigment('#787b76'), pigment('#b6b7a5'), .5);
      const sand = mix(pigment('#b39a72'), pigment('#d6be96'), macro).div(sandMean)
        .mul(ripple.mul(oneMinus(crust)).mul(.055).add(1)).mul(swell.mul(oneMinus(crust.mul(.8))).mul(.06).add(1));
      const ridgeShade = hot.select(ridge.mul(.07).add(1), float(1));
      const mineral = mix(pigment('#787b76'), pigment('#b6b7a5'), macro).div(mineralMean)
        .mul(grain.sub(.5).mul(.18).mul(reach).add(1));
      const color = mix(vec3(1), hot.select(sand, mineral), oneMinus(smoothstep(160, 320, cameraDistance))).mul(ridgeShade);
      const height = hot.select(ripple.mul(.004).add(swell.mul(.12)).add(ridge.mul(.9)),
        smoothstep(.58, .8, grain).mul(.006).mul(reach));
      result.assign(vec4(color, height));
    });
    return result;
  })().toVar();
  return {
    apply(color, roughness, normal) {
      const relief = heightRelief(normal, sample.a);
      // The dried crust (the floor's cracked scan) lies flat, so ripples stay off the mud.
      // Faded through the relief's strength: scaling the height drew the mask's slope as an outline.
      const flat = hot.select(crust.mul(oneMinus(smoothstep(30, 60, cameraDistance))).mul(.85), float(0));
      // Mean-preserving gains retain the shared CPU far-color palette.
      return { color: color.mul(mix(vec3(1), sample.rgb, amount)),
        roughness: mix(roughness, hot.select(float(.93), float(.9)), amount),
        normal: mix(normal, relief, amount.mul(oneMinus(flat))).normalize() };
    },
    amount,
    height: sample.a,
  };
}
