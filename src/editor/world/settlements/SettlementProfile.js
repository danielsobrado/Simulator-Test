/**
 * What kind of place an Azgaar burg is, and what it looks like.
 *
 * Azgaar reports population in thousands. A town's size follows its population:
 * about one building per PEOPLE_PER_BUILDING people, capped at MAX_BUILDINGS, in a
 * radius that holds that many lots (kept tight, so a walled town is built up to its
 * wall rather than camped in a field). Classes rank the place (which landmarks,
 * walls and markets it earns) and set a hamlet's floor; the style is
 * chosen from the burg's culture so neighbouring towns of one people share
 * stone, roof and render. Pure data, safe in terrain workers.
 */

import { resolvePlaceIdentity } from '../../../worldIdentity/PlaceIdentityResolver.js';
import { resolveSceneRecipe } from '../../../worldIdentity/SceneRecipeResolver.js';

export const SETTLEMENT_CLASSES = Object.freeze([
  Object.freeze({ id: 'hamlet', maxPopulation: 0.6, radius: 55, buildings: 10, farms: 3 }),
  Object.freeze({ id: 'village', maxPopulation: 2.5, radius: 85, buildings: 26, farms: 5 }),
  Object.freeze({ id: 'town', maxPopulation: 10, radius: 115, buildings: 84, farms: 7 }),
  Object.freeze({ id: 'city', maxPopulation: 40, radius: 150, buildings: 170, farms: 9 }),
  Object.freeze({ id: 'metropolis', maxPopulation: Infinity, radius: 185, buildings: 240, farms: 10 }),
]);

const CLASS_RANK = Object.freeze(Object.fromEntries(SETTLEMENT_CLASSES.map(({ id }, index) => [id, index])));

/** Medieval occupancy: people per building, counting houses, shops and workshops. */
export const PEOPLE_PER_BUILDING = 7;
/** The most buildings one burg plans, so the largest cities stay affordable to plan and draw. */
export const MAX_BUILDINGS = 1500;
/** Plan area per building (m²): its lot plus its share of street and yard. */
export const LOT_AREA = 320;
const MAX_FARMS = 32;

/** Buildings and radius for a population (thousands), never below the class's own floor. */
export function townSize(population, size = classFor(population)) {
  const people = Math.max(0, Number.isFinite(population) ? population : 0) * 1000;
  const buildings = Math.min(MAX_BUILDINGS, Math.max(size.buildings, Math.round(people / PEOPLE_PER_BUILDING)));
  const radius = Math.max(size.radius, Math.sqrt(buildings * LOT_AREA / Math.PI));
  const farms = Math.min(MAX_FARMS, Math.max(size.farms, Math.round(buildings / 45)));
  return { buildings, radius, farms };
}

/** Farm belt, as a multiple of the town radius. */
export const FARM_BELT = Object.freeze({ inner: 1.12, outer: 1.75 });

export const SETTLEMENT_STYLES = Object.freeze([
  Object.freeze({ key: 'granite-slate', style: 'granite', topStyle: 'slate', finishes: ['limewash', 'ochre', 'masonry'] }),
  Object.freeze({ key: 'limestone-terracotta', style: 'limestone', topStyle: 'terracotta', finishes: ['limewash', 'ochre', 'rose'] }),
  Object.freeze({ key: 'sandstone-terracotta', style: 'sandstone', topStyle: 'terracotta', finishes: ['ochre', 'rose', 'limewash'] }),
  Object.freeze({ key: 'limestone-slate', style: 'limestone', topStyle: 'slate', finishes: ['limewash', 'masonry', 'ochre'] }),
  // Realm roof lines (VisualIdentityCatalog roofPitch): a culture style with a steep or low roof.
  Object.freeze({ key: 'granite-slate-steep', style: 'granite', topStyle: 'slate', finishes: ['limewash', 'masonry', 'ochre'], roofPitch: 50, roofOverhang: 0.5, walls: 'logs' }),
  Object.freeze({ key: 'granite-slate-low', style: 'granite', topStyle: 'slate', finishes: ['masonry', 'ochre', 'limewash'], roofPitch: 30, roofOverhang: 0.55 }),
  Object.freeze({ key: 'limestone-terracotta-low', style: 'limestone', topStyle: 'terracotta', finishes: ['limewash', 'rose', 'ochre'], roofPitch: 28, roofOverhang: 0.6 }),
]);

/** The styles a culture without a realm is hashed into; the rest are realm roof lines. */
const CULTURE_STYLES = SETTLEMENT_STYLES.slice(0, 4);

export function hashInts(...values) {
  let hash = 2166136261;
  for (const value of values) {
    hash ^= value | 0;
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

export function classFor(population) {
  const value = Number.isFinite(population) ? population : 0;
  return SETTLEMENT_CLASSES.find((entry) => value < entry.maxPopulation) ?? SETTLEMENT_CLASSES.at(-1);
}

export function classRank(classId) {
  return CLASS_RANK[classId] ?? 0;
}

const STYLE_BY_KEY = Object.freeze(
  Object.fromEntries(SETTLEMENT_STYLES.map((entry) => [entry.key, entry])),
);

export function hasExplicitRegionalContext(settlement = {}) {
  return Boolean(
    settlement && (
      settlement.culture !== undefined && settlement.culture !== null
      || settlement.cultureKey
      || settlement.loreRealm
      || settlement.stateName
      || settlement.localBranch
      || settlement.province !== undefined && settlement.province !== null
      || settlement.provinceName
    ),
  );
}

/** A realm's roof line: its style's steep or low sibling when its roofPitch is far from the pooled 40°. */
function withRoofLine(style, roofPitch) {
  if (!Number.isFinite(roofPitch)) return style;
  const line = roofPitch >= 46 ? 'steep' : (roofPitch <= 34 ? 'low' : null);
  return (line && STYLE_BY_KEY[`${style.key}-${line}`]) ?? style;
}

export function styleFor(settlement, recipe = null) {
  if (recipe?.architecture?.settlementStyleKey) {
    const styleKey = recipe.architecture.settlementStyleKey;
    const roofPitch = recipe.architecture.roofPitch;
    if (STYLE_BY_KEY[styleKey]) return withRoofLine(STYLE_BY_KEY[styleKey], roofPitch);
    if (styleKey === 'swamp-thatch' || styleKey === 'timber-thatch' || styleKey === 'goblin') {
      // Reed and stilt peoples: no thatch in the pool, so the steep slate roof stands in.
      return STYLE_BY_KEY['granite-slate-steep'];
    }
  }
  const culture = Number.isFinite(settlement.culture) ? settlement.culture : settlement.id;
  return CULTURE_STYLES[hashInts(culture, 0x5717e) % CULTURE_STYLES.length];
}

/**
 * Everything the planner needs to know about a burg beyond its position:
 * size class, the outer radius its plan may touch, its style, landmarks,
 * and resolved Drusniel PlaceIdentity + SceneRecipe.
 */
export function settlementProfile(settlement, options = {}) {
  const size = classFor(settlement.population);
  const rank = classRank(size.id);
  const scaled = townSize(settlement.population, size);
  const radius = scaled.radius * (0.9 + (hashInts(settlement.id, 0x7ad1) % 1000) / 1000 * 0.2);
  const walled = Boolean(settlement.walls) && rank >= 2;
  const hasRegionalIdentity = hasExplicitRegionalContext(settlement);
  const identity = resolvePlaceIdentity(settlement, options);
  const recipe = resolveSceneRecipe(identity, options);
  const style = hasRegionalIdentity ? styleFor(settlement, recipe) : styleFor(settlement);
  const farms = hasRegionalIdentity && recipe.streetConfig.suppressSurfaceFarms ? 0 : scaled.farms;
  return Object.freeze({
    ...size,
    buildings: scaled.buildings,
    farms,
    rank,
    radius,
    reach: radius * FARM_BELT.outer + 12,
    style,
    kitStyleKey: hasRegionalIdentity ? recipe.architecture.settlementStyleKey : style.key,
    hasRegionalIdentity,
    identity,
    recipe,
    walled,
    keep: Boolean(settlement.citadel) || (Boolean(settlement.capital) && rank >= 2),
    square: rank >= 1 || Boolean(settlement.plaza),
    chapel: rank >= 1 || Boolean(settlement.temple),
    market: rank >= 1,
    trade: rank >= 2,
    port: Boolean(settlement.port) || (hasRegionalIdentity && identity.geography.hasWaterAccess && Boolean(settlement.port)),
  });
}
