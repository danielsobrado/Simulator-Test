import { hash32 } from '../scatterMath.js';
import { deriveForestPlacementMorphology } from './morphology/index.js';
import { valueNoise } from '../../world/valueNoise2d.js';

/** Metres across one grove or gap. */
const GROVE_SCALE = 48;
const GROVE_SEED = 0x67726f76;

/**
 * A slow field on the spacing radius, 0.55 in a grove to 1.3 in a gap, so a wood
 * masses into stands and clearings instead of an even grid of crowns (coherence
 * plan, stage 8). A placement without a position keeps its species' spacing.
 */
export function groveSpacingFactor(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 1;
  const grove = valueNoise(x / GROVE_SCALE, z / GROVE_SCALE, GROVE_SEED) * 0.5 + 0.5;
  return 0.55 + grove * 0.75;
}

const AGE_CLASSES = Object.freeze({
  sapling: Object.freeze({ height: 0.48, trunk: 0.58, crown: 0.55, spacing: 0.55 }),
  young: Object.freeze({ height: 0.76, trunk: 0.78, crown: 0.8, spacing: 0.78 }),
  mature: Object.freeze({ height: 1, trunk: 1, crown: 1, spacing: 1 }),
  ancient: Object.freeze({ height: 1.2, trunk: 1.28, crown: 1.18, spacing: 1.22 }),
  dead: Object.freeze({ height: 0.92, trunk: 0.94, crown: 0.42, spacing: 0.82 }),
});

const DEFAULT_SPECIES = Object.freeze({
  broadleaf_round: Object.freeze({
    spacing: 3.8, crownAspect: 1.08, color: '#397d3f', waterAffinity: 0.2,
  }),
  broadleaf_tall: Object.freeze({
    spacing: 3.4, crownAspect: 0.78, color: '#347746', waterAffinity: 0.15,
  }),
  conifer_narrow: Object.freeze({
    spacing: 3.1, crownAspect: 0.48, color: '#315d3a', waterAffinity: -0.1,
  }),
  conifer_wide: Object.freeze({
    spacing: 3.7, crownAspect: 0.68, color: '#3a6840', waterAffinity: -0.05,
  }),
  tropical_tall: Object.freeze({
    spacing: 4.1, crownAspect: 0.72, color: '#2f8240', waterAffinity: 0.25,
  }),
  wetland_sparse: Object.freeze({
    spacing: 5.2, crownAspect: 0.82, color: '#3f5a33', waterAffinity: 0.8,
  }),
});

const DEFAULT_PALETTES = Object.freeze({
  savanna: Object.freeze(['broadleaf_round']),
  grassland: Object.freeze(['broadleaf_round', 'broadleaf_tall']),
  tropical_seasonal_forest: Object.freeze(['tropical_tall', 'broadleaf_round']),
  temperate_deciduous_forest: Object.freeze(['broadleaf_round', 'broadleaf_tall']),
  tropical_rainforest: Object.freeze(['tropical_tall', 'broadleaf_tall', 'broadleaf_round']),
  temperate_rainforest: Object.freeze(['conifer_wide', 'broadleaf_tall']),
  taiga: Object.freeze(['conifer_narrow', 'conifer_wide']),
  tundra: Object.freeze(['conifer_narrow']),
  // Swamp giants, with the odd stand of dark narrow spruce on the drier islands.
  wetland: Object.freeze([...Array(11).fill('wetland_sparse'), 'conifer_narrow']),
});

/**
 * Standing forms of a broadleaf: tall and narrow, broad and spreading, and two
 * nearer the mean. A multiplier on crown width and aspect, because the instance
 * morphology is what the far impostors carry too.
 */
const BROADLEAF_FORMS = Object.freeze([
  Object.freeze({ width: 0.74, aspect: 1.2 }),
  Object.freeze({ width: 1.24, aspect: 0.82 }),
  Object.freeze({ width: 1, aspect: 1 }),
  Object.freeze({ width: 0.9, aspect: 1.08 }),
]);

/**
 * Fraction of trees that ignore their grove's dominant species. Real stands are
 * not monocultures, but they are not uniform mixes either — a birch grove reads
 * as birch precisely because the odd spruce in it is the exception.
 */
const DEFAULT_GROVE_MIX = 0.16;

function stableUnit(stableId, channel) {
  let value = Math.imul(channel + 1, 0x9e3779b1);
  for (let index = 0; index < stableId.length; index += 1) {
    value = Math.imul(value ^ stableId.charCodeAt(index), 0x85ebca6b);
  }
  return hash32(value) / 0xffffffff;
}

/** Index into `weights` selected by `roll`, which must be in [0, 1). */
function pickWeighted(weights, roll) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let remaining = roll * total;
  for (let index = 0; index < weights.length; index += 1) {
    remaining -= weights[index];
    if (remaining < 0) return index;
  }
  return weights.length - 1;
}

function weightedAge(edge, coverage, random) {
  const edgeBias = Math.min(1, Math.max(0, edge));
  const coreBias = Math.min(1, Math.max(0, coverage - edgeBias * 0.35));
  if (random < 0.025) return 'dead';
  if (random < 0.12 + edgeBias * 0.28) return 'sapling';
  // Young trees fill the subcanopy of a mature stand, not only its fringe.
  if (random < 0.46 + edgeBias * 0.25) return 'young';
  if (random > 0.93 && coreBias > 0.65) return 'ancient';
  return 'mature';
}

export class ForestSpeciesRegistry {
  constructor({
    species = {},
    palettes = {},
    prototypeCount = 1,
    prototypeIndexBySpecies = null,
    prototypeTileIds = null,
    prototypePreferredTileIds = null,
    prototypeAgeClasses = null,
    groveMix = DEFAULT_GROVE_MIX,
  } = {}) {
    this.species = new Map();
    for (const [id, definition] of Object.entries({ ...DEFAULT_SPECIES, ...species })) {
      this.species.set(id, Object.freeze({
        id,
        spacing: Math.max(0.1, Number(definition.spacing) || 3.5),
        crownAspect: Math.max(0.1, Number(definition.crownAspect) || 1),
        color: String(definition.color ?? '#3d7540'),
        waterAffinity: Math.min(1, Math.max(-1, Number(definition.waterAffinity) || 0)),
      }));
    }
    this.palettes = { ...DEFAULT_PALETTES, ...palettes };
    this.prototypeCount = Math.max(1, Math.trunc(prototypeCount) || 1);
    // Without an explicit mapping every species draws from the whole prototype
    // range, so `speciesId` carries no geometry — the pre-species behaviour.
    this.prototypeIndexBySpecies = prototypeIndexBySpecies ?? null;
    // Biomes a given prototype is restricted to, by prototype index. Absent from
    // the map means "everywhere". This is how an expensive or strongly
    // characterful tree is confined to the biomes it belongs in without giving
    // it a species of its own.
    this.prototypeTileIds = prototypeTileIds?.size > 0 ? prototypeTileIds : null;
    this.prototypePreferredTileIds = prototypePreferredTileIds?.size > 0 ? prototypePreferredTileIds : null;
    // Age classes a prototype is reserved for, by prototype index (a snag for
    // `dead`). A tagged prototype is drawn only for those trees, and they draw
    // nothing else while one exists for their species and biome.
    this.prototypeAgeClasses = prototypeAgeClasses?.size > 0 ? prototypeAgeClasses : null;
    this.prototypeTileCache = new Map();
    this.groveMix = Math.min(1, Math.max(0, Number(groveMix) || 0));
    this.signature = JSON.stringify({
      species: [...this.species.values()],
      palettes: this.palettes,
      prototypeCount: this.prototypeCount,
      groveMix: this.groveMix,
      prototypeIndices: this.prototypeIndexBySpecies
        ? [...this.prototypeIndexBySpecies.map.entries()]
        : null,
      prototypeTileIds: this.prototypeTileIds
        ? [...this.prototypeTileIds.entries()].map(([index, tiles]) => [index, [...tiles]])
        : null,
      prototypePreferredTileIds: this.prototypePreferredTileIds
        ? [...this.prototypePreferredTileIds.entries()].map(([index, tiles]) => [index, [...tiles]])
        : null,
      prototypeAgeClasses: this.prototypeAgeClasses
        ? [...this.prototypeAgeClasses.entries()].map(([index, ages]) => [index, [...ages]])
        : null,
    });
  }

  /**
   * Prototype indices able to render `speciesId` in `tileId` at `ageClass`, in
   * ascending order, preferring authored specialists for that biome when available.
   * A restriction that would leave the species with nothing is ignored
   * rather than applied, so a tree always has something to draw.
   */
  prototypesFor(speciesId, tileId = null, ageClass = null) {
    if (!this.prototypeIndexBySpecies) return null;
    const configured = this.prototypeIndexBySpecies.map.get(speciesId);
    const indices = configured?.length > 0 ? configured : this.prototypeIndexBySpecies.fallback;
    const byTile = (this.prototypeTileIds || this.prototypePreferredTileIds) && tileId !== null && tileId !== undefined;
    if (!byTile && !this.prototypeAgeClasses) return indices;
    const cacheKey = `${speciesId}:${tileId}:${ageClass}`;
    const cached = this.prototypeTileCache.get(cacheKey);
    if (cached) return cached;
    let result = indices;
    if (byTile) {
      const allowed = indices.filter((index) => {
        const tiles = this.prototypeTileIds?.get(index);
        return !tiles || tiles.has(tileId);
      });
      // Biome specialists replace generic prototypes without changing species,
      // morphology, or instance pools. Preferences never bypass eligibility.
      const preferred = allowed.filter(index => this.prototypePreferredTileIds?.get(index)?.has(tileId));
      result = preferred.length > 0 ? preferred : allowed.length > 0 ? allowed : indices;
    }
    const ages = this.prototypeAgeClasses;
    if (ages) {
      const tagged = result.filter((index) => ages.get(index)?.has(ageClass));
      const untagged = result.filter((index) => !ages.has(index));
      result = tagged.length > 0 ? tagged : untagged.length > 0 ? untagged : result;
    }
    this.prototypeTileCache.set(cacheKey, result);
    return result;
  }

  /**
   * Weights a palette by how much each species wants to be near water. Species
   * with `waterAffinity > 0` gain share on wet ground and lose it on dry, and the
   * reverse for negative affinity, so a shoreline reads as willow-and-alder while
   * the slope behind it stays coniferous. Uniform when the habitat carries no
   * riparian signal, which keeps the pre-water behaviour for callers that pass a
   * bare habitat.
   */
  paletteWeights(usable, habitat) {
    const wetness = Number.isFinite(habitat.riparian)
      ? Math.min(1, Math.max(0, habitat.riparian))
      : 0;
    if (wetness <= 0) return usable.map(() => 1);
    return usable.map((id) => {
      const affinity = this.species.get(id).waterAffinity;
      return Math.max(0.05, 1 + affinity * wetness * 2);
    });
  }

  /**
   * Species for one tree. The roll is keyed on the grove rather than the tree, so
   * a patch comes out dominated by a single species — a birch stand, then a spruce
   * stand — instead of every patch averaging out to the same biome mix. A
   * `groveMix` share still rolls per tree, which keeps the odd off-species tree
   * and softens patch boundaries.
   *
   * Habitats with no `patchId` (bare habitats from callers that do not run the
   * patch field) fall back to rolling per tree throughout.
   */
  selectSpecies(candidate, habitat, usable, weights) {
    const grove = habitat.patchId;
    if (!grove || stableUnit(candidate.stableId, 79) < this.groveMix) {
      return usable[pickWeighted(weights, stableUnit(candidate.stableId, 41))];
    }
    return usable[pickWeighted(weights, stableUnit(grove, 41))];
  }

  select(candidate, habitat) {
    const configured = this.palettes[habitat.profileKey] ?? ['broadleaf_round'];
    const palette = configured.filter((id) => this.species.has(id));
    const usable = palette.length > 0 ? palette : ['broadleaf_round'];
    const weights = this.paletteWeights(usable, habitat);
    const speciesId = this.species.has(candidate.speciesId)
      ? candidate.speciesId
      : this.selectSpecies(candidate, habitat, usable, weights);
    const species = this.species.get(speciesId);
    const ageClass = AGE_CLASSES[candidate.ageClass]
      ? candidate.ageClass
      : weightedAge(
        habitat.patchEdge,
        habitat.patchCoverage,
        stableUnit(candidate.stableId, 43),
      );
    const age = AGE_CLASSES[ageClass];
    const individualVariation = 0.9 + stableUnit(candidate.stableId, 47) * 0.2;
    const speciesPrototypes = this.prototypesFor(speciesId, habitat.tileId, ageClass);
    const prototypeRoll = stableUnit(`${speciesId}:${candidate.stableId}`, 53);
    const prototypeIndex = speciesPrototypes
      ? speciesPrototypes[Math.min(
        speciesPrototypes.length - 1,
        Math.floor(prototypeRoll * speciesPrototypes.length),
      )]
      : Math.min(
        this.prototypeCount - 1,
        Math.floor(prototypeRoll * this.prototypeCount),
      );
    const heightScale = candidate.scale * age.height * individualVariation;
    const morphology = deriveForestPlacementMorphology({
      stableId: candidate.stableId,
      speciesId,
      habitat,
    });
    const form = speciesId.startsWith('conifer')
      ? BROADLEAF_FORMS[2]
      : BROADLEAF_FORMS[Math.floor(stableUnit(candidate.stableId, 89) * BROADLEAF_FORMS.length)];
    const crownScale = age.crown
      * (0.92 + stableUnit(candidate.stableId, 59) * 0.16)
      * morphology.crownWidth
      * form.width;
    const trunkScale = age.trunk
      * (0.94 + stableUnit(candidate.stableId, 61) * 0.12)
      * morphology.rootFlare;
    const crownFlattening = morphology.crownFlattening * form.aspect;
    const crownAspect = species.crownAspect * crownFlattening;
    const spacingRadius = species.spacing * age.spacing * crownScale * groveSpacingFactor(candidate.x, candidate.z);
    return Object.freeze({
      speciesId,
      prototypeIndex,
      ageClass,
      scale: heightScale,
      heightScale,
      trunkScale,
      crownScale,
      spacingRadius,
      radius: spacingRadius,
      crownAspect,
      // Authored species meshes already contain their narrow/wide silhouette.
      // Apply ecological variation once instead of narrowing a narrow pine twice.
      crownAspectScale: this.prototypeIndexBySpecies ? crownFlattening : crownAspect,
      leanX: morphology.leanX,
      leanZ: morphology.leanZ,
      branchDroop: morphology.branchDroop,
      foliageDensity: morphology.foliageDensity,
      health01: morphology.health01,
      stiffness: morphology.stiffness,
      instanceMorphology: morphology,
      speciesColor: species.color,
      colorSeed: stableUnit(candidate.stableId, 67),
      windSeed: stableUnit(candidate.stableId, 71),
      // Grove-scoped, so every tree in a stand turns the same autumn colour while
      // `colorSeed` keeps per-tree brightness varied within it.
      groveSeed: stableUnit(habitat.patchId ?? candidate.stableId, 83),
      habitatFlags: Object.freeze({
        edge: habitat.patchEdge > 0.55,
        core: habitat.patchCoverage > 0.75 && habitat.patchEdge < 0.35,
        steep: habitat.slope > 0.7,
        moist: habitat.waterWeight > 0.7,
      }),
    });
  }
}

export const FOREST_AGE_CLASSES = AGE_CLASSES;
export const FOREST_SPECIES_DEFAULTS = DEFAULT_SPECIES;
