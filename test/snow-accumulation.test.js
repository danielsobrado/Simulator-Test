import assert from 'node:assert/strict';
import test from 'node:test';
import { snowAccumulation, snowBiomeCoverAt, snowBiomeCoverField } from '../src/editor/materials/SnowAccumulation.js';

const classification = Object.freeze({
  snowLine: 700,
  snowFade: 250,
  snowSlopeMax: 0.55,
  snowBiomeCover: Object.freeze({ 10: 0.35, 11: 1 }),
  snowPatchScale: 60,
  snowPatchStrength: 0.45,
  snowWindShift: 0.25,
  snowConcavity: 4,
});

const flat = Object.freeze({ slope: 0, dx: 0, dz: 0, curvature: 0, tileId: 6, patch: 0.5 });

test('lowland grass carries no snow; high ground above the band is white', () => {
  assert.equal(snowAccumulation({ ...flat, height: 75 }, classification), 0);
  assert.equal(snowAccumulation({ ...flat, height: 1200 }, classification), 1);
  const edge = snowAccumulation({ ...flat, height: 825 }, classification);
  assert.ok(edge > 0 && edge < 1);
});

test('glacier and tundra hold snow at any height', () => {
  assert.equal(snowAccumulation({ ...flat, height: 20, tileId: 11 }, classification), 1);
  // Partial cover lies as whole drifts over that share of the ground, not as a film.
  assert.equal(snowAccumulation({ ...flat, height: 20, tileId: 10 }, classification), 0, 'bare between drifts');
  assert.equal(snowAccumulation({ ...flat, height: 20, tileId: 10, patch: 0.9 }, classification), 1, 'a full drift');
  assert.equal(snowAccumulation({ ...flat, height: 20, tileId: 10, patch: 0.5, curvature: 0.05 }, classification), 0,
    'curvature, which grows with bake resolution, does not decide where a drift lies');
  assert.equal(snowAccumulation({ ...flat, height: 950, tileId: 10 }, classification), 1);
  assert.equal(snowAccumulation({ ...flat, height: 950, tileId: 11 }, classification), 1);
  for(const tileId of [10,11])assert.equal(snowAccumulation({ ...flat, height: 20, slope: .55, tileId }, classification), 0);
});

test('steep faces shed snow and windward faces lose it to the lee', () => {
  const high = { ...flat, height: 900, tileId: 10 };
  assert.equal(snowAccumulation({ ...high, slope: 0.8, dx: 0.8 }, classification), 0);
  // Prevailing wind blows toward (0.8, 0.6): a face rising along it is windward.
  const windward = snowAccumulation({ ...high, slope: 0.3, dx: 0.24, dz: 0.18 }, classification);
  const lee = snowAccumulation({ ...high, slope: 0.3, dx: -0.24, dz: -0.18 }, classification);
  assert.ok(lee > windward, `lee ${lee} > windward ${windward}`);
});

test('hollows hold more than ridges', () => {
  const edge = { ...flat, height: 825 };
  const hollow = snowAccumulation({ ...edge, curvature: 0.05 }, classification);
  const ridge = snowAccumulation({ ...edge, curvature: -0.05 }, classification);
  assert.ok(hollow > ridge);
});

test('grass is kept off snow in the surface mask, following the bake', async () => {
  const { buildSurfaceMaskPixels } = await import('../src/editor/world/ChunkRenderPixels.js');
  const chunkSize = 4;
  const tiles = new Uint8Array(chunkSize * chunkSize).fill(6);
  const build = (height) => buildSurfaceMaskPixels({
    tiles,
    heights: new Float32Array((chunkSize + 1) ** 2).fill(height),
    originX: 0,
    originZ: 0,
    chunkSize,
    sampleTile: () => 6,
    sampleHeight: () => height,
    maskConfig: {
      blendCells: 2.5,
      roadTileId: 13,
      waterTileId: 0,
      grassTileIds: [6],
      waterlineDepth: 0.35,
      snow: { classification, seedOffset: 2401, tileSize: 2 },
      worldSeed: 918273,
    },
  });
  const grass = (mask) => [...mask].filter((_, index) => index % 4 === 1);
  assert.ok(grass(build(80)).every((value) => value === 255), 'lowland keeps its grass');
  assert.ok(grass(build(1500)).every((value) => value === 0), 'snowfields are bare');
});

test('the drift field stays near-uniform, so partial cover matches its area', async () => {
  const { snowDriftNoise } = await import('../src/editor/materials/SnowAccumulation.js');
  let above = 0;
  const samples = 20000;
  for (let i = 0; i < samples; i += 1) {
    const value = snowDriftNoise((i * 7919) % 100000, (i * 104729) % 100000, 60, 1234);
    assert.ok(value >= 0 && value <= 1);
    if (value > 0.65) above += 1;
  }
  const share = above / samples;
  assert.ok(share > 0.25 && share < 0.42, `cover 0.35 lies over ${share}`);
});

test('a road lies under the snow of the country it crosses', () => {
  const size = 21;
  const road = 13;
  // Glacier with a road down the middle column.
  const halo = Array.from({ length: size * size }, (_, i) => (i % size === 10 ? road : 11));
  const field = snowBiomeCoverField(halo, size, { 11: 1 }, road);
  assert.ok(Math.abs(field[10 * size + 10] - 1) < 1e-6);
  const tileAt = (x, z) => (x === 10 && z >= 0 && z < size ? road : 11);
  assert.ok(Math.abs(snowBiomeCoverAt(tileAt, 10, 10, { 11: 1 }, road) - 1) < 1e-6);
  // Without the road id it still counts as snowless ground.
  assert.ok(snowBiomeCoverField(halo, size, { 11: 1 })[10 * size + 10] < 0.9);
});
