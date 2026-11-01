import { resolveMeadowGrowth } from './meadowGrowthProfiles.js';
import { validateLodBands } from './meadowGrassLayout.js';
import { resolveShapeTable } from './meadowGrassShapes.js';
import { encodeLookTable, resolveMeadowPalettes } from './meadowPalettes.js';
import { MEADOW_TUFT_DEFAULTS } from './meadowTuftField.js';

/**
 * Meadow grass settings (`stylizedSurface.grass.meadow`), resolved.
 *
 * Defaults are grass-test's "high" quality profile and cinematic meadow style,
 * converted from donor units at 2.8 per metre (the scale its character and blades
 * were measured at): blade 1.5 × 0.2 units → 0.54 × 0.071 m, bands out to 140
 * units → 50 m, per-unit densities × 2.8.
 */
export const MEADOW_GRASS_DEFAULTS = Object.freeze({
  tileSize: 8,
  maxDistance: 50,
  bladeHeight: 0.54,
  bladeWidth: 0.071,
  /** Patchy stand height: a slow noise picks each stem's scale in this range. */
  heightScale: Object.freeze([0.88, 1.22]),
  /** 1/m: the scale of that noise (donor 0.065 per unit). */
  heightNoiseScale: 0.18,
  widthScale: 1.05,
  /** Width at the tip relative to the root, before the silhouette's own profile. */
  taper: 0.62,
  /** Forward arc of a blade, as a share of its height. */
  curve: 0.045,
  baseBend: 0.1,
  stiffness: 1,
  lod: Object.freeze({
    // detail: segments; density: stems per metre along a tile side.
    high: Object.freeze({ detail: 5, density: 12.6, distance: 0.12 }),
    medium: Object.freeze({ detail: 3, density: 12.6, distance: 0.28 }),
    low: Object.freeze({ detail: 3, density: 5.6, distance: 0.6 }),
    veryLow: Object.freeze({ detail: 2, density: 2.8, distance: 1 }),
  }),
  appearance: Object.freeze({
    rootBrightness: 0.9,
    gradientPower: 2.6,
    groundTipMix: 0.12,
    groundOcclusion: 0,
    canopyDepth: 0.3,
    valueJitter: 0.35,
    backlight: 1.1,
    fill: 0.06,
    /** 1/m (donor 0.035 per unit): the cool/warm meadow colour patches. */
    patchScale: 0.1,
    patchCool: Object.freeze([0.84, 0.97, 1.03]),
    patchWarm: Object.freeze([1.13, 1.04, 0.77]),
    lodThinning: 1,
    lodCompensation: 1,
    lodWidenMax: 2,
    dryPatchScale: 0.0308,
    dryStart: 0.56,
    dryEnd: 0.84,
    dryStrength: 0,
    dryColor: '#777455',
    /** Canopy colour: share of the way from root to tip (meadowCanopy.js). */
    canopyTipMix: 0.4,
    /** How far the ground under a full stand leans to the canopy at a grazing view. */
    canopyStrength: 0.8,
    /** Metres over which per-stem detail melts into the field's shared shading. */
    meltStart: 12,
    meltEnd: 35,
    /** Share of a melted stem's root-to-tip gradient replaced by the canopy colour. */
    meltFlatten: 0.5,
    /** Share of the lush / dry / worn area field (meadowGroundStyle.js); 0 compiles it out. */
    groundStyle: 0,
  }),
  /**
   * The far meadow: billboard cards past the blades, each a clump of stems
   * (grass-test's `grass.far`, in metres: 150-unit chunks → 64 m tiles aligned to
   * the terrain chunk, card 3.4 × 2 units → 1.2 × 0.72 m).
   */
  far: Object.freeze({
    enabled: true,
    tileSize: 64,
    /** Cards per metre along a tile side. */
    density: 1.3,
    /** Metres: where the cards end. */
    distance: 180,
    width: 1.2,
    height: 0.72,
    /** Share of maxDistance where the blades start dissolving into the cards. */
    transitionStart: 0.8,
    /** Share of `distance` where the cards start dissolving out. */
    fadeStart: 0.9,
  }),
  /**
   * The player's body pressing the meadow over (grass-test's `InteractionMap`): a
   * small render-space stamp the blades read, in metres at this project's scale
   * (the donor's 75-unit window and 0.72-unit body become 27 m and 0.26 m).
   */
  interaction: Object.freeze({
    enabled: true,
    resolution: 256,
    worldSize: 27,
    recoverySpeed: 0.94,
    strength: 1,
    bodyRadius: 0.26,
    uploadIntervalFrames: 2,
  }),
  /**
   * The meadow's own pigment (grass-test's `grass.blade` base and tip), with
   * optional per-biome overrides (meadowPalettes.js). Null paints it with the
   * shared grass tuning's bottom and top colours instead.
   */
  palette: null,
  /** Milliseconds a frame may spend compacting tiles: the streaming budget. */
  buildBudgetMs: 2,
  shapes: Object.freeze({ default: 'slender', byTileId: Object.freeze({}) }),
  /** Plants and gaps inside a stand (meadowTuftField.js). */
  tufts: MEADOW_TUFT_DEFAULTS,
});

const TUFT_LIMITS = Object.freeze({
  height: [0, 1], lean: [0, 1], bendIsolated: [0, 6], bendCore: [0, 6],
  widthFloor: [0.05, 1], widthPower: [0, 2], windShort: [0, 1], rootLift: [0, 1], valueSpread: [0, 0.5],
});
/** The settings that leave stems as they stood before tufts. */
const UNTUFTED = Object.freeze({
  height: 0, lean: 0, bendIsolated: 1, bendCore: 1, widthFloor: 1, windShort: 1, rootLift: 0, valueSpread: 0,
});

function resolveTufts(source, path) {
  if (source?.enabled === false) return Object.freeze({ ...MEADOW_TUFT_DEFAULTS, ...UNTUFTED });
  const tufts = {};
  for (const [key, [min, max]] of Object.entries(TUFT_LIMITS)) {
    tufts[key] = finite(source?.[key], MEADOW_TUFT_DEFAULTS[key], `${path}.tufts.${key}`, { min, max });
  }
  return Object.freeze(tufts);
}

function finite(value, fallback, path, { min = -Infinity, max = Infinity } = {}) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be a number in [${min}, ${max}].`);
  }
  return resolved;
}

function pair(value, fallback, path) {
  const resolved = value ?? fallback;
  if (!Array.isArray(resolved) || resolved.length !== 2 || !resolved.every(Number.isFinite) || resolved[1] < resolved[0]) {
    throw new Error(`Invalid editor configuration: ${path} must be a [min, max] pair.`);
  }
  return [...resolved];
}

/**
 * @param {object | undefined} source `grass.meadow`
 * @returns {object | null} null when the meadow grass is off
 */
export function resolveMeadowGrassConfig(source) {
  if (!source || source.enabled === false) return null;
  const path = 'stylizedSurface.grass.meadow';
  const d = MEADOW_GRASS_DEFAULTS;
  const lod = source.lod ?? d.lod;
  validateLodBands(lod, `${path}.lod`);
  const appearance = { ...d.appearance, ...(source.appearance ?? {}) };
  finite(appearance.groundOcclusion, d.appearance.groundOcclusion, `${path}.appearance.groundOcclusion`, { min: 0, max: 1 });
  for (const key of ['rootBrightness', 'gradientPower', 'groundTipMix', 'canopyDepth', 'valueJitter', 'backlight', 'fill', 'patchScale', 'lodThinning', 'lodCompensation', 'lodWidenMax', 'dryPatchScale']) {
    finite(appearance[key], d.appearance[key], `${path}.appearance.${key}`, { min: 0 });
  }
  for (const key of ['canopyTipMix', 'canopyStrength', 'meltFlatten', 'dryStart', 'dryEnd', 'dryStrength', 'groundStyle']) {
    finite(appearance[key], d.appearance[key], `${path}.appearance.${key}`, { min: 0, max: 1 });
  }
  finite(appearance.meltStart, d.appearance.meltStart, `${path}.appearance.meltStart`, { min: 0 });
  finite(appearance.meltEnd, d.appearance.meltEnd, `${path}.appearance.meltEnd`, { min: 0 });
  if (appearance.meltEnd <= appearance.meltStart) {
    throw new Error(`Invalid editor configuration: ${path}.appearance.meltEnd must exceed meltStart.`);
  }
  if (appearance.dryEnd <= appearance.dryStart) {
    throw new Error(`Invalid editor configuration: ${path}.appearance.dryEnd must exceed dryStart.`);
  }
  if (typeof appearance.dryColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(appearance.dryColor)) {
    throw new Error(`Invalid editor configuration: ${path}.appearance.dryColor must be a #rrggbb colour.`);
  }
  const shapes = { ...d.shapes, ...(source.shapes ?? {}) };
  resolveShapeTable(shapes.byTileId, shapes.default);
  const farSource = { ...d.far, ...(source.far ?? {}) };
  const far = farSource.enabled === false ? null : {
    enabled: true,
    tileSize: finite(farSource.tileSize, d.far.tileSize, `${path}.far.tileSize`, { min: 8, max: 256 }),
    density: finite(farSource.density, d.far.density, `${path}.far.density`, { min: 0.05, max: 8 }),
    distance: finite(farSource.distance, d.far.distance, `${path}.far.distance`, { min: 1 }),
    width: finite(farSource.width, d.far.width, `${path}.far.width`, { min: 0.01 }),
    height: finite(farSource.height, d.far.height, `${path}.far.height`, { min: 0.01 }),
    transitionStart: finite(farSource.transitionStart, d.far.transitionStart, `${path}.far.transitionStart`, { min: 0, max: 1 }),
    fadeStart: finite(farSource.fadeStart, d.far.fadeStart, `${path}.far.fadeStart`, { min: 0, max: 1 }),
  };
  const growth = resolveMeadowGrowth(source.growth);
  const palette = resolveMeadowPalettes(source.palette ?? d.palette, `${path}.palette`);
  const interactionSource = { ...d.interaction, ...(source.interaction ?? {}) };
  const interaction = interactionSource.enabled === false ? null : {
    enabled: true,
    resolution: Math.round(finite(
      interactionSource.resolution,
      d.interaction.resolution,
      `${path}.interaction.resolution`,
      { min: 32, max: 1024 },
    )),
    worldSize: finite(interactionSource.worldSize, d.interaction.worldSize, `${path}.interaction.worldSize`, { min: 2, max: 200 }),
    recoverySpeed: finite(interactionSource.recoverySpeed, d.interaction.recoverySpeed, `${path}.interaction.recoverySpeed`, { min: 0, max: 1 }),
    strength: finite(interactionSource.strength, d.interaction.strength, `${path}.interaction.strength`, { min: 0, max: 4 }),
    bodyRadius: finite(interactionSource.bodyRadius, d.interaction.bodyRadius, `${path}.interaction.bodyRadius`, { min: 0.01, max: 5 }),
    uploadIntervalFrames: Math.round(finite(
      interactionSource.uploadIntervalFrames,
      d.interaction.uploadIntervalFrames,
      `${path}.interaction.uploadIntervalFrames`,
      { min: 1, max: 8 },
    )),
  };
  return {
    enabled: true,
    growth,
    tileSize: finite(source.tileSize, d.tileSize, `${path}.tileSize`, { min: 2, max: 64 }),
    maxDistance: finite(source.maxDistance, d.maxDistance, `${path}.maxDistance`, { min: 4, max: 400 }),
    bladeHeight: finite(source.bladeHeight, d.bladeHeight, `${path}.bladeHeight`, { min: 0.01, max: 4 }),
    bladeWidth: finite(source.bladeWidth, d.bladeWidth, `${path}.bladeWidth`, { min: 0.001, max: 1 }),
    heightScale: pair(source.heightScale, d.heightScale, `${path}.heightScale`),
    heightNoiseScale: finite(source.heightNoiseScale, d.heightNoiseScale, `${path}.heightNoiseScale`, { min: 0 }),
    widthScale: finite(source.widthScale, d.widthScale, `${path}.widthScale`, { min: 0 }),
    taper: finite(source.taper, d.taper, `${path}.taper`, { min: 0, max: 1 }),
    curve: finite(source.curve, d.curve, `${path}.curve`, { min: 0, max: 1 }),
    baseBend: finite(source.baseBend, d.baseBend, `${path}.baseBend`, { min: 0, max: 1 }),
    stiffness: finite(source.stiffness, d.stiffness, `${path}.stiffness`, { min: 0.1, max: 8 }),
    lod,
    appearance,
    tufts: resolveTufts(source.tufts, path),
    far,
    interaction,
    palette: palette ? { palettes: palette.palettes, brightness: palette.brightness } : null,
    buildBudgetMs: finite(source.buildBudgetMs, d.buildBudgetMs, `${path}.buildBudgetMs`, { min: 0.1, max: 50 }),
    // Shape and palette per tile id, as one look code (meadowPalettes.js).
    shapeTable: encodeLookTable(growth.shapes, palette?.table ?? null, growth.table),
  };
}
