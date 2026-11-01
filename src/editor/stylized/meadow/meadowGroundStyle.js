import { color, dot, mix, smoothstep, vec2, vec3 } from 'three/tsl';
import { meadowNoise } from './meadowNoise.js';

const LUMA = vec3(0.3, 0.59, 0.11);
/** Bleached sward; scaled by the biome's own value so a dark bog gets dark straw. */
const STRAW = '#c6b986';
/** Trodden earth showing through a worn stand. */
const EARTH = '#7c6a4c';
const LUSH_ROOT = [0.62, 0.84, 0.6];
const LUSH_TIP = [0.72, 0.9, 0.64];
/** Stems stand shorter here, so page bounds never need to grow for it. */
const DRY_HEIGHT = 0.86;
const WORN_HEIGHT = 0.72;

/**
 * Which ground an area is: lush green hollows, pale dry sward, worn thin earth.
 * Three noise fields over canonical metres, one of them a fine warp that breaks
 * the patch edges, shared by terrain, blades and far cards so a stand always
 * agrees with the ground it grows from.
 *
 * @param {object} canonical vec2 canonical metres
 * @param {object | number} strength 0..1 share of the effect
 */
export function meadowGroundStyle(canonical, strength) {
  const warp = meadowNoise(canonical.div(7).add(vec2(71.3, 11.9))).sub(0.5);
  // The warp also adds to the field itself, so patches shed islands, not one clean rim.
  const area = meadowNoise(canonical.div(28).add(vec2(3.7, 29.1)).add(warp.mul(1.3))).add(warp.mul(0.35));
  const bare = meadowNoise(canonical.div(19).add(vec2(47.9, 83.3)).sub(warp.mul(1.1))).add(warp.mul(0.3));
  const lush = smoothstep(0.5, 0.3, area).mul(strength);
  const dry = smoothstep(0.5, 0.74, area).mul(strength);
  const worn = smoothstep(0.58, 0.8, bare).mul(lush.oneMinus()).mul(strength);
  return { lush, dry, worn, height: mix(1, DRY_HEIGHT, dry).mul(mix(1, WORN_HEIGHT, worn)) };
}

/** Repaint a root/tip pair for its area; the ground and the blades share this. */
export function applyMeadowGroundStyle(root, tip, { lush, dry, worn }) {
  const rootValue = dot(root, LUMA).mul(1.4).add(0.4);
  const tipValue = dot(tip, LUMA).mul(0.6).add(0.6);
  const straw = color(STRAW);
  const earth = color(EARTH);
  const styledRoot = mix(mix(root.mul(mix(vec3(1), vec3(...LUSH_ROOT), lush)), straw.mul(rootValue), dry.mul(0.5)),
    earth.mul(rootValue), worn.mul(0.5));
  const styledTip = mix(tip.mul(mix(vec3(1), vec3(...LUSH_TIP), lush)), straw.mul(tipValue),
    dry.mul(0.55).add(worn.mul(0.3)).clamp(0, 1));
  return { root: styledRoot, tip: styledTip };
}
