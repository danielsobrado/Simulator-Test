import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CINEMATIC_FINISH, resolveCinematicFinish } from '../src/editor/stylized/cinematicFinish.js';
import { paintLensDirt } from '../src/editor/stylized/lensDirtTexture.js';

test('the finish resolves to the donor grade, and bad values fail at load', () => {
  const finish = resolveCinematicFinish({});
  assert.equal(finish.enabled, true);
  assert.equal(finish.contrast, DEFAULT_CINEMATIC_FINISH.contrast);
  assert.deepEqual(finish.gain, [...DEFAULT_CINEMATIC_FINISH.gain]);
  assert.equal(finish.bloom.threshold, 2.1);
  assert.deepEqual(resolveCinematicFinish({ enabled: false }), { enabled: false });
  assert.equal(resolveCinematicFinish({ bloom: { enabled: false } }).bloom.enabled, false);
  assert.throws(() => resolveCinematicFinish({ lift: [0, 0] }), /triple/);
  assert.throws(() => resolveCinematicFinish({ vignette: 3 }), /vignette/);
});

test('lens dirt rides on bloom, validates its intensity, and paints deterministically', () => {
  assert.deepEqual(resolveCinematicFinish({}).lensDirt, { enabled: true, intensity: 1.5 });
  assert.equal(resolveCinematicFinish({ bloom: { enabled: false } }).lensDirt.enabled, false);
  assert.equal(resolveCinematicFinish({ lensDirt: { enabled: false } }).lensDirt.enabled, false);
  assert.throws(() => resolveCinematicFinish({ lensDirt: { intensity: -1 } }), /lensDirt\.intensity/);
  const dirt = paintLensDirt(undefined, undefined, 7);
  assert.deepEqual(dirt, paintLensDirt(undefined, undefined, 7));
  const red = dirt.filter((_, i) => i % 4 === 0);
  assert.ok(red.some(v => v > 0) && red.some(v => v === 0), 'grime is patchy, not a flat wash');
});
