import assert from 'node:assert/strict';
import test from 'node:test';
import { PathClearanceField } from '../src/editor/stylized/forest/PathClearanceField.js';

const ROAD_TILE = 13;
const GRASS_TILE = 6;
const TILE_SIZE = 2;
const CHUNK_SIZE = 32;

/** A north-south road along cell column x=40, i.e. world x in [80, 82). */
function roadColumnTiles(cellX) {
  return cellX === 40 ? ROAD_TILE : GRASS_TILE;
}

function createField(clearCells, tileAt = (cellX) => roadColumnTiles(cellX)) {
  return new PathClearanceField({
    tileAt,
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    roadTileId: ROAD_TILE,
    clearCells,
  });
}

function createNaturalTrailField(overrides = {}) {
  return new PathClearanceField({
    tileAt: () => GRASS_TILE,
    tileSize: TILE_SIZE,
    chunkSize: CHUNK_SIZE,
    roadTileId: ROAD_TILE,
    clearCells: 0,
    naturalTrail: {
      enabled: true,
      scale: 0.018,
      level: 0.08,
      width: 0.038,
      softness: 0.035,
      warp: 0.9,
      clearThreshold: 0.42,
      ...overrides,
    },
  });
}

test('candidates on and beside a road are cleared, distant ones are kept', () => {
  const field = createField(3);
  const worldZ = -50;
  // Cell 40 is the road itself.
  assert.equal(field.blocks(40 * TILE_SIZE + 1, worldZ), true);
  // Cells 38 and 42 are two cells away — inside the 3-cell clearance.
  assert.equal(field.blocks(38 * TILE_SIZE + 1, worldZ), true);
  assert.equal(field.blocks(42 * TILE_SIZE + 1, worldZ), true);
  // Cell 44 is four cells away — outside it.
  assert.equal(field.blocks(44 * TILE_SIZE + 1, worldZ), false);
  assert.equal(field.blocks(20 * TILE_SIZE + 1, worldZ), false);
});

test('clearance is identical regardless of which chunk is queried first', () => {
  const near = createField(3);
  const far = createField(3);
  const samples = [];
  for (let cellX = 30; cellX <= 50; cellX += 1) {
    for (let cellZ = 0; cellZ < 96; cellZ += 7) {
      samples.push([cellX * TILE_SIZE + 1, -(cellZ * TILE_SIZE + 1)]);
    }
  }
  const forward = samples.map(([x, z]) => near.blocks(x, z));
  const backward = [...samples].reverse().map(([x, z]) => far.blocks(x, z)).reverse();
  assert.deepEqual(forward, backward);
});

test('clearance holds across a chunk boundary', () => {
  // Chunk boundary sits at cell 32; put the road just past it at cell 33.
  const field = createField(3, (cellX) => (cellX === 33 ? ROAD_TILE : GRASS_TILE));
  // Cell 31 lives in the previous chunk but is two cells from the road.
  assert.equal(field.blocks(31 * TILE_SIZE + 1, -10), true);
  assert.equal(field.blocks(29 * TILE_SIZE + 1, -10), false);
});

test('zero clearance disables the field entirely', () => {
  const field = createField(0);
  assert.equal(field.enabled, false);
  assert.equal(field.exclusion(), null);
  assert.equal(field.blocks(40 * TILE_SIZE + 1, -10), false);
});

test('per-chunk distance fields are cached rather than rebuilt per candidate', () => {
  const field = createField(3);
  for (let index = 0; index < 200; index += 1) {
    field.blocks(40 * TILE_SIZE + index % 10, -index);
  }
  assert.ok(field.stats.cacheHits > 0);
  // 200 lookups spread over a handful of chunks must not mean 200 builds.
  assert.ok(field.stats.builds < 10, `built ${field.stats.builds} chunk fields`);
});

test('a world with no roads never blocks', () => {
  const field = createField(3, () => GRASS_TILE);
  assert.equal(field.blocks(0, 0), false);
  assert.equal(field.distanceAt(0, 0) > 3, true);
});

test('natural trails clear props even in a world with no authored roads', () => {
  const field = createNaturalTrailField();
  let blocked = null;
  let open = null;
  for (let z = -320; z <= 320 && (!blocked || !open); z += 4) {
    for (let x = -320; x <= 320 && (!blocked || !open); x += 4) {
      if (field.blocks(x, z)) blocked ??= [x, z];
      else open ??= [x, z];
    }
  }
  assert.ok(blocked, 'expected at least one point on a natural trail');
  assert.ok(open, 'expected dense ground away from natural trails');
  assert.equal(field.exclusion()({ x: blocked[0], z: blocked[1] }), true);
  assert.equal(field.exclusion()({ x: open[0], z: open[1] }), false);
});

test('natural trail clearance is stable across world chunk boundaries', () => {
  const field = createNaturalTrailField();
  const first = [];
  const second = [];
  for (let z = -128; z <= 128; z += 2) {
    first.push(field.blocks(63.999, z));
    second.push(field.blocks(64.001, z));
  }
  const disagreements = first.filter((value, index) => value !== second[index]).length;
  assert.ok(disagreements <= 1, `unexpected seam produced ${disagreements} disagreements`);
});
