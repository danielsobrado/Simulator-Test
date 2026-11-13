import { resolveWorkshopOpeningLayout } from '../ProceduralWorkshopOpeningLayout.js';
import { centreOnFootprint, HouseKit } from './HouseKit.js';
import { TILES_PER_ROOF } from './HouseRoof.js';
import { buildStorey } from './HouseStoreys.js';
import { bakeryDesign } from './variants/Bakery.js';
import { barnDesign } from './variants/Barn.js';
import { chapelDesign } from './variants/Chapel.js';
import { cottageDesign } from './variants/Cottage.js';
import { deckTavernDesign } from './variants/DeckTavern.js';
import { farmhouseDesign } from './variants/Farmhouse.js';
import { generatedHouseDesign } from './variants/GeneratedHouse.js';
import { marketHallDesign } from './variants/MarketHall.js';
import { rowhouseDesign } from './variants/RowHouse.js';
import { shopDesign } from './variants/Shop.js';
import { smithyDesign } from './variants/Smithy.js';
import { tavernDesign } from './variants/Tavern.js';
import { townhouseDesign } from './variants/TownHouse.js';
import { warehouseDesign } from './variants/Warehouse.js';

const DESIGNS = Object.freeze({
  cottage: cottageDesign,
  tavern: tavernDesign,
  smithy: smithyDesign,
  townhouse: townhouseDesign,
  'deck-tavern': deckTavernDesign,
  generated: generatedHouseDesign,
  rowhouse: rowhouseDesign,
  shop: shopDesign,
  warehouse: warehouseDesign,
  farmhouse: farmhouseDesign,
  barn: barnDesign,
  bakery: bakeryDesign,
  chapel: chapelDesign,
  'market-hall': marketHallDesign,
});

function designFor(recipe) {
  const factory = DESIGNS[recipe.variant];
  if (!factory) throw new Error(`Unknown village house variant: ${recipe.variant}.`);
  return factory(recipe);
}

/**
 * Generate a timber-framed village house into the medieval pipeline's
 * material sets.
 *
 * Editable openings go through the same resolver as the manor's, so the
 * component editor's moves, resizes, duplicates and joined assemblies
 * regenerate the voids and inserts rather than dragging meshes over solid wall.
 */
export function buildVillageHouse(recipe, sets) {
  const house = designFor(recipe);
  const resolved = resolveWorkshopOpeningLayout(recipe, house.openings, house.hosts);
  const kit = new HouseKit(recipe, sets);
  const facades = new Map(house.storeys.map((storey) => [storey.id, buildStorey(kit, storey, resolved)]));
  house.build(kit, { resolved, facades });
  centreOnFootprint(sets);
  return sets;
}

/**
 * Conservative masonry-and-tile estimate for the preflight budget.
 *
 * Bounded from the recipe's outer dimensions, not by re-running the design, so
 * it over-estimates: no design lays stone above 60% of its eave height, and at
 * most two roofs per house (the main range and a wing or bay) are tiled, each
 * capped at `TILES_PER_ROOF`. Dormer roofs are never tiled.
 */
export function estimateVillageHouseParts(recipe) {
  const perimeter = 2 * (recipe.width + recipe.depth) + 8;
  const courses = Math.ceil(recipe.height * 0.65 / 0.28);
  const stones = Math.ceil(perimeter / 0.34) * courses + 260;
  const tiles = recipe.detail >= 3 ? TILES_PER_ROOF * 2 : 0;
  return stones + tiles;
}
