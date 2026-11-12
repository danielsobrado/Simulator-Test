import { vec2 } from 'three/tsl';
import { meadowNoise } from './meadowNoise.js';
import { MEADOW_PLANT_FIELD } from './meadowGrassShapes.js';

/**
 * Which plant a stem belongs to (a growth profile's `accents`).
 *
 * One plant-scale noise decides it, so whole clumps change together and read
 * as different plants in the sward: its high tail is the first accent, its low
 * tail the second, and everything between is the biome's own grass. An accent
 * swaps the silhouette and scales height and width. No instance data and no
 * extra draw: two uniform reads and one noise per stem vertex.
 *
 * @returns {{ shape: object, height: object, width: object }}
 */
export function meadowPlantNodes(uniforms, blade) {
  const index = blade.growth.toInt();
  const high = uniforms.growth.accents.element(index);
  const low = uniforms.growth.accents.element(index.add(16));
  const field = meadowNoise(blade.canonical.div(MEADOW_PLANT_FIELD.meters).add(vec2(...MEADOW_PLANT_FIELD.offset)));
  const isHigh = field.greaterThan(high.y);
  const isLow = field.lessThan(low.y);
  return {
    shape: isHigh.select(high.x, isLow.select(low.x, blade.shape)),
    height: isHigh.select(high.z, isLow.select(low.z, 1)),
    width: isHigh.select(high.w, isLow.select(low.w, 1)),
  };
}
