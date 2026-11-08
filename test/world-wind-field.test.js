import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gradientNoise2dCpu,
  periodicGradientNoise2dCpu,
  WIND_NOISE_LATTICE_PERIOD,
} from '../src/editor/weather/wind/windNoise.js';
import {
  DEFAULT_WIND_FIELD,
  resolveWindFieldConfig,
  sampleWindFieldCpu,
} from '../src/editor/weather/wind/windFieldModel.js';
import { prevailingWindFromWeather, stormWindShape } from '../src/editor/weather/wind/WorldWindPass.js';
import { evaluateLevels } from '../src/editor/weather/storm/stormCurves.js';

const params = resolveWindFieldConfig();

function sample(x, z, time, directionDegrees = 0, intensity = 1) {
  return sampleWindFieldCpu({ x, z, time, directionDegrees, intensity, params });
}

test('noise stays near [0, 1] and is deterministic', () => {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 2000; i += 1) {
    const value = gradientNoise2dCpu(i * 0.137, i * 0.291);
    min = Math.min(min, value);
    max = Math.max(max, value);
    assert.equal(value, gradientNoise2dCpu(i * 0.137, i * 0.291));
  }
  assert.ok(min > -0.3 && max < 1.3, `range ${min}..${max}`);
});

test('periodic noise joins smoothly on both axes at every lattice wrap', () => {
  const period = WIND_NOISE_LATTICE_PERIOD;
  for (const boundary of [-period, 0, period, 2 * period]) {
    for (const coordinate of [-31.83, -0.71, 0.39, 47.26, period - 0.42]) {
      const beforeX = periodicGradientNoise2dCpu(boundary - 0.0001, coordinate);
      const afterX = periodicGradientNoise2dCpu(boundary + 0.0001, coordinate);
      const beforeY = periodicGradientNoise2dCpu(coordinate, boundary - 0.0001);
      const afterY = periodicGradientNoise2dCpu(coordinate, boundary + 0.0001);
      assert.ok(Math.abs(afterX - beforeX) < 0.001, `x seam at ${boundary}, ${coordinate}`);
      assert.ok(Math.abs(afterY - beforeY) < 0.001, `y seam at ${coordinate}, ${boundary}`);
      assert.ok(Math.abs(periodicGradientNoise2dCpu(coordinate, 0.37)
        - periodicGradientNoise2dCpu(coordinate + period, 0.37)) < 1e-10);
      assert.ok(Math.abs(periodicGradientNoise2dCpu(0.37, coordinate)
        - periodicGradientNoise2dCpu(0.37, coordinate + period)) < 1e-10);
    }
  }
});

test('strength stays inside the configured envelope, scaled by intensity', () => {
  for (let i = 0; i < 500; i += 1) {
    const wind = sample(i * 7.3, i * -3.1, i * 0.9);
    assert.ok(wind.strength >= DEFAULT_WIND_FIELD.minStrength - 1e-9);
    assert.ok(wind.strength <= DEFAULT_WIND_FIELD.maxStrength + 1e-9);
    assert.ok(Math.abs(Math.hypot(wind.directionX, wind.directionZ) - 1) < 1e-9);
    const double = sample(i * 7.3, i * -3.1, i * 0.9, 0, 2);
    assert.ok(Math.abs(double.strength - wind.strength * 2) < 1e-9);
  }
});

test('the local direction stays within the configured wobble of the prevailing wind', () => {
  const limit = (DEFAULT_WIND_FIELD.direction.variationDegrees * 1.35 * Math.PI) / 180;
  for (const prevailing of [0, 90, 225]) {
    for (let i = 0; i < 200; i += 1) {
      const wind = sample(i * 11, i * 5, i * 0.5, prevailing);
      const angle = Math.atan2(wind.directionZ, wind.directionX);
      let delta = angle - (prevailing * Math.PI) / 180;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      assert.ok(Math.abs(delta) <= limit, `delta ${delta}`);
    }
  }
});

test('gusts travel downwind rather than pulsing in place', () => {
  // Following the large layer downwind at its advection speed keeps the gust
  // pattern roughly still; standing still sees it change.
  const speed = DEFAULT_WIND_FIELD.large.speed / DEFAULT_WIND_FIELD.large.scale;
  let followingChange = 0;
  let standingChange = 0;
  for (let i = 0; i < 60; i += 1) {
    const x = i * 13;
    const t0 = i * 3;
    const t1 = t0 + 20;
    followingChange += Math.abs(sample(x + speed * (t1 - t0), 0, t1).gust - sample(x, 0, t0).gust);
    standingChange += Math.abs(sample(x, 0, t1).gust - sample(x, 0, t0).gust);
  }
  assert.ok(followingChange < standingChange, `${followingChange} vs ${standingChange}`);
});

test('planet-scale coordinates and long sessions keep a smooth field', () => {
  // Eldara is ~16,600 km across; the field is wrapped to its lattice period, so
  // two points a metre apart deep into the map still read as neighbours.
  for (const [x, z, time] of [[1.6e7, -8e6, 3600 * 24], [-4.2e6, 9.9e6, 3600 * 72]]) {
    const a = sample(x, z, time);
    const b = sample(x + 1, z, time);
    assert.ok(Math.abs(a.strength - b.strength) < 0.08, `${a.strength} vs ${b.strength}`);
  }
});

test('gust strength and direction stay continuous across advected lattice wrap boundaries', () => {
  for (const time of [0, 8, 60]) {
    const boundaries = [0,
      time * params.direction.speed / params.direction.scale,
      time * params.large.speed / params.large.scale,
      time * params.warp.speed / params.warp.scale,
    ];
    for (const x of boundaries) {
      for (let z = -50; z <= -1; z += 1.25) {
        const left = sample(x - 0.001, z, time);
        const right = sample(x + 0.001, z, time);
        const vectorDelta = Math.hypot(
          left.directionX * left.strength - right.directionX * right.strength,
          left.directionZ * left.strength - right.directionZ * right.strength,
        );
        assert.ok(vectorDelta < 0.005, `wind jumps ${vectorDelta} at (${x}, ${z}), time ${time}`);
      }
    }
  }
});

test('weather wind sets the prevailing direction and intensity; calm falls back to the default', () => {
  const calm = prevailingWindFromWeather({ enabled: false }, [1, 0]);
  assert.deepEqual(calm, { directionDegrees: 0, intensity: 1 });
  const storm = prevailingWindFromWeather({ enabled: true, windX: 0, windZ: 4, intensity: 1.6 }, [1, 0]);
  assert.equal(storm.directionDegrees, 90);
  assert.ok(storm.intensity > 1.5);
  const breeze = prevailingWindFromWeather({ enabled: true, windX: -0.42, windZ: 0.18, intensity: 0.7 }, [1, 0]);
  assert.ok(breeze.intensity >= 0.45 && breeze.intensity < 1);
});

test('level tables hit every key and stay monotone between them', () => {
  const values = [1, 1.3, 1.7, 2.1, 2.4];
  [0, 0.25, 0.5, 0.75, 1].forEach((s, i) => assert.ok(Math.abs(evaluateLevels(values, s) - values[i]) < 1e-12));
  let previous = -Infinity;
  for (let s = -0.1; s <= 1.1; s += 0.01) {
    const value = evaluateLevels(values, s);
    assert.ok(value >= previous - 1e-12);
    previous = value;
  }
});

test('the storm wind lifts the field to the ceiling and sharpens gusts, and leaves calm air alone', () => {
  const calm = stormWindShape(0.61, 0, params);
  assert.deepEqual(calm, { intensity: 0.61, gustThreshold: 0.48, gustPeak: 0.86 });
  const storm = stormWindShape(0.61, 1, params);
  assert.ok(Math.abs(storm.intensity - 2.4) < 1e-12);
  assert.deepEqual([storm.gustThreshold, storm.gustPeak], [0.3, 1]);
  // A lower threshold means a gust blows over more of the field.
  let calmGusts = 0;
  let stormGusts = 0;
  for (let i = 0; i < 400; i += 1) {
    const at = { x: i * 13.1, z: i * -7.7, time: i * 0.37, directionDegrees: 0, params };
    if (sampleWindFieldCpu(at).gust > 0.05) calmGusts += 1;
    if (sampleWindFieldCpu({ ...at, gustThreshold: 0.3, gustPeak: 1 }).gust > 0.05) stormGusts += 1;
  }
  assert.ok(stormGusts > calmGusts * 1.3, `gusty share ${calmGusts} → ${stormGusts}`);
});
