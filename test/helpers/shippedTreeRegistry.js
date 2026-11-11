import { ForestSpeciesRegistry } from '../../src/editor/stylized/forest/ForestSpeciesRegistry.js';
import { createSpeciesPrototypeIndex } from '../../src/editor/stylized/forest/ForestSpeciesGeometry.js';

/**
 * The species registry as StylizedTreeView builds it from the shipped
 * `treeVariants`, without loading a GLB: a variant contributes one prototype
 * per `prototypeGroups` entry (one when it has none), after `primaryCount`
 * primary-scene prototypes.
 */
export function createShippedTreeRegistry(surface, { primaryCount = 2 } = {}) {
  const additional = new Map();
  const allowed = new Map();
  const preferred = new Map();
  const ages = new Map();
  const scenes = [];
  let next = primaryCount;
  for (const variant of surface.assets.treeVariants) {
    for (let k = 0; k < (variant.prototypeGroups?.length ?? 1); k += 1) {
      const index = next;
      next += 1;
      scenes[index] = variant.scene;
      for (const species of [].concat(variant.species)) {
        additional.set(species, [...(additional.get(species) ?? []), index]);
      }
      if (variant.tileIds) allowed.set(index, new Set(variant.tileIds));
      if (variant.preferredTileIds) preferred.set(index, new Set(variant.preferredTileIds));
      if (variant.ageClasses) ages.set(index, new Set(variant.ageClasses));
    }
  }
  const registry = new ForestSpeciesRegistry({
    prototypeCount: next,
    prototypeIndexBySpecies: createSpeciesPrototypeIndex({
      glbPrototypeCount: primaryCount,
      generatedSpeciesIds: [],
      additionalPrototypeIndicesBySpecies: additional,
    }),
    prototypeTileIds: allowed,
    prototypePreferredTileIds: preferred,
    prototypeAgeClasses: ages,
  });
  return { registry, sceneOf: (index) => scenes[index] ?? null, prototypeCount: next };
}
