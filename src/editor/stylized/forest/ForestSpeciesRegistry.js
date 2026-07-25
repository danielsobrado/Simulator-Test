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

function stableUnit(stableId, channel) {
  let value = Math.imul(channel + 1, 0x9e3779b1);
  for (let index = 0; index < stableId.length; index += 1) {
    value = Math.imul(value ^ stableId.charCodeAt(index), 0x85ebca6b);
  }
  return hash32(value) / 0xffffffff;
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
    this.signature = JSON.stringify({
      species: [...this.species.values()],
      palettes: this.palettes,
      prototypeCount: this.prototypeCount,
      prototypeIndices: this.prototypeIndexBySpecies
        ? [...this.prototypeIndexBySpecies.map.entries()]
        : null,
    });
  }

  /** Prototype indices able to render `speciesId`, in ascending order. */
  prototypesFor(speciesId) {
    if (!this.prototypeIndexBySpecies) return null;
    const indices = this.prototypeIndexBySpecies.map.get(speciesId);
    return indices?.length > 0 ? indices : this.prototypeIndexBySpecies.fallback;
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

  select(candidate, habitat) {
    const configured = this.palettes[habitat.profileKey] ?? ['broadleaf_round'];
    const palette = configured.filter((id) => this.species.has(id));
    const usable = palette.length > 0 ? palette : ['broadleaf_round'];
    const weights = this.paletteWeights(usable, habitat);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = stableUnit(candidate.stableId, 41) * total;
    let speciesIndex = usable.length - 1;
    for (let index = 0; index < usable.length; index += 1) {
      roll -= weights[index];
      if (roll < 0) {
        speciesIndex = index;
        break;
      }
    }
    const speciesId = usable[speciesIndex];
    const species = this.species.get(speciesId);
    const ageClass = weightedAge(
      habitat.patchEdge,
      habitat.patchCoverage,
      stableUnit(candidate.stableId, 43),
    );
    const age = AGE_CLASSES[ageClass];
    const individualVariation = 0.9 + stableUnit(candidate.stableId, 47) * 0.2;
    const speciesPrototypes = this.prototypesFor(speciesId);
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
