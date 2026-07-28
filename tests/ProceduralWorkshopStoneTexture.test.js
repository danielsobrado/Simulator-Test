import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStoneTexturePixels,
  summarizeStoneTexturePixels,
} from '../src/editor/workshop/ProceduralWorkshopStoneTexture.js';
import { STONE_PALETTES } from '../src/editor/workshop/ProceduralWorkshopMaterials.js';
import { stoneSurfaceProfile } from '../src/editor/workshop/ProceduralWorkshopStoneSurfaceConfig.js';

function pixelsFor(style, { seed = 42, weathering = 0.25, size = 64 } = {}) {
  return createStoneTexturePixels({
    palette: STONE_PALETTES[style],
    surface: stoneSurfaceProfile(style),
    seed,
    weathering,
    size,
  });
}

test('stone texture pixels are deterministic and seed-sensitive', () => {
  const a = pixelsFor('soft-limestone');
  const b = pixelsFor('soft-limestone');
  assert.deepEqual(a.data, b.data);
  const other = pixelsFor('soft-limestone', { seed: 99 });
  assert.notDeepEqual(a.data, other.data);
});

test('soft-limestone texture is calmer than legacy limestone', () => {
  const soft = summarizeStoneTexturePixels(pixelsFor('soft-limestone'));
  const legacy = summarizeStoneTexturePixels(pixelsFor('limestone'));
  assert.ok(soft.lumaStdDev < legacy.lumaStdDev);
  assert.ok(soft.meanChroma < legacy.meanChroma);
});

test('texture bytes stay in range and soft weathering darkens less', () => {
  for (const style of ['soft-limestone', 'limestone']) {
    const pixels = pixelsFor(style, { weathering: 1, size: 48 });
    for (const value of pixels.data) {
      assert.ok(value >= 0 && value <= 255);
    }
  }
  const softDry = pixelsFor('soft-limestone', { weathering: 0, size: 48 });
  const softWet = pixelsFor('soft-limestone', { weathering: 1, size: 48 });
  const legacyDry = pixelsFor('limestone', { weathering: 0, size: 48 });
  const legacyWet = pixelsFor('limestone', { weathering: 1, size: 48 });
  const meanBottom = (pixels) => {
    let sum = 0;
    let count = 0;
    const startY = Math.floor(pixels.size * 0.7);
    for (let y = startY; y < pixels.size; y += 1) {
      for (let x = 0; x < pixels.size; x += 1) {
        const offset = (y * pixels.size + x) * 4;
        sum += (pixels.data[offset] + pixels.data[offset + 1] + pixels.data[offset + 2]) / 3;
        count += 1;
      }
    }
    return sum / count;
  };
  const softDelta = meanBottom(softDry) - meanBottom(softWet);
  const legacyDelta = meanBottom(legacyDry) - meanBottom(legacyWet);
  assert.ok(softDelta > 0);
  assert.ok(legacyDelta > 0);
  assert.ok(softDelta < legacyDelta);
});
