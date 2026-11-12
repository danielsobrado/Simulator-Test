import assert from 'node:assert/strict';
import test from 'node:test';
import { understoryLookAt } from '../src/editor/biomes/understoryRampLooks.js';
import { resolveFoliagePalette } from '../src/editor/stylized/forest/foliagePalette.js';

function configWith(looks) {
  const understory = new Float32Array(256 * 4).fill(1);
  for (const [id, look] of Object.entries(looks)) understory.set(look, id * 4);
  return {
    biomeLooks: { understory },
    grass: { meadow: { palette: { base: '#62883c', tip: '#c4d27a', byTileId: {
      3: { base: '#776336', tip: '#dcc890' },
      6: { base: '#4d6839', tip: '#9ab477' },
      12: { base: '#050505', tip: '#0a0a0a' },
    } } } },
    trees: { canopyGrade: { shadow: '#1d5a42', light: '#a8c566' } },
  };
}
const mid = (config, id) => {
  const { base, tip } = resolveFoliagePalette(config, id);
  return base.lerp(tip, 0.5);
};

test('a plant on its home tile keeps the biome look untouched', () => {
  const config = configWith({ 6: [0.9, 0.8, 0.7, 0.5] });
  assert.deepEqual([...understoryLookAt(config, 6, 6)], [...config.biomeLooks.understory.subarray(24, 28)]);
});

test('away from home the look carries the ratio of the two ramps and keeps w', () => {
  const config = configWith({ 3: [0.5, 0.5, 0.5, 0.7] });
  const look = understoryLookAt(config, 6, 3);
  const home = mid(config, 6), here = mid(config, 3);
  assert.ok(Math.abs(look[0] - 0.5 * here.r / home.r) < 1e-5);
  assert.ok(Math.abs(look[2] - 0.5 * here.b / home.b) < 1e-5);
  assert.ok(Math.abs(look[3] - 0.7) < 1e-6);
  assert.ok(look[0] / look[2] > 1, 'a wood shrub on savanna leans warm');
});

test('the shift is bounded and an unknown home tile falls back to the plain look', () => {
  const config = configWith({});
  for (const value of understoryLookAt(config, 6, 12).subarray(0, 3)) assert.ok(value >= 0.4 && value <= 2.5);
  assert.deepEqual([...understoryLookAt(config, undefined, 3)], [1, 1, 1, 1]);
});
