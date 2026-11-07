import assert from 'node:assert/strict';
import test from 'node:test';

import { alpineHeight, alpineLakeLift, createAlpineMask } from '../src/editor/world/AlpineRelief.js';

const SIZE = 64;
const TUNDRA = 10;
const GRASSLAND = 4;

function mask({ biome = TUNDRA, lakeAt = null } = {}) {
  const biomes = new Uint8Array(SIZE * SIZE);
  const heights = new Uint8Array(SIZE * SIZE).fill(40);
  const features = new Uint16Array(SIZE * SIZE).fill(1);
  // Left half grassland, right half the tested biome.
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) biomes[y * SIZE + x] = x < SIZE / 2 ? GRASSLAND : biome;
  if (lakeAt) features[lakeAt] = 7;
  return createAlpineMask({
    biomes, heights, features, lakeIds: new Set([7]), width: SIZE, height: SIZE, metersPerTexel: 250, landHeight: 20,
  });
}

test('worlds without tundra or glacier get no alpine mask', () => {
  assert.equal(mask({ biome: GRASSLAND }), null);
});

test('the range ramps from the border to full height inside cold country', () => {
  const values = mask().weight;
  const row = 32 * SIZE;
  assert.equal(values[row + 2], 0);
  assert.ok(values[row + SIZE / 2] > 0 && values[row + SIZE / 2] < 1, 'border is part-way up');
  assert.ok(values[row + SIZE - 3] > 0.99, 'interior is at full height');
});

test('a lake calms the crests around it and rises with the plain uplift', () => {
  const lake = 32 * SIZE + 56;
  const { weight, calm } = mask({ lakeAt: lake });
  assert.equal(calm[lake], 1);
  assert.equal(calm[32 * SIZE + 40], 0);
  assert.equal(alpineHeight(5, 7, 1234, weight[lake], 1), alpineLakeLift(weight[lake]));
});

test('alpine relief lifts the ground into tall crests', () => {
  let sum = 0;
  let peak = -Infinity;
  for (let i = 0; i < 400; i += 1) {
    const h = alpineHeight(i * 37.1, i * 53.7, 1234, 1);
    sum += h;
    peak = Math.max(peak, h);
  }
  assert.ok(sum / 400 > 150, `mean lift ${sum / 400}`);
  assert.ok(peak > 400, `peak ${peak}`);
  assert.equal(alpineHeight(10, 10, 1234, 0), 0);
});
