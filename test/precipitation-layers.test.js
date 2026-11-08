import assert from 'node:assert/strict';
import test from 'node:test';
import { interleaveLayers, layerAllocation, precipitationDensity } from '../src/editor/weather/storm/precipitationLayers.js';
import { evaluateLevels, PRECIP_LEVEL_KEYS } from '../src/editor/weather/storm/stormCurves.js';
import { DEFAULT_WEATHER_EFFECTS } from '../src/editor/weather/WeatherEffectsConfig.js';

const { rain, snowfall } = DEFAULT_WEATHER_EFFECTS;

test('interleaving keeps every prefix in proportion and ranks each layer in buffer order', () => {
  const counts = [4500, 14000, 4000];
  const { layer, rank, slots } = interleaveLayers(counts);
  assert.equal(layer.length, 22500);
  for (const prefix of [100, 2250, 11250]) {
    const seen = [0, 0, 0];
    for (let slot = 0; slot < prefix; slot += 1) seen[layer[slot]] += 1;
    counts.forEach((count, index) => assert.ok(Math.abs(seen[index] - count * prefix / 22500) <= 1, `${prefix}: ${seen}`));
  }
  slots.forEach((layerSlots, index) => layerSlots.forEach((slot, r) => {
    assert.equal(layer[slot], index);
    assert.equal(rank[slot], r);
  }));
});

test('clear draws nothing and each level draws its table counts', () => {
  const allocation = layerAllocation(rain.layers);
  const { slots } = interleaveLayers(allocation);
  const clear = precipitationDensity(rain.layers, 0, slots);
  assert.equal(clear.instanceCount, 0);
  assert.equal(clear.fade, 0);
  PRECIP_LEVEL_KEYS.forEach((key, level) => {
    const frame = precipitationDensity(rain.layers, key, slots);
    rain.layers.forEach((layer, index) => assert.ok(Math.abs(frame.live[index] - layer.counts[level]) < 1e-9));
    // Every live drop of every layer lies inside the drawn prefix.
    frame.live.forEach((live, index) => {
      if (live > 0) assert.ok(slots[index][Math.ceil(live) - 1] < frame.instanceCount);
    });
  });
  const light = precipitationDensity(rain.layers, PRECIP_LEVEL_KEYS[1], slots);
  assert.ok(light.instanceCount < 0.2 * 22500, `light rain trims the vertex work (${light.instanceCount})`);
  assert.equal(precipitationDensity(rain.layers, 1, slots).instanceCount, 22500);
});

test('density rises smoothly from clear, fading in instead of popping', () => {
  const { slots } = interleaveLayers(layerAllocation(snowfall.layers));
  let previous = 0;
  for (let channel = 0; channel <= 1.0001; channel += 0.01) {
    const frame = precipitationDensity(snowfall.layers, channel, slots);
    const total = frame.live.reduce((a, b) => a + b, 0);
    assert.ok(total >= previous - 1e-6 || channel > PRECIP_LEVEL_KEYS[3], `monotone below heavy at ${channel}`);
    previous = total;
  }
  const first = precipitationDensity(snowfall.layers, 0.005, slots);
  assert.ok(first.fade > 0 && first.fade < 0.1, `first flakes fade in (${first.fade})`);
  assert.equal(evaluateLevels(snowfall.layers[2].counts, 1, PRECIP_LEVEL_KEYS), 0, 'near-soft culled at storm');
});
