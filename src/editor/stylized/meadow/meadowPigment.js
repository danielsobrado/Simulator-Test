import { cameraPosition, color, dot, float, fract, mix, pow, smoothstep, uv, vec3, vec4 } from 'three/tsl';

import { stylizedPathWearMask } from '../StylizedNoiseNodes.js';
import { meadowCanopyColor, meadowCanopyView } from './meadowCanopy.js';
import { meadowPatchColors } from './meadowColorNodes.js';
import { applyGrassMarks } from './meadowGrassMarks.js';
import { MEADOW_GRASS_DEFAULTS } from './meadowGrassConfig.js';
import { meadowShortStand } from './meadowGrowthNodes.js';
import { applyMeadowGroundStyle, meadowGroundStyle } from './meadowGroundStyle.js';
import { meadowStandNodes } from './meadowStandNodes.js';
import { meadowTuftNodes } from './meadowTuftNodes.js';

/** Share of the root pigment the stem's foot keeps where it meets the soil. */
const SOIL_SHARE = 0.88;

const DEFAULT_PATH_FRINGE_COLOR = '#c2ad62';
const DEFAULT_PATH_FRINGE_STRENGTH = 0.55;
/** A seed stem's ripe tip. */
const STRAW_SEED = '#d6c088';

/**
 * The meadow pigment, after grass-test's `#configureMeadowMaterial`: a root that
 * stays dark most of the way up and a lit tip, drifting between cool and warm
 * patches across the field; a value shared by each tuft's stems so plants read
 * as one; contact shade and soil at the base so blades meet
 * the ground rather than float on a painted lawn; a per-blade value spread that
 * separates overlapping blades into layers instead of one flat sheet; straw tips
 * along a path's verge; and, with `marks`, the scorch, frost or blight a spell
 * left on the blades.
 *
 * Past `meltStart` the per-stem detail (tuft and blade value, contact shade,
 * soil foot) melts away and the gradient flattens toward the canopy colour, so
 * a distant stand reads as one lit surface with the ground's own value instead
 * of a speckle of separate spikes. `melted` forces it fully on (far cards).
 */
export function meadowPigment({ uniforms, tuning, config, blade, marks = false, melted = false }) {
  const appearance = uniforms.appearance;
  const height = uv().y.clamp(0, 1);
  const patchSettings = { ...MEADOW_GRASS_DEFAULTS.appearance, ...config.grass?.meadow?.appearance };
  const { tint, dry, dryColor } = meadowPatchColors(blade.canonical, patchSettings, {
    patchScale: appearance.patchScale, patchCool: uniforms.patchCool, patchWarm: uniforms.patchWarm,
  });
  const palette = uniforms.palette;
  const index = blade.palette.toInt();
  const bottom = palette ? palette.base.element(index) : tuning.colorBottom;
  const top = palette ? palette.tip.element(index) : tuning.colorTop;
  const brightness = palette?.brightness ?? tuning.brightness;
  // These fields are constant along a stem. Evaluate their noise at vertices,
  // then interpolate pigment instead of repeating it in every covered fragment.
  let root = mix(mix(bottom, top, appearance.groundTipMix).mul(tint), dryColor, dry);
  let tip = mix(top.mul(tint), dryColor.mul(1.06), dry.mul(0.45));
  const fringe = config.path?.fringe ?? {};
  if (fringe.enabled !== false) {
    const wear = stylizedPathWearMask(blade.path, blade.canonical, {
      vergeWidth: config.path?.vergeWidth ?? 0.45,
      vergeCut: config.path?.vergeCut ?? 0.72,
      edgeScale: config.path?.edgeScale ?? 0.42,
      edgeWarp: config.path?.edgeWarp ?? 0.18,
    });
    const straw = color(fringe.color ?? DEFAULT_PATH_FRINGE_COLOR)
      .mul(dot(tip, vec3(0.3, 0.59, 0.11)).mul(1.6).add(0.35));
    tip = mix(tip, straw, wear.verge.mul(fringe.strength ?? DEFAULT_PATH_FRINGE_STRENGTH).clamp(0, 1));
  }
  const stand = meadowStandNodes(blade.canonical, blade.rank);
  root = root.mul(stand.rootTone);
  tip = mix(tip.mul(stand.tipTone), color(STRAW_SEED).mul(dot(tip, vec3(0.3, 0.59, 0.11)).mul(1.1).add(0.45)), stand.seedStem.mul(0.75));
  if (uniforms.groundStyle) ({ root, tip } = applyMeadowGroundStyle(root, tip, meadowGroundStyle(blade.canonical, uniforms.groundStyle.mul(uniforms.growth.areaStyle.element(blade.growth.toInt())))));
  const tufts = uniforms.tufts;
  const occupancy = meadowTuftNodes(blade.canonical).occupancy;
  const melt = melted ? float(1) : smoothstep(appearance.meltStart, appearance.meltEnd, cameraPosition.distance(blade.base));
  const tuftValue = mix(occupancy.sub(0.5).mul(tufts.valueSpread.mul(2)).add(1), float(1), melt);
  root = root.mul(tuftValue);
  tip = tip.mul(tuftValue);
  if (marks && uniforms.spellGround) ({ root, tip } = applyGrassMarks(uniforms.spellGround, blade.base, root, tip));
  // Occupancy rides in the root varying's fourth lane: no extra vertex output.
  const rootData = vec4(root, occupancy).toVarying('meadowRootPigment');
  root = rootData.xyz;
  // Melt rides in the tip varying's fourth lane.
  const tipData = vec4(tip, melt).toVarying('meadowTipPigment');
  tip = tipData.xyz;
  const melting = tipData.w;
  const canopy = meadowCanopyColor(root, tip, appearance.canopyTipMix);
  // A short stem has no sward over its root: the whole blade is lit, so painting
  // most of it as root is what turned it into a black spike on sunlit ground.
  const short = meadowShortStand(uniforms.growth.dimensions.element(blade.growth.toInt()).y).toVarying('meadowShortStand');
  const gradient = mix(pow(height, appearance.gradientPower), height.sqrt(), short);
  const pigment = mix(mix(root, tip, gradient), canopy, melting.mul(appearance.meltFlatten));
  // Contact darkening belongs to dense interiors; an isolated stem's foot stays
  // near the ground's own value instead of punching a dark dot into it.
  const rootFloor = mix(appearance.rootBrightness, float(1), float(1).sub(rootData.w).mul(tufts.rootLift).max(short));
  const rootShade = mix(mix(rootFloor, 1, smoothstep(0, appearance.canopyDepth.max(0.01), height)), float(1), melting);
  // The foot meets the ground as the terrain shows it from this view
  // (MeadowGroundShading's root): soil-side from above, canopy when grazing.
  const soil = mix(root.mul(SOIL_SHARE), canopy, meadowCanopyView(appearance.canopyStrength));
  const based = mix(soil, pigment, smoothstep(0, 0.18, height).max(melting));
  const variation = mix(mix(vec3(0.93, 1, 0.9), vec3(1.07, 1, 0.86), blade.variation), vec3(1), melting);
  const bladeValue = mix(fract(blade.rank.mul(0.618034)).sub(0.5).mul(appearance.valueJitter).add(1), float(1), melting);
  return {
    pigment,
    bladeValue,
    color: based.mul(rootShade).mul(variation).mul(bladeValue).mul(brightness),
    height,
  };
}
