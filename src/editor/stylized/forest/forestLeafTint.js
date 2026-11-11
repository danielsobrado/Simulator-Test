import * as THREE from 'three';
import { FOREST_SPECIES_PALETTES } from './ForestSpeciesGeometry.js';
import { resolveCanopyGrade } from './canopyGrade.js';

/** Biomes whose broadleaf groves turn: grassland and temperate deciduous forest. */
export const AUTUMN_TILE_IDS = Object.freeze(new Set([4, 6]));

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
 *
 * Textured (authored) crowns do not wear the species palette: the canopy grade
 * has already moved them onto its own shade→light ramp. Their ratios are anchored
 * on the grade's light colour instead; divided by `leafTop` they turned graded
 * crowns teal or brown rather than onto the biome's hue.
 */

/**
 * Autumn targets per species, ordered so a grove's seed picks one. Conifers and
 * tropical broadleaf keep their leaves, so they list none and never turn.
 */
const AUTUMN_TARGETS = Object.freeze({
  // Birch: the reference image's golds through to burnt orange.
  broadleaf_tall: Object.freeze(['#e8bc44', '#dd8f2f', '#c8592c']),
  broadleaf_round: Object.freeze(['#d9a336', '#c87a2c', '#b84b28']),
  // Swamp giants keep their dark leaves through the year.
  wetland_sparse: Object.freeze([]),
  tropical_tall: Object.freeze([]),
  conifer_narrow: Object.freeze([]),
  conifer_wide: Object.freeze([]),
});

/*
 * Canopy colour per biome is the biome look table's `canopy` column
 * (config/biome-looks.yaml), keyed on terrain tile ids.
 *
 * We have three authored broadleaf silhouettes, not one per biome, so hue is
 * what has to carry the difference between a savanna, a rainforest and a taiga.
 * These reuse the autumn machinery exactly — a ratio against the species' own
 * lit crown colour — so the crown's height gradient and fbm variation survive
 * and only its hue moves. Biomes absent from the column keep their species
 * palette untouched, which is what deserts, glacier, road and farm want.
 */

const UNTINTED = Object.freeze([1, 1, 1]);
// Headroom for turning a saturated green into a warm hue. Anchoring on `leafTop`
// keeps the required ratios near 3, so this only guards a near-black palette.
const MAX_CHANNEL_RATIO = 6;
/** Exponent on a graded crown's biome ratio: how far its hue follows the biome. */
const GRADED_BIOME_STRENGTH = 0.3;

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
  biomeTargets = config?.biomeLooks?.canopy ?? {},
} = {}) {
  const autumnShare = Math.min(1, Math.max(0, Number(config?.trees?.autumnGroves) || 0));
  const grade = resolveCanopyGrade(config?.trees?.canopyGrade);
  const gradedCrown = grade ? new THREE.Color(grade.light) : null;
  const speciesIds = new Set([
    ...Object.keys(autumnTargets),
    ...Object.keys(palettes),
  ]);
  // One set of ratios per anchor: the species palette, and the graded crown.
  // A graded crown already carries its donor's look; its biome hue is a nudge
  // (ratio^0.3), not a recolour — at full strength the saturated biome greens
  // stripped the grade's warm light end back to kelly green.
  const soften = (ratio) => Object.freeze(ratio.map((channel) => channel ** GRADED_BIOME_STRENGTH));
  const buildTables = (baseFor, biomeShape = (ratio) => ratio) => {
    const autumn = new Map();
    for (const [speciesId, targets] of Object.entries(autumnTargets)) {
      if (targets.length === 0) continue;
      const base = baseFor(speciesId);
      autumn.set(speciesId, Object.freeze(targets.map((target) => tintRatio(new THREE.Color(target), base))));
    }
    // Every species crosses every biome, so this is at most a few dozen ratios.
    // Precomputing them keeps the per-instance lookup two map reads.
    const biome = new Map();
    for (const speciesId of speciesIds) {
      const base = baseFor(speciesId);
      const byTile = new Map();
      for (const [tileId, target] of Object.entries(biomeTargets)) {
        byTile.set(Number(tileId), biomeShape(tintRatio(new THREE.Color(target), base)));
      }
      biome.set(speciesId, byTile);
    }
    return { autumn, biome };
  };
  const palette = buildTables((speciesId) => litCrownColor(speciesId, config, palettes));
  const graded = gradedCrown ? buildTables(() => gradedCrown, soften) : palette;

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
    tintFor(speciesId, groveSeed, tileId = null, preserveAuthoredColor = false, gradedCrown = false) {
      // Painted snow and needles share a crown. A biome's green multiplier
      // would recolor the settled snow too, across mesh and impostor bands.
      if (preserveAuthoredColor) return UNTINTED;
      const tables = gradedCrown ? graded : palette;
      if (autumnShare > 0 && groveSeed < autumnShare && (tileId === null || AUTUMN_TILE_IDS.has(tileId))) {
        const tints = tables.autumn.get(speciesId);
        if (tints) {
          const position = groveSeed / autumnShare;
          return tints[Math.min(tints.length - 1, Math.floor(position * tints.length))];
        }
      }
      if (tileId === null) return UNTINTED;
      return tables.biome.get(speciesId)?.get(tileId) ?? UNTINTED;
    },
  };
}

export const FOREST_AUTUMN_TARGETS = AUTUMN_TARGETS;
export const FOREST_LEAF_TINT_UNTINTED = UNTINTED;
