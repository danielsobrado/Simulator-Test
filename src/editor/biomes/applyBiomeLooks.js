import * as THREE from 'three';
import { biomeSnowCover } from './BiomeLooks.js';

/** How far a fully frosted tip leans to the frost colour; the root keeps more. */
const TIP_FROST = 0.8;
const BASE_FROST = 0.3;

function frosted(hex, frost, amount) {
  return `#${new THREE.Color(hex).lerp(new THREE.Color(frost), amount).getHexString()}`;
}

/**
 * The meadow palette with each biome's `snow.grass` folded in: tips lean to the
 * frost colour and roots a little, so a frosted stand stays one draw and one
 * uniform-array entry per biome, as before. A biome with frost but no palette
 * of its own frosts the base palette.
 *
 * @param {object|null|undefined} palette `grass.meadow.palette`
 */
export function frostMeadowPalette(palette, looks) {
  if (!palette) return palette;
  const byTileId = { ...(palette.byTileId ?? {}) };
  const frostByTile = biomeSnowCover(looks, 'grass');
  for (const [tile, frost] of Object.entries(frostByTile)) {
    const own = byTileId[tile] ?? { base: palette.base, tip: palette.tip };
    byTileId[tile] = {
      ...own,
      base: frosted(own.base, looks.frostColor, frost * BASE_FROST),
      tip: frosted(own.tip, looks.frostColor, frost * TIP_FROST),
    };
  }
  return { ...palette, byTileId };
}

/** Share of a stand's height a fully frosted biome loses: snow settles it. */
const SNOW_FLATTEN = 0.4;

/**
 * Meadow growth with each biome's `snow.grass` settling it: a frosted stand is
 * shorter, so it reads as tussocks through the snow rather than a summer field
 * on a white floor.
 *
 * @param {object|null|undefined} growth `grass.meadow.growth`
 */
export function settleMeadowGrowth(growth, looks) {
  if (!growth?.byTileId) return growth;
  const byTileId = { ...growth.byTileId };
  for (const [tile, frost] of Object.entries(biomeSnowCover(looks, 'grass'))) {
    const own = byTileId[tile];
    if (!own) continue;
    const scale = 1 - SNOW_FLATTEN * frost;
    byTileId[tile] = { ...own, shortHeight: own.shortHeight * scale, tallHeight: own.tallHeight * scale };
  }
  return { ...growth, byTileId };
}

/**
 * Hands each layer its column of the biome look table before the layers'
 * own validators run.
 *
 * - Ground snow becomes the terrain bake's and the far terrain's
 *   `snowBiomeCover`, which therefore cannot drift apart.
 * - Grass frost is folded into the meadow palette and settles its growth.
 * - The table itself rides on `stylizedSurface.biomeLooks` for the runtime
 *   readers (tree canopy hue and snow, snow-country air, snowfall).
 *
 * @param {object} config editor config, mutated
 * @param {object} bakeSource terrain-material-bake source, mutated
 * @param {object} looks resolveBiomeLooks
 */
export function applyBiomeLooks(config, bakeSource, looks) {
  const ground = biomeSnowCover(looks, 'ground');
  if (bakeSource?.classification) {
    bakeSource.classification.snowBiomeCover = { ...ground };
    // The far bake tints a glacier biome's snow toward bare ice (TerrainMaterialBakeFarColor).
    bakeSource.classification.glacierCover = Object.fromEntries([...looks.glacier]
      .flatMap((share, id) => (share > 0 ? [[id, share]] : [])));
  }
  if (config.world?.farTerrain) {
    config.world.farTerrain.snowBiomeCover = { ...ground };
    config.world.farTerrain.glacierCover = Object.fromEntries([...looks.glacier]
      .flatMap((share, id) => (share > 0 ? [[id, share]] : [])));
  }
  const meadow = config.stylizedSurface?.grass?.meadow;
  if (meadow?.palette) meadow.palette = frostMeadowPalette(meadow.palette, looks);
  if (meadow?.growth) meadow.growth = settleMeadowGrowth(meadow.growth, looks);
  config.stylizedSurface.biomeLooks = looks;
}
