import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bladeLengthFraction,
  clumpSpacing,
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
  // mirror editor.config.yaml: tileSize 2, blades 576/96, clumpRadius 0.75 m.
  const tileSize = 2;
  const clumps = clumpsPerCell(576, 96);

  const spacing = clumpSpacing(clumps, tileSize);
  assert.ok(Math.abs(spacing - 0.8165) < 0.001, `spacing ${spacing}`);
  assert.ok(clumpsFormCarpet(0.75, clumps, tileSize), 'clumps leave gaps');

  // Half that radius must still read as tufts — otherwise this test is not
  // measuring anything.
  assert.equal(clumpsFormCarpet(0.36, clumps, tileSize), false);
});

test('clump footprint no longer moves with blade width', () => {
  // The radius used to be expressed in blade-widths and resolved against the
  // instance width, so narrowing the blades to stop them reading as ribbons also
  // shrank every clump. At the shipped 0.023 m mean width the old model gave
  // 12.5 * 0.023 = 0.29 m — inside the tuft range this same test rejects above.
  const tileSize = 2;
  const clumps = clumpsPerCell(576, 96);
  assert.equal(clumpsFormCarpet(12.5 * 0.023, clumps, tileSize), false);
  // The metre-denominated radius is unmoved by the same narrowing, which is the
  // whole point of separating the two.
  assert.ok(clumpsFormCarpet(0.75, clumps, tileSize));
});

test('the shipped length skew gives a mostly-short sward with a tall minority', () => {
  // Pins the split editor.config.yaml documents. A flat roll over 0.10–0.32 puts
  // most blades near 0.21 m, which reads as a mown lawn; sward is mostly short.
  const minLength = 0.10;
  const maxLength = 0.32;
  const skew = 5.0;
  const samples = 100000;
  let short = 0;
  let medium = 0;
  let tall = 0;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    const length = minLength
      + bladeLengthFraction((index + 0.5) / samples, skew) * (maxLength - minLength);
    total += length;
    if (length < 0.16) short += 1;
    else if (length < 0.24) medium += 1;
    else tall += 1;
  }
  const percent = (count) => (count / samples) * 100;
  assert.ok(percent(short) > 70 && percent(short) < 80, `short ${percent(short)}%`);
  assert.ok(percent(medium) > 10 && percent(medium) < 20, `medium ${percent(medium)}%`);
  assert.ok(percent(tall) > 5 && percent(tall) < 12, `tall ${percent(tall)}%`);
  // The mean matters as much as the split: it is what apparent coverage scales
  // with, and it is why the config points at bladesPerCell as the compensation.
  assert.ok(Math.abs(total / samples - 0.137) < 0.005, `mean ${total / samples}`);
});

test('an unskewed roll is the flat distribution the skew replaces', () => {
  assert.equal(bladeLengthFraction(0.5), 0.5);
  assert.equal(bladeLengthFraction(0.5, 1), 0.5);
  // Monotone, which is what lets blade width keep correlating against the raw rank
  // instead of the skewed value.
  assert.ok(bladeLengthFraction(0.8, 5) > bladeLengthFraction(0.3, 5));
  // Clamped, so a roll that lands slightly outside [0, 1] cannot invert a blade.
  assert.equal(bladeLengthFraction(-0.2, 5), 0);
  assert.equal(bladeLengthFraction(1.4, 5), 1);
});

test('chunks switch to the cheap blade band past the near radius', () => {
  assert.equal(grassLodBand(0, 1), 'near');
  assert.equal(grassLodBand(1, 1), 'near');
  assert.equal(grassLodBand(2, 1), 'far');
  // nearRadius equal to residentRadius keeps every ring on full-shape blades,
  // which is the pre-band behaviour.
  assert.equal(grassLodBand(2, 2), 'near');
});
