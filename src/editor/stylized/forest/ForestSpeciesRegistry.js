import { hash32 } from '../scatterMath.js';

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
    spacing: 4.4, crownAspect: 0.82, color: '#547943', waterAffinity: 0.8,
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
  wetland: Object.freeze(['wetland_sparse', 'broadleaf_tall']),
});

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
  if (random < 0.34 + edgeBias * 0.35) return 'young';
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
    });
  }

  /**
   * Prototype indices able to render `speciesId` in `tileId`, in ascending
   * order. A restriction that would leave the species with nothing is ignored
   * rather than applied, so a tree always has something to draw.
   */
  prototypesFor(speciesId, tileId = null) {
    if (!this.prototypeIndexBySpecies) return null;
    const configured = this.prototypeIndexBySpecies.map.get(speciesId);
    const indices = configured?.length > 0 ? configured : this.prototypeIndexBySpecies.fallback;
    if (!this.prototypeTileIds || tileId === null || tileId === undefined) return indices;
    const cacheKey = `${speciesId}:${tileId}`;
    const cached = this.prototypeTileCache.get(cacheKey);
    if (cached) return cached;
    const allowed = indices.filter((index) => {
      const tiles = this.prototypeTileIds.get(index);
      return !tiles || tiles.has(tileId);
    });
    const result = allowed.length > 0 ? allowed : indices;
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
    const speciesPrototypes = this.prototypesFor(speciesId, habitat.tileId);
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
    const crownScale = age.crown * (0.92 + stableUnit(candidate.stableId, 59) * 0.16);
    const trunkScale = age.trunk * (0.94 + stableUnit(candidate.stableId, 61) * 0.12);
    const spacingRadius = species.spacing * age.spacing * crownScale;
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
      crownAspect: species.crownAspect,
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
