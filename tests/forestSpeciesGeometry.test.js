import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FOREST_GENERATED_SPECIES,
  FOREST_SPECIES_PALETTES,
  createForestSpeciesPrototypeGeometry,
  createSpeciesPrototypeIndex,
  createSpeciesPrototypeGeometry,
  uncoveredGeneratedSpecies,
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

    // Tiered crowns cost roughly twice the lobes of the old single ring, paid for
    // by open-ended limbs. 440 is the worst case today (beech and tropical).
    const triangles = prototype.parts.reduce(
      (total, part) => total + part.geometry.attributes.position.count / 3,
      0,
    );
    assert.ok(triangles <= 480, `${prototype.speciesId} has ${triangles} triangles`);

    // De-indexed with matching attributes so merges and impostor bakes succeed.
    for (const part of prototype.parts) {
      assert.equal(part.geometry.index, null);
      assert.deepEqual(Object.keys(part.geometry.attributes).sort(), ['normal', 'position', 'uv']);
    }
  }
});

/**
 * Longest run of consecutive horizontal slices of the crown that hold no leaf
 * vertex. A contiguous run is the thing to measure rather than a count of empty
 * bands: scattered holes are just lobe jitter, whereas a run is a real gap.
 */
function widestCrownGap(leafGeometry, bands = 24) {
  const positions = leafGeometry.attributes.position.array;
  const low = leafGeometry.boundingBox.min.y;
  const span = Math.max(1e-6, leafGeometry.boundingBox.max.y - low);
  const occupied = new Array(bands).fill(false);
  for (let index = 1; index < positions.length; index += 3) {
    occupied[Math.min(bands - 1, Math.floor(((positions[index] - low) / span) * bands))] = true;
  }
  let widest = 0;
  let run = 0;
  // Ends are occupied by definition of the bounding box, so interior only.
  for (const band of occupied.slice(1, -1)) {
    run = band ? 0 : run + 1;
    widest = Math.max(widest, run);
  }
  return widest;
}

test('tiered species separate their crowns into distinct mass layers', () => {
  // The silhouette the reference art gets from stacked tiers depends on sky
  // between them; a single ring of lobes fills every band and reads as a blob.
  for (const speciesId of ['broadleaf_round', 'broadleaf_tall', 'tropical_tall']) {
    const prototype = createSpeciesPrototypeGeometry(speciesId);
    const leaf = prototype.parts.find((part) => part.kind === 'leaf');
    assert.ok(
      widestCrownGap(leaf.geometry) >= 2,
      `${speciesId} crown has no gap between tiers`,
    );
  }
  // wetland_sparse is deliberately single-tier, so it is exempt.
  assert.equal(FOREST_GENERATED_SPECIES.includes('wetland_sparse'), true);
});

/** Pearson correlation between normalised height and normal.y over every vertex. */
function heightNormalCorrelation(geometry) {
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const low = geometry.boundingBox.min.y;
  const span = Math.max(1e-6, geometry.boundingBox.max.y - low);
  const count = positions.count;
  let sumH = 0; let sumN = 0; let sumHH = 0; let sumNN = 0; let sumHN = 0;
  for (let index = 0; index < count; index += 1) {
    const height = (positions.getY(index) - low) / span;
    const normalY = normals.getY(index);
    sumH += height; sumN += normalY;
    sumHH += height * height; sumNN += normalY * normalY; sumHN += height * normalY;
  }
  return (count * sumHN - sumH * sumN)
    / Math.sqrt((count * sumHH - sumH * sumH) * (count * sumNN - sumN * sumN));
}

test('crown normals are spherified so the canopy lights as one soft mass', () => {
  for (const speciesId of FOREST_GENERATED_SPECIES) {
    const prototype = createSpeciesPrototypeGeometry(speciesId);
    const leaf = prototype.parts.find((part) => part.kind === 'leaf');
    const trunk = prototype.parts.find((part) => part.kind === 'trunk');

    // Outward-from-centre normals make normal.y track height almost exactly.
    // Flat per-triangle normals, which is what `facet` leaves behind, correlate
    // near zero and are what made crowns read as faceted rock.
    assert.ok(
      heightNormalCorrelation(leaf.geometry) > 0.85,
      `${speciesId} crown normals are not spherified`,
    );
    // Trunks keep their facet normals: bark is not a soft mass.
    assert.ok(
      heightNormalCorrelation(trunk.geometry) < 0.5,
      `${speciesId} trunk normals should stay faceted`,
    );

    // Blending must leave every normal unit length or lighting goes wrong.
    const normals = leaf.geometry.attributes.normal;
    for (let index = 0; index < normals.count; index += 1) {
      const length = Math.hypot(
        normals.getX(index),
        normals.getY(index),
        normals.getZ(index),
      );
      assert.ok(Math.abs(length - 1) < 1e-4, `${speciesId} normal ${index} is not unit length`);
    }
  }
});

test('leaf cards are an alpha-cut part that breaks the silhouette without inflating it', () => {
  for (const speciesId of FOREST_GENERATED_SPECIES) {
    const plain = createSpeciesPrototypeGeometry(speciesId);
    const carded = createSpeciesPrototypeGeometry(speciesId, { cardsPerLobe: 4 });

    assert.equal(plain.parts.length, 2, `${speciesId} should have no card part by default`);
    const card = carded.parts.find((part) => part.card);
    assert.ok(card, `${speciesId} is missing its card part`);
    // Tagged 'leaf' so it inherits the grove tint and the no-shadow rule, but kept
    // separate so the alpha cut never reaches the solid lobes.
    assert.equal(card.kind, 'leaf');
    assert.equal(carded.parts.filter((part) => part.kind === 'leaf').length, 2);

    // Same attribute set as everything else, or merges and impostor bakes break.
    assert.equal(card.geometry.index, null);
    assert.deepEqual(Object.keys(card.geometry.attributes).sort(), ['normal', 'position', 'uv']);

    // Cards must reach past the lobes somewhere to break the outline. Which face
    // they exceed depends on where they landed, so any one of the six counts —
    // asserting a particular axis would just be testing the random placement.
    const lobes = carded.parts.find((part) => part.kind === 'leaf' && !part.card);
    const cardBox = card.geometry.boundingBox;
    const lobeBox = lobes.geometry.boundingBox;
    const protrudes = ['x', 'y', 'z'].some((axis) => (
      cardBox.max[axis] > lobeBox.max[axis] || cardBox.min[axis] < lobeBox.min[axis]
    ));
    assert.ok(protrudes, `${speciesId} cards sit entirely inside the crown`);
    // ...but not so far that they redefine the crown's size, which drives LOD
    // pixel thresholds and the impostor radius.
    assert.ok(
      carded.height < plain.height * 1.1 && carded.width < plain.width * 1.1,
      `${speciesId} cards inflated bounds to ${carded.width.toFixed(1)}x${carded.height.toFixed(1)}`,
    );
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

test('an authored variant replaces the generated archetype for its species', () => {
  const covered = new Map([['broadleaf_round', [11]]]);
  // The loader only generates what nothing authored claims, so `broadleaf_round`
  // drops out of the generated set entirely rather than sharing a pool with it.
  const generatedSpeciesIds = uncoveredGeneratedSpecies(covered.keys());
  assert.ok(!generatedSpeciesIds.includes('broadleaf_round'));

  const prototypeIndexBySpecies = createSpeciesPrototypeIndex({
    glbPrototypeCount: 7,
    generatedSpeciesIds,
    generatedFirstIndex: 12,
    additionalPrototypeIndicesBySpecies: covered,
  });

  // No 7 in this list: a blob no longer stands in for a third of the crowns.
  assert.deepEqual(prototypeIndexBySpecies.map.get('broadleaf_round'), [11]);
  assert.deepEqual(
    prototypeIndexBySpecies.map.get('broadleaf_tall'),
    [12 + generatedSpeciesIds.indexOf('broadleaf_tall')],
  );
  // Conifers keep the source-GLB range, which authored conifers extend.
  assert.deepEqual(prototypeIndexBySpecies.map.get('conifer_narrow'), [0, 1, 2, 3, 4, 5, 6]);
});

test('full authored coverage generates no archetypes at all', () => {
  const covered = new Map(FOREST_GENERATED_SPECIES.map(
    (speciesId, offset) => [speciesId, [7 + offset]],
  ));
  const generatedSpeciesIds = uncoveredGeneratedSpecies(covered.keys());
  assert.deepEqual(generatedSpeciesIds, []);

  const prototypeIndexBySpecies = createSpeciesPrototypeIndex({
    glbPrototypeCount: 7,
    generatedSpeciesIds,
    generatedFirstIndex: 7 + FOREST_GENERATED_SPECIES.length,
    additionalPrototypeIndicesBySpecies: covered,
  });
  for (const speciesId of FOREST_GENERATED_SPECIES) {
    assert.deepEqual(prototypeIndexBySpecies.map.get(speciesId), covered.get(speciesId));
  }
});

test('a tile-restricted prototype only appears in the biomes it claims', () => {
  // The 62 883-triangle oak lives in savanna and grassland; closed forest gets
  // the cheap crown instead. Both are `broadleaf_round`.
  const registry = new ForestSpeciesRegistry({
    prototypeCount: 9,
    prototypeIndexBySpecies: createSpeciesPrototypeIndex({
      glbPrototypeCount: 7,
      generatedSpeciesIds: [],
      additionalPrototypeIndicesBySpecies: new Map([['broadleaf_round', [7, 8]]]),
    }),
    prototypeTileIds: new Map([[8, new Set([3, 4])]]),
  });

  assert.deepEqual(registry.prototypesFor('broadleaf_round', 4), [7, 8]);
  assert.deepEqual(registry.prototypesFor('broadleaf_round', 6), [7]);
  // No tile means no restriction, which keeps callers without a habitat working.
  assert.deepEqual(registry.prototypesFor('broadleaf_round'), [7, 8]);

  for (let index = 0; index < 200; index += 1) {
    const record = registry.select(
      { stableId: `tree:0:0:${index}`, scale: 1 },
      { ...habitat, tileId: 6 },
    );
    if (record.speciesId !== 'broadleaf_round') continue;
    assert.notEqual(record.prototypeIndex, 8, 'the restricted oak reached a forest biome');
  }
});

test('a restriction that would leave a species with nothing is ignored', () => {
  const registry = new ForestSpeciesRegistry({
    prototypeCount: 8,
    prototypeIndexBySpecies: createSpeciesPrototypeIndex({
      glbPrototypeCount: 7,
      generatedSpeciesIds: [],
      additionalPrototypeIndicesBySpecies: new Map([['broadleaf_round', [7]]]),
    }),
    prototypeTileIds: new Map([[7, new Set([3])]]),
  });
  assert.deepEqual(registry.prototypesFor('broadleaf_round', 6), [7]);
});

test('one authored crown can serve several species', () => {
  const covered = new Map([
    ['broadleaf_round', [11]],
    ['tropical_tall', [11]],
  ]);
  const prototypeIndexBySpecies = createSpeciesPrototypeIndex({
    glbPrototypeCount: 7,
    generatedSpeciesIds: uncoveredGeneratedSpecies(covered.keys()),
    generatedFirstIndex: 12,
    additionalPrototypeIndicesBySpecies: covered,
  });
  assert.deepEqual(prototypeIndexBySpecies.map.get('broadleaf_round'), [11]);
  assert.deepEqual(prototypeIndexBySpecies.map.get('tropical_tall'), [11]);
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

function createGroveRegistry(overrides = {}) {
  return new ForestSpeciesRegistry({
    prototypeCount: 7 + FOREST_GENERATED_SPECIES.length,
    prototypeIndexBySpecies: createSpeciesPrototypeIndex({
      glbPrototypeCount: 7,
      generatedSpeciesIds: [...FOREST_GENERATED_SPECIES],
    }),
    ...overrides,
  });
}

function groveSelection(registry, patchId, profileKey = 'temperate_deciduous_forest', count = 400) {
  return Array.from({ length: count }, (_, index) => registry.select(
    { stableId: `tree:${patchId}:${index}`, scale: 1 },
    { ...habitat, profileKey, patchId },
  ));
}

function speciesCounts(records) {
  const counts = new Map();
  for (const record of records) {
    counts.set(record.speciesId, (counts.get(record.speciesId) ?? 0) + 1);
  }
  return counts;
}

test('a grove is dominated by one species rather than the whole biome mix', () => {
  const registry = createGroveRegistry();
  const records = groveSelection(registry, 'temperate:0:0:aaaa');
  const counts = speciesCounts(records);
  const dominant = Math.max(...counts.values());
  // Default groveMix is 0.16, so the stand should be overwhelmingly one species...
  assert.ok(
    dominant / records.length > 0.78,
    `dominant species holds only ${dominant}/${records.length}`,
  );
  // ...but not a monoculture: the admixture share still places other species.
  assert.ok(counts.size > 1, 'grove admixture placed no other species');
});

test('groves differ from each other so the biome mix reappears across patches', () => {
  const registry = createGroveRegistry();
  const dominants = new Set();
  for (let grove = 0; grove < 24; grove += 1) {
    const counts = speciesCounts(groveSelection(registry, `temperate:${grove}`, undefined, 60));
    const [dominant] = [...counts.entries()].sort((left, right) => right[1] - left[1])[0];
    dominants.add(dominant);
  }
  assert.deepEqual([...dominants].sort(), ['broadleaf_round', 'broadleaf_tall']);
});

test('groveMix 0 gives strict single-species stands', () => {
  const registry = createGroveRegistry({ groveMix: 0 });
  const counts = speciesCounts(groveSelection(registry, 'temperate:0:0:aaaa'));
  assert.equal(counts.size, 1);
});

test('every tree in a grove shares its grove seed, so a stand turns as one', () => {
  const registry = createGroveRegistry();
  const seeds = new Set(groveSelection(registry, 'temperate:0:0:aaaa', undefined, 50)
    .map((record) => record.groveSeed));
  assert.equal(seeds.size, 1);
  const other = new Set(groveSelection(registry, 'temperate:9:9:bbbb', undefined, 50)
    .map((record) => record.groveSeed));
  assert.notDeepEqual([...seeds], [...other]);
});

test('habitats with no patch field still select and seed per tree', () => {
  const registry = createGroveRegistry();
  // `habitat` carries no patchId, which is what bare-habitat callers pass.
  const records = Array.from({ length: 200 }, (_, index) => registry.select(
    { stableId: `tree:0:0:${index}`, scale: 1 },
    habitat,
  ));
  assert.ok(speciesCounts(records).size > 1);
  assert.ok(new Set(records.map((record) => record.groveSeed)).size > 1);
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
