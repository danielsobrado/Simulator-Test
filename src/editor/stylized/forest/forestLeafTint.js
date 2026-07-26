import * as THREE from 'three';
import { FOREST_SPECIES_PALETTES } from './ForestSpeciesGeometry.js';

/**
 * Per-grove autumn colour for tree canopies.
 *
 * The leaf material bakes its palette into the material, and one prototype serves
 * a whole species, so autumn cannot be a second set of prototypes without paying
 * for another pair of full-capacity InstancedMeshes per variant. Instead each
 * instance carries a `instanceLeafTint` multiplier, and the tint is keyed on the
 * grove rather than the tree: a stand turns as one, the way the reference art
 * reads, while `colorVariation` keeps per-tree brightness varied inside it.
 *
 * Tints are ratios against the species' own lit crown colour, so `tint * base`
 * lands on the target hue exactly rather than merely darkening toward it. That
 * keeps the material's height gradient and fbm variation intact — the whole
 * canopy shifts hue instead of flattening to one colour.
 *
 * The ratio is anchored on `leafTop` rather than the gradient's midpoint because
 * `leafTop` is the brightest colour the crown reaches. Anchoring there means the
 * target is the crown's ceiling, so no channel is driven past it and the shaded
 * underside stays proportionally darker; anchoring on the midpoint needed
 * multipliers above 4 and blew the top of the gradient out to white.
 */

/**
 * Autumn targets per species, ordered so a grove's seed picks one. Conifers and
 * tropical broadleaf keep their leaves, so they list none and never turn.
 */
const AUTUMN_TARGETS = Object.freeze({
  // Birch: the reference image's golds through to burnt orange.
  broadleaf_tall: Object.freeze(['#e8bc44', '#dd8f2f', '#c8592c']),
  broadleaf_round: Object.freeze(['#d9a336', '#c87a2c', '#b84b28']),
  wetland_sparse: Object.freeze(['#c9a441', '#ab8437']),
  tropical_tall: Object.freeze([]),
  conifer_narrow: Object.freeze([]),
  conifer_wide: Object.freeze([]),
});

/**
 * Canopy colour per biome, keyed on canonical Azgaar tile IDs.
 *
 * We have three authored broadleaf silhouettes, not one per biome, so hue is
 * what has to carry the difference between a savanna, a rainforest and a taiga.
 * These reuse the autumn machinery exactly — a ratio against the species' own
 * lit crown colour — so the crown's height gradient and fbm variation survive
 * and only its hue moves. Biomes absent from this table keep their species
 * palette untouched, which is what deserts, glacier, road and farm want.
 */
const BIOME_TARGETS = Object.freeze({
  3: '#aeae5a', // savanna: dry olive-gold
  4: '#86b04a', // grassland: fresh green
  5: '#6fae3e', // tropical seasonal forest
  6: '#6da03c', // temperate deciduous forest — the established reference look
  7: '#3f8f34', // tropical rainforest: deep and saturated
  8: '#4c9142', // temperate rainforest: deep and cool
  9: '#4a7a55', // taiga: blue-green
  10: '#8a9a62', // tundra: grey-green
  12: '#6f8f43', // wetland: olive
});

const UNTINTED = Object.freeze([1, 1, 1]);
// Headroom for turning a saturated green into a warm hue. Anchoring on `leafTop`
// keeps the required ratios near 3, so this only guards a near-black palette.
const MAX_CHANNEL_RATIO = 6;

/** Brightest colour the species' crown reaches, which the ratio divides by. */
function litCrownColor(speciesId, config, palettes) {
  const palette = palettes[speciesId] ?? null;
  return new THREE.Color(palette?.leafTop ?? config.trees.leafTop);
}

function tintRatio(target, base) {
  const safe = (numerator, denominator) => (
    denominator <= 1e-4
      ? MAX_CHANNEL_RATIO
      : Math.min(MAX_CHANNEL_RATIO, numerator / denominator)
  );
  return Object.freeze([
    safe(target.r, base.r),
    safe(target.g, base.g),
    safe(target.b, base.b),
  ]);
}

/**
 * Precomputes every tint a species can wear, so the per-instance lookup during an
 * LOD rebuild is an array index and allocates nothing.
 */
export function createForestLeafTintTable({
  config,
  palettes = FOREST_SPECIES_PALETTES,
  autumnTargets = AUTUMN_TARGETS,
  biomeTargets = BIOME_TARGETS,
} = {}) {
  const autumnShare = Math.min(1, Math.max(0, Number(config?.trees?.autumnGroves) || 0));
  const tintsBySpecies = new Map();
  for (const [speciesId, targets] of Object.entries(autumnTargets)) {
    if (targets.length === 0) continue;
    const base = litCrownColor(speciesId, config, palettes);
    tintsBySpecies.set(
      speciesId,
      Object.freeze(targets.map((target) => tintRatio(new THREE.Color(target), base))),
    );
  }

  // Every species crosses every biome, so this is at most a few dozen ratios.
  // Precomputing them keeps the per-instance lookup two map reads.
  const biomeTintsBySpecies = new Map();
  const speciesIds = new Set([
    ...Object.keys(autumnTargets),
    ...Object.keys(palettes),
  ]);
  for (const speciesId of speciesIds) {
    const base = litCrownColor(speciesId, config, palettes);
    const byTile = new Map();
    for (const [tileId, target] of Object.entries(biomeTargets)) {
      byTile.set(Number(tileId), tintRatio(new THREE.Color(target), base));
    }
    biomeTintsBySpecies.set(speciesId, byTile);
  }

  return {
    autumnShare,
    /**
     * Tint for one tree. `groveSeed` below `autumnShare` turns the grove; the
     * remainder of that range chooses which autumn colour, so a species with
     * three targets gives three recognisably different stands.
     *
     * Autumn wins outright over the biome hue rather than compounding with it:
     * both are absolute target colours expressed as ratios, so multiplying them
     * would land on neither. A turned grove is already saying what colour it is.
     */
    tintFor(speciesId, groveSeed, tileId = null) {
      if (autumnShare > 0 && groveSeed < autumnShare) {
        const tints = tintsBySpecies.get(speciesId);
        if (tints) {
          const position = groveSeed / autumnShare;
          return tints[Math.min(tints.length - 1, Math.floor(position * tints.length))];
        }
      }
      if (tileId === null) return UNTINTED;
      return biomeTintsBySpecies.get(speciesId)?.get(tileId) ?? UNTINTED;
    },
  };
}

export const FOREST_AUTUMN_TARGETS = AUTUMN_TARGETS;
export const FOREST_BIOME_TARGETS = BIOME_TARGETS;
export const FOREST_LEAF_TINT_UNTINTED = UNTINTED;
