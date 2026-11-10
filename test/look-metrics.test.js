import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGates, lookMetrics, regionStats } from '../scripts/lib/look-metrics.mjs';

test('look regions retain luma, percentiles and the largest adjacent-row seam', () => {
  const pixels = Uint8Array.from(Array.from({ length: 16 }, (_, i) => [i < 8 ? 200 : 50, i < 8 ? 200 : 50, i < 8 ? 200 : 50]).flat());
  const result = lookMetrics(pixels, 4, 4, { sky: [0, 2], ground: [0, 4], band: [2, 4] });
  assert.ok(Math.abs(result.sky.mean - 200) < 1e-10);
  assert.ok(Math.abs(result.band.mean - 50) < 1e-10);
  assert.ok(Math.abs(result.maxRowStep - 150) < 1e-10);
  assert.ok(Math.abs(result.groundContrast - 150) < 1e-10);
  const uniform = lookMetrics(new Uint8Array(48).fill(50), 4, 4);
  assert.ok(uniform.full.sd < 1e-10);
  assert.equal(uniform.groundContrast, 0);
  assert.equal(uniform.chromaSd, 0);
  assert.throws(() => regionStats(pixels, 4, 0, 5));
});

test('red share excludes warm yellow and chroma deviation uses ground pixels', () => {
  const pixels = Uint8Array.from([200, 100, 100, 200, 180, 100, 50, 100, 50, 80, 30, 50]);
  const result = lookMetrics(pixels, 2, 2);
  assert.equal(result.redShare, 0.25);
  assert.equal(result.chromaSd, 50);
});

test('look gates include equality and reject missing or non-finite measurements', () => {
  const metrics = { full: { mean: 50 }, groundContrast: 30 };
  assert.equal(checkGates(metrics, { 'full.meanMin': 51 })[0].passed, false);
  assert.equal(checkGates(metrics, { 'full.meanMin': 50 })[0].passed, true);
  assert.equal(checkGates(metrics, { 'full.meanMax': 49 })[0].passed, false);
  assert.equal(checkGates(metrics, { 'full.meanRatioMax': 0.5, against: 'noon' }, { full: { mean: 100 } })[0].passed, true);
  assert.equal(checkGates(metrics, { 'full.meanRatioMax': 0.5 })[0].passed, false);
  assert.equal(checkGates(undefined, { groundContrastMin: 30 })[0].passed, false);
  assert.throws(() => checkGates(metrics, { unknown: 1 }));
});
