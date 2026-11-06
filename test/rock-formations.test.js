import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_ROCK_FORMATIONS, formationStones, iterateRockFormations } from '../src/editor/stylized/rockFormations.js';
import { completeIterator } from '../src/editor/stylized/ResumableIterator.js';

const config = DEFAULT_ROCK_FORMATIONS;
const always = () => 1;

test('a formation is a keystone mass crowded by smaller stones, deterministic per cell', () => {
  const formation = formationStones(3, -7, config, always);
  assert.deepEqual(formationStones(3, -7, config, always), formation, 'same cell, same stones');
  const { stones, cx, cz, radius } = formation;
  assert.ok(stones.length >= config.minStones && stones.length <= config.maxStones);
  assert.ok(stones[0].scale >= config.keystoneMinScale, 'leads with a keystone');
  for (const stone of stones) assert.ok(Math.hypot(stone.x - cx, stone.z - cz) <= radius + 1e-9, 'within its radius');
  assert.equal(formationStones(3, -7, config, () => 0), null, 'no chance, no formation');
});

function chunkPlacements(chunkX, chunkZ, { seaLevel = 0, height = 5, blocked = null } = {}) {
  return completeIterator(iterateRockFormations({
    chunkX, chunkZ, chunkSize: 64, tileSize: 2, seaLevel, blocked, shareAt: always, config,
    heightAt: () => height, prototypeIndexForRoll: () => 0, radiusForScale: (scale) => scale,
  }));
}

test('each stone lands in exactly one chunk, so a formation across a border is whole', () => {
  const ids = [];
  for (let cz = -2; cz <= 1; cz += 1) for (let cx = -2; cx <= 1; cx += 1) ids.push(...chunkPlacements(cx, cz).map((p) => p.stableId));
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, 'no stone placed twice');
});

test('formations stay out of the sea and off cleared paths', () => {
  assert.equal(chunkPlacements(0, 0, { seaLevel: 10, height: 5 }).length, 0, 'under the sea');
  assert.equal(chunkPlacements(0, 0, { blocked: () => true }).length, 0, 'on a path');
});
