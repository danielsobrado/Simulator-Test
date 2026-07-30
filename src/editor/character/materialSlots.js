/**
 * Material slots.
 *
 * Every vertex on the figure carries its slot in `aux.x`, and the fragment
 * shader indexes the palette with it. Eight slots is not a budget worth
 * defending — it is what fits in two `vec4` arrays, which is what lets the whole
 * palette be one uniform upload and stay live-tunable.
 *
 * Slot 7 was spare in the source. It is the drow's eyes here, which is the only
 * emissive surface on the character.
 */
export const M_ROBE = 0; // black wool with a violet undertone
export const M_MANTLE = 1; // the piwafwi, the drow cloak
export const M_TUNIC = 2; // pale under-layer at the collar
export const M_LEATHER = 3; // belt, boots, gloves
export const M_SKIN = 4; // obsidian, deep in the cowl's shade
export const M_TRIM = 5; // pale violet banding and the house sigil
export const M_FUR = 6; // silver-white trim and hair
export const M_EYE = 7; // emissive

export const MATERIAL_SLOT_COUNT = 8;
