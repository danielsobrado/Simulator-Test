/**
 * The buildings and props a settlement plan may place, as workshop recipes.
 *
 * Each entry is a small, fixed set of variants — the building pool. A town
 * never asks for arbitrary dimensions: it picks a variant index, so a whole
 * world needs at most `styles × entries × variants` distinct meshes, and every
 * placement of one variant shares its geometry. `footprint` is the plot the
 * planner must reserve: the generated mesh's own extent (walls, roof overhang,
 * wings, stairs and sheds) plus a hand's breadth, so terraced plots in a town
 * core stand eave to eave instead of each in its own yard.
 *
 * Pure data, safe in terrain workers.
 */

import { SETTLEMENT_DOORS } from './SettlementDoors.generated.js';
import { SETTLEMENT_WINDOWS } from './SettlementWindows.generated.js';

const house = (variant, width, depth, height, footprint) => ({ archetype: 'house', variant, width, depth, height, footprint });
const prop = (variant, width = 2, height = 2, footprint = [1.4, 1.4]) => ({ archetype: 'prop', variant, width, depth: 1, height, footprint });
const castle = (archetype, width, depth, height, footprint, extra = {}) => ({ archetype, width, depth, height, footprint, ...extra });

export const SETTLEMENT_BUILDINGS = Object.freeze({
  house: Object.freeze([
    house('generated', 8, 6, 5.5, [9.2, 8]),
    house('generated', 10, 7, 7.5, [11.2, 12]),
    house('generated', 7, 5.5, 4.2, [8.8, 9.4]),
    house('generated', 9, 6.5, 6.5, [10.4, 9.2]),
    house('cottage', 9, 6, 5, [10.8, 11.4]),
  ]),
  townhouse: Object.freeze([
    house('rowhouse', 5.5, 9, 9, [6.4, 11.4]),
    house('townhouse', 11, 7, 10, [13, 10.4]),
    house('generated', 9, 7, 9.5, [10.6, 9.2]),
  ]),
  shop: Object.freeze([house('shop', 9, 7, 6.5, [10.2, 9]), house('shop', 7, 6, 5.5, [8.2, 8])]),
  tavern: Object.freeze([house('tavern', 7.5, 6, 4, [9.6, 8.2]), house('deck-tavern', 9, 6.5, 8, [11.4, 11.2])]),
  smithy: Object.freeze([house('smithy', 8, 5.5, 3.8, [10.5, 10.6])]),
  bakery: Object.freeze([house('bakery', 7, 5.5, 3.2, [9.4, 6.8])]),
  warehouse: Object.freeze([house('warehouse', 8, 10, 9, [9.2, 12.2])]),
  chapel: Object.freeze([house('chapel', 6.5, 11, 6, [8.2, 12.2])]),
  // Stands free in its square (SettlementMarkets), so its footprint is its own extent and eaves.
  markethall: Object.freeze([house('market-hall', 14, 8, 8, [15.6, 9.8])]),
  farmhouse: Object.freeze([house('farmhouse', 13, 6.5, 3.4, [14.4, 8]), house('farmhouse', 11, 6, 3, [12.4, 7.6])]),
  barn: Object.freeze([house('barn', 8, 11, 4.8, [9.2, 12.2])]),
  keep: Object.freeze([castle('square-tower', 9, 3, 12, [16, 16], { style: null, topStyle: 'battlements', ivy: true })]),
  hall: Object.freeze([castle('manor', 12, 3, 6.5, [18, 14], { towerSide: 'left', shape: 'stepped' })]),
  wall: Object.freeze([
    castle('wall', 12, 1.8, 6, [12, 5], { shape: 'classic', topStyle: 'battlements', windows: false }),
    // The same length, overgrown: the workshop grows ivy on castle archetypes.
    castle('wall', 12, 1.8, 6, [12, 5], { shape: 'classic', topStyle: 'battlements', windows: false, ivy: true }),
  ]),
  // The gate stands open: the road goes through it.
  gatehouse: Object.freeze([castle('gatehouse', 10, 3, 7, [16, 10], { topStyle: 'battlements', openDoorId: 'door-1' })]),
  tower: Object.freeze([castle('tower', 6, 2, 9, [8, 8], { topStyle: 'battlements' })]),
  well: Object.freeze([prop('well', 2, 3, [3.4, 3.4])]),
  fountain: Object.freeze([prop('fountain', 4.4, 3, [5, 5])]),
  stall: Object.freeze([prop('market-stall', 3, 2.6, [4.4, 3]), prop('market-stall', 2.5, 2.4, [3.9, 3])]),
  lantern: Object.freeze([prop('lantern-post', 2, 2.8), prop('walk-lantern', 2, 2)]),
  planter: Object.freeze([prop('planter', 2, 2, [2.4, 1])]),
  shrine: Object.freeze([prop('wayside-shrine', 2, 2.2), prop('wayside-cross', 2, 2.4, [1.6, 1.6])]),
  signpost: Object.freeze([prop('signpost', 2, 2.6)]),
  bench: Object.freeze([prop('bench', 2, 2, [2.4, 1])]),
  cart: Object.freeze([prop('cart', 2, 2, [2, 4])]),
  barrels: Object.freeze([prop('barrels', 2, 2, [2, 2.4]), prop('crates', 2, 2, [2, 2])]),
  fence: Object.freeze([prop('fence', 4, 2, [4.2, 0.6])]),
  bollards: Object.freeze([prop('bollards', 4.5, 2, [4.8, 0.6])]),
});

/** The main door of one pooled house in its footprint's frame, or null (SettlementDoors.generated). */
export function buildingDoor(styleKey, kind, variantIndex) {
  return SETTLEMENT_DOORS[poolKey(styleKey, kind, variantIndex)] ?? null;
}

/** The ground-floor windows of one pooled house in its footprint's frame (SettlementWindows.generated). */
export function buildingWindows(styleKey, kind, variantIndex) {
  return SETTLEMENT_WINDOWS[poolKey(styleKey, kind, variantIndex)] ?? [];
}

export function buildingEntry(kind, variantIndex) {
  const entries = SETTLEMENT_BUILDINGS[kind];
  if (!entries) throw new Error(`Unknown settlement building kind: ${kind}.`);
  return entries[variantIndex % entries.length];
}

/**
 * Which of a style's wall finishes a pooled variant wears. Fixed per variant —
 * not per placement — so a street mixes renders without multiplying the pool.
 */
export function finishIndexFor(kind, variantIndex) {
  let hash = 2166136261;
  for (const character of `${kind}:${variantIndex}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 3;
}

/** Stable identity of one pooled mesh: its style, kind and variant. */
export function poolKey(styleKey, kind, variantIndex) {
  return `${styleKey}|${kind}|${variantIndex % SETTLEMENT_BUILDINGS[kind].length}`;
}

/**
 * The workshop recipe for one pooled variant, in one settlement style. Seeds
 * derive from the pool key, so the same variant is the same building in every
 * town of that style, and different variants differ.
 *
 * A settlement house stands with its door open: the recipe names its main door
 * (`openDoorId`) and the workshop builds that doorway as a clear void with no
 * leaf; the view draws the leaf swung back and the room beyond
 * (SettlementInteriorGeometry). Shrinking the door with a component transform,
 * as this used to, shrank the opening too and filled the doorway with stone.
 */
export function buildingRecipe(style, kind, variantIndex, { detail = 2, finishIndex = finishIndexFor(kind, variantIndex), openDoor = true } = {}) {
  const { footprint: _footprint, ...entry } = buildingEntry(kind, variantIndex);
  let seed = 2166136261;
  for (const character of poolKey(style.key, kind, variantIndex)) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  const castleLike = !['house', 'prop'].includes(entry.archetype);
  const door = SETTLEMENT_DOORS[poolKey(style.key, kind, variantIndex)];
  return {
    style: style.style,
    topStyle: castleLike ? (entry.topStyle ?? 'battlements') : style.topStyle,
    // Walls, towers and keeps are stone through and through: a rendered finish
    // would paint their core, which shows on every wall top, in house colours.
    finish: castleLike ? 'masonry' : style.finishes[finishIndex % style.finishes.length],
    roofScale: 1,
    roofOverhang: style.roofOverhang ?? 0.5,
    walls: castleLike ? 'default' : (style.walls ?? 'default'),
    roofPitch: style.roofPitch ?? 40,
    weathering: 0.3,
    // Coursed and tidy. At the workshop's default (0.45) every stone is turned,
    // skewed and pushed out by up to a hand's breadth, and a street of such
    // walls reads as blocks jostling each other. A town is dressed stone: the
    // bevel on each block and the shadow in each joint draw it, as on the glade
    // walls (construction/), so the blocks themselves stay in their courses.
    irregularity: 0.14,
    windows: true,
    ivy: false,
    remesh: true,
    albedo: true,
    ...entry,
    ...(castleLike && entry.topStyle ? { topStyle: entry.topStyle } : {}),
    ...(entry.style === null ? { style: style.style } : {}),
    detail,
    seed: (seed >>> 0) & 0x7fffffff,
    ...(openDoor && door ? { openDoorId: door.id } : {}),
  };
}
