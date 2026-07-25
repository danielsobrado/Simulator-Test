import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOREST_GENERATED_SPECIES,
  FOREST_SPECIES_PALETTES,
  createForestSpeciesPrototypeGeometry,
  createSpeciesPrototypeIndex,
  createSpeciesPrototypeGeometry,
} from '../src/editor/stylized/forest/ForestSpeciesGeometry.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';

const habitat = {
  profileKey: 'temperate_deciduous_forest',
  patchEdge: 0.2,
  patchCoverage: 0.85,
  slope: 0.1,
  waterWeight: 1,
};

test('generated species prototypes are ground-pivoted, upright and low poly', () => {
  const prototypes = createForestSpeciesPrototypeGeometry();
  assert.equal(prototypes.length, FOREST_GENERATED_SPECIES.length);
  for (const prototype of prototypes) {
    const trunk = prototype.parts.find((part) => part.kind === 'trunk');
    const leaf = prototype.parts.find((part) => part.kind === 'leaf');
    assert.ok(trunk && leaf, `${prototype.speciesId} needs a trunk and a leaf part`);

    // Pivoted on the trunk base so instances sit on the terrain.
    assert.ok(
      Math.abs(trunk.geometry.boundingBox.min.y) < 0.05,
      `${prototype.speciesId} trunk base should sit at y=0`,
    );
    // Upright: taller than wide, and the crown sits above the trunk base.
    assert.ok(prototype.height > prototype.width * 0.5, `${prototype.speciesId} is not upright`);
    assert.ok(leaf.geometry.boundingBox.min.y > 0, `${prototype.speciesId} crown dips below ground`);

    const triangles = prototype.parts.reduce(
      (total, part) => total + part.geometry.attributes.position.count / 3,
      0,
    );
    assert.ok(triangles < 600, `${prototype.speciesId} has ${triangles} triangles`);

    // De-indexed with matching attributes so merges and impostor bakes succeed.
    for (const part of prototype.parts) {
      assert.equal(part.geometry.index, null);
      assert.deepEqual(Object.keys(part.geometry.attributes).sort(), ['normal', 'position', 'uv']);
    }
  }
});

test('generated geometry is deterministic across builds', () => {
  for (const speciesId of FOREST_GENERATED_SPECIES) {
    const left = createSpeciesPrototypeGeometry(speciesId);
    const right = createSpeciesPrototypeGeometry(speciesId);
    for (let index = 0; index < left.parts.length; index += 1) {
      assert.deepEqual(
        Array.from(left.parts[index].geometry.attributes.position.array),
        Array.from(right.parts[index].geometry.attributes.position.array),
        `${speciesId} part ${index} is not deterministic`,
      );
    }
  }
});

test('every generated species has a distinct colour palette', () => {
  const leafTops = new Set();
  for (const speciesId of FOREST_GENERATED_SPECIES) {
    const palette = FOREST_SPECIES_PALETTES[speciesId];
    assert.ok(palette, `${speciesId} needs a palette`);
    leafTops.add(palette.leafTop);
  }
  assert.equal(leafTops.size, FOREST_GENERATED_SPECIES.length);
  // The reference image's white-trunked birch.
  assert.equal(FOREST_SPECIES_PALETTES.broadleaf_tall.barkTint, '#e8e6dd');
});

test('species selection resolves only prototypes that can render that species', () => {
  const prototypeIndexBySpecies = createSpeciesPrototypeIndex({
    glbPrototypeCount: 7,
    generatedSpeciesIds: [...FOREST_GENERATED_SPECIES],
  });
  const registry = new ForestSpeciesRegistry({
    prototypeCount: 7 + FOREST_GENERATED_SPECIES.length,
    prototypeIndexBySpecies,
  });

  for (let index = 0; index < 400; index += 1) {
    const record = registry.select(
      { stableId: `tree:0:0:${index}`, scale: 1 },
      habitat,
    );
    const allowed = prototypeIndexBySpecies.map.get(record.speciesId);
    assert.ok(
      allowed.includes(record.prototypeIndex),
      `${record.speciesId} selected prototype ${record.prototypeIndex}, allowed ${allowed}`,
    );
  }

  // Conifers draw from the baked GLB range; broadleaf species from their own.
  assert.deepEqual(registry.prototypesFor('conifer_narrow'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(registry.prototypesFor('broadleaf_round'), [7]);
  // An unmapped species still renders rather than throwing.
  assert.deepEqual(registry.prototypesFor('unknown_species'), [0, 1, 2, 3, 4, 5, 6]);
});

test('taiga selects conifers and deciduous forest reaches broadleaf and birch', () => {
  const registry = new ForestSpeciesRegistry({
    prototypeCount: 11,
    prototypeIndexBySpecies: createSpeciesPrototypeIndex({
      glbPrototypeCount: 7,
      generatedSpeciesIds: [...FOREST_GENERATED_SPECIES],
    }),
  });
  const speciesFor = (profileKey) => new Set(
    Array.from({ length: 300 }, (_, index) => registry.select(
      { stableId: `tree:1:2:${index}`, scale: 1 },
      { ...habitat, profileKey },
    ).speciesId),
  );
  assert.deepEqual(
    [...speciesFor('taiga')].sort(),
    ['conifer_narrow', 'conifer_wide'],
  );
  assert.deepEqual(
    [...speciesFor('temperate_deciduous_forest')].sort(),
    ['broadleaf_round', 'broadleaf_tall'],
  );
});

test('species mapping is absent by default so existing callers keep whole-range selection', () => {
  const registry = new ForestSpeciesRegistry({ prototypeCount: 3 });
  assert.equal(registry.prototypesFor('broadleaf_round'), null);
  const indices = new Set(
    Array.from({ length: 200 }, (_, index) => registry.select(
      { stableId: `tree:0:0:${index}`, scale: 1 },
      habitat,
    ).prototypeIndex),
  );
  assert.ok([...indices].every((index) => index >= 0 && index < 3));
});
