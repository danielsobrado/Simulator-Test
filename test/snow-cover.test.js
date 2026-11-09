import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SNOW_COVER, SnowCover, resolveSnowCoverConfig } from '../src/editor/weather/storm/SnowCover.js';

function run(cover, seconds, snow, share = 0) {
  for (let t = 0; t < seconds; t += 0.5) cover.update(0.5, snow, share);
  return cover.value;
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('a snowstorm whitens the ground over buildSeconds and it melts over meltSeconds', () => {
  const cover = new SnowCover();
  near(run(cover, 180, 1), 0.5);
  near(run(cover, 180, 1), 1);
  assert.equal(run(cover, 60, 1.6), 1, 'a QA gain above 1 never overfills');
  near(run(cover, 300, 0), 0.5);
  near(run(cover, 300, 0), 0);
  // A flurry holds the cover at its own level.
  near(run(cover, 3600, 0.4), 0.4);
  assert.equal(cover.update(0, 1), 0.4, 'no time, no change');
});

test('snow country keeps what fell', () => {
  const cover = new SnowCover();
  run(cover, 360, 1, 1);
  const held = cover.value;
  assert.equal(run(cover, 3600, 0, 0.3), held, 'never melts at holdShare');
  near(held, 1);
  near(run(cover, 60, 0, 0.29), 0.9);
});

test('a snapped storm starts at its steady state', () => {
  const cover = new SnowCover();
  assert.equal(cover.snap(0.8), 0.8);
  assert.equal(cover.snap(2), 1);
  assert.equal(cover.snap(0), 0);
  assert.equal(cover.snap(Number.NaN), 0);
});

test('snow cover settings default and reject nonsense', () => {
  assert.deepEqual(resolveSnowCoverConfig(), DEFAULT_SNOW_COVER);
  assert.equal(resolveSnowCoverConfig({ buildSeconds: 60 }).buildSeconds, 60);
  assert.throws(() => resolveSnowCoverConfig({ meltSeconds: 0 }), /snowCover\.meltSeconds/);
  assert.throws(() => resolveSnowCoverConfig({ holdShare: 'x' }), /snowCover\.holdShare/);
});
