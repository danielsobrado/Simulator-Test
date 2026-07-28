import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STONE_PALETTES,
  defineStonePalette,
} from '../src/editor/workshop/ProceduralWorkshopMaterials.js';

function chroma(stop) {
  return Math.max(...stop) - Math.min(...stop);
}

function relativeLuminance([r, g, b]) {
  const toLinear = (channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function meanChroma(palette) {
  const stops = [palette.base, ...palette.ramp];
  return stops.reduce((total, stop) => total + chroma(stop), 0) / stops.length;
}

test('soft-limestone palette matches the pale descriptor', () => {
  const palette = STONE_PALETTES['soft-limestone'];
  assert.deepEqual([...palette.base], [188, 186, 176]);
  assert.deepEqual([...palette.warm], [198, 194, 181]);
  assert.equal(palette.color, '#bcbab0');
  assert.deepEqual(palette.ramp.map((stop) => [...stop]), [
    [188, 186, 176],
    [196, 193, 181],
    [180, 181, 175],
    [191, 189, 180],
  ]);
  assert.deepEqual([...palette.outlier], [166, 168, 164]);
  assert.equal(palette.outlierChance, 0.045);
  assert.equal(Object.isFrozen(palette), true);
  assert.equal(Object.isFrozen(palette.base), true);
  assert.equal(Object.isFrozen(palette.ramp[0]), true);
});

test('soft-limestone stays low-chroma and narrow in luminance', () => {
  const soft = STONE_PALETTES['soft-limestone'];
  for (const stop of soft.ramp) {
    assert.ok(chroma(stop) <= 18, `chroma ${chroma(stop)}`);
    for (const channel of stop) {
      assert.ok(channel >= 160 && channel <= 205, `channel ${channel}`);
    }
  }
  const luminances = soft.ramp.map(relativeLuminance);
  assert.ok(Math.max(...luminances) - Math.min(...luminances) < 0.12);
  assert.ok(soft.outlierChance <= 0.06);

  const legacy = STONE_PALETTES.limestone;
  assert.ok(meanChroma(soft) < meanChroma(legacy) * 0.5);
});

test('legacy limestone palette is unchanged', () => {
  const limestone = STONE_PALETTES.limestone;
  assert.deepEqual([...limestone.base], [194, 180, 148]);
  assert.deepEqual([...limestone.warm], [220, 202, 154]);
  assert.equal(limestone.color, '#c4b794');
  assert.equal(limestone.outlierChance, 0.1);
});

test('invalid palette descriptors fail clearly', () => {
  const base = {
    base: [188, 186, 176],
    warm: [198, 194, 181],
    color: '#bcbab0',
    ramp: [[188, 186, 176], [196, 193, 181]],
    outlierChance: 0.05,
  };
  assert.throws(() => defineStonePalette({ ...base, base: [1, 2] }), /three channels/);
  assert.throws(() => defineStonePalette({ ...base, color: '#fff' }), /six-digit/);
  assert.throws(
    () => defineStonePalette({ ...base, color: '#000000' }),
    /does not match base/,
  );
  assert.throws(() => defineStonePalette({ ...base, outlierChance: 2 }), /outlierChance/);
  assert.throws(() => defineStonePalette({ ...base, ramp: [[1, 2, 3]] }), /between 2 and 8/);
});
