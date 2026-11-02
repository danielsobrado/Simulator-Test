/** Array index of each floor scan; 0 is the path's own dirt, not a floor. */
export const GROUND_LAYERS = Object.freeze({ grit: 1, grass: 2, mossy: 3, litter: 4, cracked: 5, rock: 6 });
/** Linear mean of every neutral layer (scripts/bake-ground-layers.mjs). */
export const GROUND_LAYER_MEAN = 0.3;
