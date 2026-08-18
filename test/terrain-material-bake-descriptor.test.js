import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTerrainMaterialBakeDescriptor,
  sameTerrainMaterialBakeSource,
  terrainMaterialBakeNeedsRefresh,
} from '../src/editor/materials/TerrainMaterialBakeDescriptor.js';

const REVISIONS = Object.freeze({
  world: 7,
  tile: 11,
  height: 13,
  water: 17,
  canopy: 19,
});

function descriptor(overrides = {}) {
  return createTerrainMaterialBakeDescriptor({
    chunkX: -4,
    chunkZ: 9,
    quality: 'balanced',
    revisions: REVISIONS,
    ...overrides,
  });
}

test('terrain material bake descriptor produces deterministic revision-aware keys', () => {
  const left = descriptor();
  const right = descriptor();

  assert.equal(left.key, 'terrain-material:v1:balanced:-4:9:7.11.13.17.19');
  assert.equal(left.slotKey, 'terrain-material-slot:v1:balanced:-4:9');
  assert.equal(left.key, right.key);
  assert.equal(left.slotKey, right.slotKey);
  assert.equal(sameTerrainMaterialBakeSource(left, right), true);
  assert.equal(terrainMaterialBakeNeedsRefresh(left, right), false);
  assert.equal(Object.isFrozen(left), true);
  assert.equal(Object.isFrozen(left.revisions), true);
});

test('source revisions change the bake key but retain the physical cache slot', () => {
  const current = descriptor();
  const requested = descriptor({
    revisions: { ...REVISIONS, water: REVISIONS.water + 1 },
  });

  assert.notEqual(current.key, requested.key);
  assert.equal(current.slotKey, requested.slotKey);
});

test('terrain material bake descriptor invalidates on every source revision', () => {
  for (const field of Object.keys(REVISIONS)) {
    const requested = descriptor({
      revisions: { ...REVISIONS, [field]: REVISIONS[field] + 1 },
    });
    assert.equal(terrainMaterialBakeNeedsRefresh(descriptor(), requested), true, field);
  }
});

test('terrain material bake descriptor separates chunks and quality tiers', () => {
  assert.equal(sameTerrainMaterialBakeSource(descriptor(), descriptor({ chunkX: -3 })), false);
  assert.equal(sameTerrainMaterialBakeSource(descriptor(), descriptor({ chunkZ: 10 })), false);
  assert.equal(sameTerrainMaterialBakeSource(descriptor(), descriptor({ quality: 'high' })), false);
  assert.notEqual(descriptor().slotKey, descriptor({ quality: 'high' }).slotKey);
});

test('terrain material bake descriptor rejects incomplete or unsafe revisions', () => {
  assert.throws(
    () => descriptor({ revisions: { ...REVISIONS, water: -1 } }),
    /revisions\.water must be a non-negative safe integer/,
  );
  const { canopy, ...missingCanopy } = REVISIONS;
  assert.equal(canopy, 19);
  assert.throws(
    () => descriptor({ revisions: missingCanopy }),
    /revisions\.canopy must be a non-negative safe integer/,
  );
});
