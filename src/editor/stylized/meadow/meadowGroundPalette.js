import { meadowCanopyColor } from './meadowCanopy.js';
import { MEADOW_GRASS_DEFAULTS } from './meadowGrassConfig.js';
import { resolveMeadowPalettes } from './meadowPalettes.js';
import { linearColor } from './meadowColorSpace.js';
import { resolveMeadowGroundDetail } from './meadowGroundDetailConfig.js';
import { meadowGroundMean } from './meadowGroundMean.js';
import { resolveMeadowGrowth } from './meadowGrowthProfiles.js';
export { linearColor } from './meadowColorSpace.js';

/** Small immutable lookup shared by terrain shading and its CPU far-color bake. */
export function createMeadowGroundPalette(config) {
  const source = config?.grass?.meadow;
  if (config?.grass?.system !== 'meadow' || !source || source.enabled === false || !source.palette) return null;
  const palette = resolveMeadowPalettes(source.palette, 'stylizedSurface.grass.meadow.palette');
  const appearance = { ...MEADOW_GRASS_DEFAULTS.appearance, ...source.appearance };
  const roots = new Float32Array(256 * 3);
  const tips = new Float32Array(256 * 3);
  // Canopy pigment per biome, and how strongly its ground shows it (density).
  const canopies = new Float32Array(256 * 4);
  // The ground as seen from afar, always at a grazing angle: the far bake's colour.
  const far = new Float32Array(256 * 3);
  const areaStyles = new Float32Array(256);
  const colors = palette.palettes.map(({ base, tip }) => ({ base: linearColor(base), tip: linearColor(tip) }));
  const detail = resolveMeadowGroundDetail(source.groundDetail);
  const growth = resolveMeadowGrowth(source.growth);
  const soil = linearColor(config.dirt?.color ?? '#63513d');
  for (let id = 0; id < 256; id++) {
    const { base, tip } = colors[palette.table[id]];
    areaStyles[id] = growth.profiles[growth.table[id]].areaStyle;
    for (let channel = 0; channel < 3; channel++) {
      roots[id * 3 + channel] = (base[channel] + (tip[channel] - base[channel]) * appearance.groundTipMix)
        * palette.brightness;
      tips[id * 3 + channel] = tip[channel] * palette.brightness;
    }
    if (detail) {
      const root = Array.from(roots.subarray(id * 3, id * 3 + 3));
      roots.set(meadowGroundMean(root, soil, detail.litter.subarray(id * 4, id * 4 + 4),
        detail.amounts.subarray(id * 4, id * 4 + 4), detail.strength), id * 3);
    }
    // Stand depth belongs in both the close substrate and its distant bake.
    // Sparse tundra retains its exposed floor; a dense meadow has darker gaps.
    const occlusion = 1 - (appearance.groundOcclusion ?? 0)
      * growth.profiles[growth.table[id]].density;
    for (let channel = 0; channel < 3; channel++) roots[id * 3 + channel] *= occlusion;
    const bladeRoot = base.map((value, channel) => (value + (tip[channel] - value) * appearance.groundTipMix)
      * palette.brightness);
    const canopy = meadowCanopyColor(bladeRoot, tips.subarray(id * 3, id * 3 + 3), appearance.canopyTipMix);
    const weight = (appearance.canopyStrength ?? 0) * growth.profiles[growth.table[id]].density;
    canopies.set([...canopy, weight], id * 4);
    for (let channel = 0; channel < 3; channel++) {
      const root = roots[id * 3 + channel];
      far[id * 3 + channel] = root + (canopy[channel] - root) * weight;
    }
  }
  return { roots, tips, canopies, far, areaStyles, appearance, brightness: palette.brightness };
}
