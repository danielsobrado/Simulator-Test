import assert from 'node:assert/strict';
import test from 'node:test';

import { clampPaletteCoordinate } from '../src/editor/ui/RadialPalette.js';

test('radial palette clamps normally when the host can contain its diameter', () => {
  assert.equal(clampPaletteCoordinate(10, 500, 100), 100);
  assert.equal(clampPaletteCoordinate(250, 500, 100), 250);
  assert.equal(clampPaletteCoordinate(490, 500, 100), 400);
});

test('radial palette centers an oversized menu instead of producing negative coordinates', () => {
  assert.equal(clampPaletteCoordinate(0, 100, 119), 50);
  assert.equal(clampPaletteCoordinate(100, 100, 119), 50);
  assert.equal(clampPaletteCoordinate(20, 0, 119), 0);
});
