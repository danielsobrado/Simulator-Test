import assert from 'node:assert/strict';
import test from 'node:test';
import { getProceduralCastleWallStats } from '../src/editor/workshop/ProceduralCastleWallGenerator.js';

function recipe(overrides = {}) {
  return {
    archetype: 'wall',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'stepped',
    towerSide: 'none',
    width: 16,
    depth: 2,
    height: 14,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 3,
    weathering: 0.35,
    windows: true,
    ivy: true,
    remesh: true,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

test('maximum supported castle walls stay inside the complete stone budget', () => {
  for (const shape of ['stepped', 'tapered']) {
    const stats = getProceduralCastleWallStats(recipe({ shape }));
    assert.ok(stats.stones <= 1800);
    assert.ok(stats.stones > 0);
  }
});

test('arch and buttress stones participate in the hard generation budget', () => {
  assert.throws(
    () => getProceduralCastleWallStats(recipe({ height: 35 })),
    /exceeded 1800 stones/,
  );
});
