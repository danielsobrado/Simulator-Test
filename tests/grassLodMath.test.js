import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clumpSpacing,
  clumpWorldRadius,
  clumpsFormCarpet,
  clumpsPerCell,
  densityForDistance,
  grassInstanceAttributeBytes,
  grassLodBand,
  trianglesPerBlade,
} from '../src/editor/stylized/grassLodMath.js';

test('grass clumping preserves effective blade density with fewer instances', () => {
  assert.equal(clumpsPerCell(48, 8), 6);
  const bytes = grassInstanceAttributeBytes({
    chunkSize: 64,
    bladesPerCell: 48,
    bladesPerClump: 8,
  });
  assert.equal(bytes, 64 * 64 * 6 * 7 * 4);
  assert.ok(bytes < 1024 * 1024);
});

test('outer-ring density is monotonic', () => {
  assert.equal(densityForDistance(0, 2, 0.4), 1);
  assert.equal(densityForDistance(2, 2, 0.4), 0.4);
  assert.ok(densityForDistance(1, 2, 0.4) < 1);
});

test('the far blade band is a fifth of the near band per blade', () => {
  assert.equal(trianglesPerBlade(3), 5);
  assert.equal(trianglesPerBlade(1), 1);
  // The saving is what pays for the extra ring of grass.
  assert.equal(trianglesPerBlade(3) / trianglesPerBlade(1), 5);
  assert.throws(() => trianglesPerBlade(0), /positive integer/);
  assert.throws(() => trianglesPerBlade(1.5), /positive integer/);
});

test('the shipped clump radius overlaps clumps into continuous cover', () => {
  // Regression guard for grass reading as separate tufts on bare ground. Values
  // mirror editor.config.yaml: tileSize 2, blades 192/32, width 0.06, and
  // CLUMP_RADIUS 12.5 in StylizedGrassSlot.
  const tileSize = 2;
  const clumps = clumpsPerCell(192, 32);
  const meanWidth = 0.06;

  const spacing = clumpSpacing(clumps, tileSize);
  assert.ok(Math.abs(spacing - 0.8165) < 0.001, `spacing ${spacing}`);
  assert.ok(clumpsFormCarpet(12.5, meanWidth, clumps, tileSize), 'clumps leave gaps');
  assert.ok(clumpWorldRadius(12.5, meanWidth) > spacing * 0.9);

  // The old radius is what produced the tufts, and must still read as such —
  // otherwise this test is not measuring anything.
  assert.equal(clumpsFormCarpet(3.55, meanWidth, clumps, tileSize), false);
  assert.ok(Math.abs(clumpWorldRadius(3.55, meanWidth) - 0.213) < 0.001);
});

test('chunks switch to the cheap blade band past the near radius', () => {
  assert.equal(grassLodBand(0, 1), 'near');
  assert.equal(grassLodBand(1, 1), 'near');
  assert.equal(grassLodBand(2, 1), 'far');
  // nearRadius equal to residentRadius keeps every ring on full-shape blades,
  // which is the pre-band behaviour.
  assert.equal(grassLodBand(2, 2), 'near');
});
