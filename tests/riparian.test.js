import assert from 'node:assert/strict';
import test from 'node:test';
import { TileDistanceField } from '../src/editor/stylized/forest/TileDistanceField.js';
import { ForestHabitatField } from '../src/editor/stylized/forest/ForestHabitatField.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';
import { createForestBiomeProfiles } from '../src/editor/stylized/forest/ForestBiomeProfiles.js';

const WATER_TILE = 0;
const GRASSLAND_TILE = 4;
const TILE_SIZE = 2;
const CHUNK_SIZE = 32;

/** A lake occupying every cell with x < 20; land runs east of it. */
function lakeTiles(cellX) {
  return cellX < 20 ? WATER_TILE : GRASSLAND_TILE;
}

function createWaterField(rangeMeters = 80) {
  return new TileDistanceField({
    tileAt: (cellX) => lakeTiles(cellX),
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    targetTileId: WATER_TILE,
    maxCells: Math.ceil(rangeMeters / TILE_SIZE),
    label: 'water',
  });
}

function createHabitat({ waterDistanceAt = null } = {}) {
  return new ForestHabitatField({
    seed: 4242,
    tileSize: TILE_SIZE,
    tileAt: (cellX) => lakeTiles(cellX),
    heightAt: () => 4,
    waterDistanceAt,
    config: { patchSupercellSize: 384 },
  });
}

test('water distance grows with distance from the shore and saturates past range', () => {
  const field = createWaterField(40);
  // Cell 20 is the first land cell, adjacent to water.
  assert.ok(field.worldDistanceAt(20 * TILE_SIZE + 1, -10) <= TILE_SIZE * 1.5);
  const near = field.worldDistanceAt(24 * TILE_SIZE + 1, -10);
  const far = field.worldDistanceAt(34 * TILE_SIZE + 1, -10);
  assert.ok(far > near, `expected ${far} > ${near}`);
  // Well beyond the 40 m range the field reports "unknown", not a wrong number.
  assert.equal(field.worldDistanceAt(200 * TILE_SIZE, -10), Number.POSITIVE_INFINITY);
});

test('water distance is identical regardless of query order', () => {
  const forwardField = createWaterField();
  const backwardField = createWaterField();
  const points = [];
  for (let cellX = 20; cellX < 60; cellX += 1) {
    points.push([cellX * TILE_SIZE + 1, -(cellX * TILE_SIZE + 1)]);
  }
  const forward = points.map(([x, z]) => forwardField.worldDistanceAt(x, z));
  const backward = [...points].reverse()
    .map(([x, z]) => backwardField.worldDistanceAt(x, z))
    .reverse();
  assert.deepEqual(forward, backward);
});

test('grassland gains shoreline coverage and is unchanged far inland', () => {
  const waterField = createWaterField();
  const riparian = createHabitat({
    waterDistanceAt: (x, z) => waterField.worldDistanceAt(x, z),
  });
  const dry = createHabitat();

  const shoreX = 21 * TILE_SIZE;
  const inlandX = 200 * TILE_SIZE;
  const z = -40;

  const shoreRiparian = riparian.sample(shoreX, z);
  const shoreDry = dry.sample(shoreX, z);
  assert.ok(
    shoreRiparian.suitability > shoreDry.suitability,
    `shore ${shoreRiparian.suitability} should exceed dry ${shoreDry.suitability}`,
  );
  assert.ok(shoreRiparian.riparian > 0);

  // Beyond the provider's range nothing changes, so inland forests are untouched.
  const inlandRiparian = riparian.sample(inlandX, z);
  const inlandDry = dry.sample(inlandX, z);
  assert.equal(inlandRiparian.riparian, 0);
  assert.equal(inlandRiparian.suitability, inlandDry.suitability);
});

test('riparian coverage decays with distance from the shore', () => {
  const waterField = createWaterField();
  const field = createHabitat({
    waterDistanceAt: (x, z) => waterField.worldDistanceAt(x, z),
  });
  const coverages = [21, 26, 32, 40].map(
    (cellX) => field.sample(cellX * TILE_SIZE, -40).riparian,
  );
  for (let index = 1; index < coverages.length; index += 1) {
    assert.ok(
      coverages[index] <= coverages[index - 1],
      `coverage should not rise with distance: ${coverages}`,
    );
  }
  assert.ok(coverages[0] > coverages[coverages.length - 1]);
});

test('wetland stands are suppressed away from water rather than given a corridor', () => {
  const profiles = createForestBiomeProfiles();
  const wetland = profiles.get(12);
  assert.equal(wetland.key, 'wetland');
  assert.equal(wetland.riparianCoverage, 0);
  assert.ok(Number.isFinite(wetland.waterMaximum));
  // Dry biomes boost instead of suppressing.
  assert.ok(profiles.get(4).riparianCoverage > 0);
  assert.equal(profiles.get(4).waterMaximum, Number.POSITIVE_INFINITY);
});

test('a missing water provider leaves suitability exactly as before', () => {
  const field = createHabitat();
  const sample = field.sample(60 * TILE_SIZE, -40);
  assert.equal(sample.waterWeight, 1);
  assert.equal(sample.riparian, 0);
  assert.equal(sample.waterDistance, Number.POSITIVE_INFINITY);
});

test('the habitat signature distinguishes riparian from dry fields', () => {
  const waterField = createWaterField();
  const riparian = createHabitat({
    waterDistanceAt: (x, z) => waterField.worldDistanceAt(x, z),
  });
  assert.notEqual(riparian.signature, createHabitat().signature);
});

test('water-loving species gain share on wet ground and lose it on dry', () => {
  const registry = new ForestSpeciesRegistry({ prototypeCount: 4 });
  const countSpecies = (riparian) => {
    const counts = new Map();
    for (let index = 0; index < 600; index += 1) {
      const record = registry.select(
        { stableId: `tree:0:0:${index}`, scale: 1 },
        {
          profileKey: 'wetland',
          patchEdge: 0.2,
          patchCoverage: 0.8,
          slope: 0,
          waterWeight: 1,
          riparian,
        },
      );
      counts.set(record.speciesId, (counts.get(record.speciesId) ?? 0) + 1);
    }
    return counts;
  };

  // wetland palette is [wetland_sparse (affinity 0.8), broadleaf_tall (0.15)].
  const dry = countSpecies(0);
  const wet = countSpecies(1);
  assert.ok(
    wet.get('wetland_sparse') > dry.get('wetland_sparse'),
    `wet ${wet.get('wetland_sparse')} should exceed dry ${dry.get('wetland_sparse')}`,
  );
  // Selection stays deterministic for a given habitat.
  assert.deepEqual([...countSpecies(1)], [...wet]);
});

test('species selection is unweighted when no riparian signal is present', () => {
  const registry = new ForestSpeciesRegistry({ prototypeCount: 4 });
  const weights = registry.paletteWeights(
    ['wetland_sparse', 'conifer_narrow'],
    { patchEdge: 0, patchCoverage: 1 },
  );
  assert.deepEqual(weights, [1, 1]);
});
