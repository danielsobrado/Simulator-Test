import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  FOREST_AUTUMN_TARGETS,
  FOREST_BIOME_TARGETS,
  FOREST_LEAF_TINT_UNTINTED,
  createForestLeafTintTable,
} from '../src/editor/stylized/forest/forestLeafTint.js';
import { FOREST_SPECIES_PALETTES } from '../src/editor/stylized/forest/ForestSpeciesGeometry.js';

function config(autumnGroves) {
  return {
    trees: {
      autumnGroves,
      leafTop: '#5c8338',
    },
  };
}

/** The colour the top of the crown renders: the species' `leafTop` times the tint. */
function tinted(speciesId, tint) {
  const base = new THREE.Color(FOREST_SPECIES_PALETTES[speciesId].leafTop);
  return new THREE.Color(base.r * tint[0], base.g * tint[1], base.b * tint[2]);
}

test('tint times the species lit crown colour lands on the autumn target', () => {
  const table = createForestLeafTintTable({ config: config(1) });
  for (const [speciesId, targets] of Object.entries(FOREST_AUTUMN_TARGETS)) {
    if (targets.length === 0) continue;
    const seen = new Set();
    for (let step = 0; step < targets.length; step += 1) {
      // Sample the middle of each target's slice of the [0, autumnShare) range.
      const groveSeed = (step + 0.5) / targets.length;
      const result = tinted(speciesId, table.tintFor(speciesId, groveSeed));
      const target = new THREE.Color(targets[step]);
      for (const channel of ['r', 'g', 'b']) {
        assert.ok(
          Math.abs(result[channel] - target[channel]) < 0.01,
          `${speciesId} ${channel}: ${result[channel].toFixed(3)} != ${target[channel].toFixed(3)}`,
        );
      }
      seen.add(targets[step]);
    }
    assert.equal(seen.size, targets.length, `${speciesId} cannot reach every autumn target`);
  }
});

test('a grove either turns or stays green, and the share controls how many', () => {
  const table = createForestLeafTintTable({ config: config(0.5) });
  const turned = [];
  for (let grove = 0; grove < 100; grove += 1) {
    const tint = table.tintFor('broadleaf_tall', grove / 100);
    turned.push(tint !== FOREST_LEAF_TINT_UNTINTED);
  }
  assert.equal(turned.filter(Boolean).length, 50);
  // Below the share turns, above it does not — no interleaving.
  assert.ok(turned.slice(0, 50).every(Boolean));
  assert.ok(turned.slice(50).every((value) => value === false));
});

test('conifers and tropical broadleaf never turn', () => {
  const table = createForestLeafTintTable({ config: config(1) });
  for (const speciesId of ['conifer_narrow', 'conifer_wide', 'tropical_tall']) {
    for (let grove = 0; grove < 20; grove += 1) {
      assert.equal(table.tintFor(speciesId, grove / 20), FOREST_LEAF_TINT_UNTINTED);
    }
  }
});

test('autumnGroves 0 leaves every species untinted', () => {
  const table = createForestLeafTintTable({ config: config(0) });
  assert.equal(table.autumnShare, 0);
  for (let grove = 0; grove < 20; grove += 1) {
    assert.equal(table.tintFor('broadleaf_tall', grove / 20), FOREST_LEAF_TINT_UNTINTED);
  }
});

test('an unknown species falls back to untinted rather than throwing', () => {
  const table = createForestLeafTintTable({ config: config(1) });
  assert.equal(table.tintFor('not_a_species', 0.1), FOREST_LEAF_TINT_UNTINTED);
  assert.equal(table.tintFor(null, 0.1), FOREST_LEAF_TINT_UNTINTED);
});

test('tints are shared objects, so a rebuild allocates nothing per instance', () => {
  const table = createForestLeafTintTable({ config: config(1) });
  assert.equal(table.tintFor('broadleaf_tall', 0.1), table.tintFor('broadleaf_tall', 0.1));
});

test('tint times the species lit crown colour lands on the biome target', () => {
  const table = createForestLeafTintTable({ config: config(0) });
  for (const [rawTileId, target] of Object.entries(FOREST_BIOME_TARGETS)) {
    const result = tinted('broadleaf_round', table.tintFor(
      'broadleaf_round',
      0.5,
      Number(rawTileId),
    ));
    const expected = new THREE.Color(target);
    for (const channel of ['r', 'g', 'b']) {
      assert.ok(
        Math.abs(result[channel] - expected[channel]) < 0.01,
        `tile ${rawTileId} ${channel}: ${result[channel].toFixed(3)} != ${expected[channel].toFixed(3)}`,
      );
    }
  }
});

test('the same crown reads differently in a taiga and a rainforest', () => {
  const table = createForestLeafTintTable({ config: config(0) });
  const taiga = table.tintFor('broadleaf_round', 0.5, 9);
  const rainforest = table.tintFor('broadleaf_round', 0.5, 7);
  assert.notDeepEqual(taiga, rainforest);
  // Taiga is the cooler of the two: more blue relative to red.
  assert.ok(taiga[2] / taiga[0] > rainforest[2] / rainforest[0]);
});

test('a turned grove keeps its autumn colour instead of compounding with the biome', () => {
  const table = createForestLeafTintTable({ config: config(1) });
  // Both are absolute target colours expressed as ratios; multiplying them would
  // land on neither, so autumn has to win outright.
  const inDeciduous = table.tintFor('broadleaf_tall', 0.1, 6);
  const inTaiga = table.tintFor('broadleaf_tall', 0.1, 9);
  assert.deepEqual(inDeciduous, inTaiga);
  assert.deepEqual(inDeciduous, table.tintFor('broadleaf_tall', 0.1));
});

test('biomes outside the table and unknown species stay untinted', () => {
  const table = createForestLeafTintTable({ config: config(0) });
  // Deserts, glacier, road and farm keep their species palette untouched.
  for (const tileId of [0, 1, 2, 11, 13, 14]) {
    assert.equal(table.tintFor('broadleaf_round', 0.5, tileId), FOREST_LEAF_TINT_UNTINTED);
  }
  assert.equal(table.tintFor('not_a_species', 0.5, 6), FOREST_LEAF_TINT_UNTINTED);
});
