/**
 * How each kit surface is shaded by TownKitMaterial: its role (what a town's
 * skin tints and which per-building variation applies) and its relief.
 *
 * Relief is what makes walls read as built rather than printed:
 *   normal    normal-map strength (scans are subtle at 1x under a low sun)
 *   cavity    how dark the crevices the normal map describes get — mortar
 *             joints, slate laps and plank seams — baked into albedo
 *   parallax  parallax-offset depth in texture tiles; height is the albedo's
 *             own brightness, which for stone, slate and cobbles is a fair
 *             stand-in (faces are pale, joints dark)
 *   gain      albedo gain for scans photographed darker than the look wants
 *             (glTF colour factors cannot exceed 1)
 * Pure data.
 */

export const ROLE = Object.freeze({ other: 0, stone: 1, timber: 2, roof: 3, plaster: 4, banner: 5, paving: 6, cobble: 7, water: 8, foam: 9, mist: 10, flame: 11 });

const DEFAULT = Object.freeze({ role: ROLE.other, normal: 1, cavity: 0.2, parallax: 0, gain: 1 });

export const SURFACES = Object.freeze({
  M_stone: { role: ROLE.stone, normal: 2.35, cavity: 0.78, parallax: 0.036 },
  M_stone_ashlar: { role: ROLE.stone, normal: 2.0, cavity: 0.65, parallax: 0.024 },
  // One tooled block per piece: its chamfer, chisel striations, and pits draw it.
  M_stone_dressed: { role: ROLE.stone, normal: 1.85, cavity: 0.45, parallax: 0.008 },
  // Stonehold granite and basalt read near-black on shaded faces at their authored
  // albedo; lifted so dark stone still shows its courses out of the sun.
  M_stone_granite: { role: ROLE.stone, normal: 2.2, cavity: 0.62, parallax: 0.028, gain: 1.35 },
  M_stone_basalt: { role: ROLE.stone, normal: 0.9, cavity: 0.3, parallax: 0.006, gain: 1.1 },
  M_brick: { role: ROLE.stone, normal: 2.2, cavity: 0.72, parallax: 0.024 },
  // Own role: a small repeating scan, so the material lays it in ground space (TownKitMaterial).
  M_cobble: { role: ROLE.cobble, normal: 2.15, cavity: 0.72, parallax: 0.032 },
  // Stonehold: columnar cliff basalt (moss and rain streaks as stone) and terrace flagstones.
  M_rock_cliff: { role: ROLE.stone, normal: 1.15, cavity: 0.38, parallax: 0.012 },
  M_hold_wet_rock: { role: ROLE.stone, normal: 0.9, cavity: 0.3, parallax: 0.008 },
  M_hold_water: { role: ROLE.water, normal: 0.75, cavity: 0, parallax: 0, gain: 1 },
  M_hold_foam: { role: ROLE.foam, normal: 0.5, cavity: 0, parallax: 0, gain: 1 },
  M_hold_bronze: { role: ROLE.other, normal: 0.45, cavity: 0.15, parallax: 0 },
  M_hold_mist: { role: ROLE.mist, normal: 0, cavity: 0, parallax: 0 },
  M_hold_warm_stone: { role: ROLE.stone, normal: 0.8, cavity: 0.25, parallax: 0.006 },
  M_hold_flame: { role: ROLE.flame, normal: 0, cavity: 0, parallax: 0, gain: 1 },
  // Natural crags and boulders (sculpted, scanned rock_face_03).
  M_rock: { role: ROLE.stone, normal: 2.2, cavity: 0.7, parallax: 0.026 },
  M_stone_flag: { role: ROLE.paving, normal: 1.6, cavity: 0.6, parallax: 0.016 },
  M_roof: { role: ROLE.roof, normal: 2.3, cavity: 0.78, parallax: 0.028, gain: 1.05 },
  M_roof_terracotta: { role: ROLE.roof, normal: 2.0, cavity: 0.68, parallax: 0.024 },
  M_thatch: { role: ROLE.roof, normal: 1.9, cavity: 0.6, parallax: 0.022 },
  M_timber: { role: ROLE.timber, normal: 2.1, cavity: 0.6, parallax: 0.008, gain: 1.08 },
  M_wood_trim: { role: ROLE.timber, normal: 1.9, cavity: 0.55, parallax: 0.008, gain: 1.15 },
  M_carved_wood: { role: ROLE.timber, normal: 2.5, cavity: 0.78, parallax: 0.022, gain: 1.1 },
  M_planks: { role: ROLE.timber, normal: 1.9, cavity: 0.6, parallax: 0.012, gain: 1.15 },
  M_clapboard: { role: ROLE.timber, normal: 2.0, cavity: 0.65, parallax: 0.016, gain: 1.45 },
  M_plaster: { role: ROLE.plaster, normal: 1.6, cavity: 0.36, parallax: 0.004 },
  M_cloth_blue: { role: ROLE.banner, normal: 1, cavity: 0.2, parallax: 0 },
});

export function surfaceOf(materialName) {
  return { ...DEFAULT, ...SURFACES[materialName] };
}

/** Render tones a house may be washed in (multiplies the kit's cream render). */
export const RENDER_PALETTE = Object.freeze([
  [1.0, 0.98, 0.94],
  [1.05, 1.04, 1.01],
  [1.03, 0.94, 0.8],
  [1.04, 0.92, 0.86],
]);
