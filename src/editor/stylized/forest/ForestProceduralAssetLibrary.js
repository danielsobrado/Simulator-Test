import { hash32 } from '../scatterMath.js';
import { FOREST_SPECIES_DEFAULTS } from './ForestSpeciesRegistry.js';

const ARCHETYPE_RULES = Object.freeze({
  broadleaf_round: Object.freeze({ axiom: 'TTB', rule: 'T[+B][-B]T', levels: 4, branchAngle: 0.72 }),
  broadleaf_tall: Object.freeze({ axiom: 'TTTB', rule: 'T[+B]T[-B]', levels: 5, branchAngle: 0.54 }),
  conifer_narrow: Object.freeze({ axiom: 'TT', rule: 'T[+b][-b]T', levels: 6, branchAngle: 0.42 }),
  conifer_wide: Object.freeze({ axiom: 'TTB', rule: 'T[+B][-B]T', levels: 5, branchAngle: 0.48 }),
  tropical_tall: Object.freeze({ axiom: 'TTTTB', rule: 'T[+B][-B]T', levels: 5, branchAngle: 0.62 }),
  wetland_sparse: Object.freeze({ axiom: 'TTB', rule: 'T[+B]T[-B]', levels: 4, branchAngle: 0.66 }),
});

function signature(value) {
  const json = JSON.stringify(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    result = Math.imul(result ^ json.charCodeAt(index), 0x01000193);
  }
  return hash32(result).toString(16).padStart(8, '0');
}

export function createForestProceduralAssetLibrary({
  seedsPerSpecies = 3,
  ages = ['sapling', 'young', 'mature', 'ancient', 'dead'],
} = {}) {
  const assets = [];
  for (const [speciesId, species] of Object.entries(FOREST_SPECIES_DEFAULTS)) {
    const rules = ARCHETYPE_RULES[speciesId];
    for (let seed = 0; seed < seedsPerSpecies; seed += 1) {
      for (const ageClass of ages) {
        const source = Object.freeze({
          speciesId,
          seed,
          ageClass,
          rules,
          crownAspect: species.crownAspect,
          spacing: species.spacing,
          rootCollar: ageClass !== 'sapling',
          outputs: Object.freeze({
            lod0: `${speciesId}/${ageClass}-${seed}-lod0.glb`,
            lod1: `${speciesId}/${ageClass}-${seed}-lod1.glb`,
            impostor: `${speciesId}/${ageClass}-${seed}-impostor`,
            metadata: `${speciesId}/${ageClass}-${seed}.json`,
          }),
        });
        assets.push(Object.freeze({ ...source, signature: signature(source) }));
      }
    }
  }
  const library = Object.freeze({
    version: 1,
    generator: 'deterministic-lsystem-offline-v1',
    assets: Object.freeze(assets),
  });
  return Object.freeze({ ...library, signature: signature(library) });
}

export const FOREST_ARCHETYPE_RULES = ARCHETYPE_RULES;
