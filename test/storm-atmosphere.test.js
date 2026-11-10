import test from 'node:test';
import assert from 'node:assert/strict';

import { overcastSkyLook, resolveSkyLook, stormLadder } from '../src/editor/stylized/sky/SkyLook.js';
import { SkyLookController } from '../src/editor/stylized/sky/SkyLookController.js';
import { stormAirLook, stormFogDensity, stormWhiteout } from '../src/editor/stylized/sky/stormAirLook.js';
import { WorldAmbience } from '../src/editor/stylized/ambient/WorldAmbience.js';

const SKY = {
  lowColor: '#9cc9e2', highColor: '#3f83c2', sunColor: '#fff4dc', sunGlowColor: '#ffd7a6',
  cloudCore: '#b8c6d2', cloudEdge: '#f7fbff', cloudRim: '#fff3dc', fogColor: '#9cc9e2',
  groundLightColor: '#6f784d', directionalColor: '#fff3dc', sunElevation: 10, sunAzimuth: 258,
  sunEmission: 1.4, sunGlowIntensity: 0.45, cloudOpacity: 0.62, cloudDensity: 0.56,
  ambientIntensity: 2, directionalIntensity: 3, cloudShadows: { enabled: true, strength: 0.45 },
  fogDensity: 0.0015,
};
const day = resolveSkyLook(SKY, 'configured');
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

test('the storm ladder hits each level and interpolates between them', () => {
  const values = [1, 0.6, 0.25, 0.15, 0.1];
  [0, 0.25, 0.5, 0.75, 1].forEach((s, i) => assert.ok(Math.abs(stormLadder(values, s) - values[i]) < 1e-12));
  assert.ok(Math.abs(stormLadder(values, 0.625) - 0.2) < 1e-12);
  assert.equal(stormLadder(values, 2), 0.1);
});

test('a storm darkens past full overcast; cloud alone is unchanged', () => {
  const overcast = overcastSkyLook(day, 1);
  assert.ok(Math.abs(overcast.directionalIntensity - day.directionalIntensity * 0.15) < 1e-9);
  const storm = overcastSkyLook(day, 1, 1);
  assert.ok(Math.abs(storm.directionalIntensity - day.directionalIntensity * 0.1) < 1e-9);
  assert.ok(Math.abs(storm.ambientIntensity - day.ambientIntensity * 0.7) < 1e-9);
  assert.equal(storm.cloudShadowStrength, 0);
  // Light rain: half the cloud shadow, 60 % sun, even under thin cover.
  const light = overcastSkyLook(day, 0.35, 0.25);
  assert.ok(Math.abs(light.directionalIntensity - day.directionalIntensity * 0.6) < 1e-9);
  assert.ok(Math.abs(light.cloudShadowStrength - day.cloudShadowStrength * 0.5) < 1e-9);
});

test('cloud 0.55 closes over half of the way to the lid (was squared)', () => {
  const covered = overcastSkyLook(day, 0.55);
  const share = (day.cloudDensity - covered.cloudDensity) / (day.cloudDensity + 0.25);
  assert.ok(Math.abs(share - 0.55) < 1e-9);
});

test('storm fog meets the visibility targets and never thins a look', () => {
  const visibility = (s, share) => 1.73 / stormFogDensity(s, share);
  assert.equal(stormFogDensity(0), 0);
  assert.ok(Math.abs(visibility(0.25, 0) - 1500) < 1e-6);
  assert.ok(Math.abs(visibility(0.75, 0) - 250) < 1e-6);
  assert.ok(Math.abs(visibility(1, 0) - 150) < 1e-6);
  assert.ok(Math.abs(visibility(1, 1) - 140) < 1e-6);
  const hazy = { ...day, fogDensityScale: 3 };
  assert.equal(stormAirLook(hazy, { storm: 0.25, snowShare: 0 }, 0.0015).fogDensityScale, 3, 'light rain keeps a hazier look');
  const full = stormAirLook(day, { storm: 1, snowShare: 1 }, 0.0015);
  assert.ok(Math.abs(0.0015 * full.fogDensityScale - 1.73 / 140) < 1e-9);
  assert.equal(stormAirLook(day, { storm: 0, snowShare: 1 }, 0.0015), day, 'clear is the look itself');
});

test('rain fog greys toward dark blue-grey, snow toward white with a whiteout', () => {
  const rain = stormAirLook(day, { storm: 1, snowShare: 0 }, 0.0015);
  const snow = stormAirLook(day, { storm: 1, snowShare: 1 }, 0.0015);
  assert.ok(luminance(rain.fogColor) < luminance(day.fogColor));
  assert.ok(luminance(snow.fogColor) > luminance(rain.fogColor) + 60);
  assert.equal(rain.whiteout, 0);
  assert.equal(snow.whiteout, 1);
  assert.equal(snow.skyFog, 1);
  assert.equal(stormWhiteout(0.5, 1), 0, 'no whiteout below heavy');
  assert.ok(snow.ambientIntensity > rain.ambientIntensity, 'white air lifts the light');
  const night = stormAirLook({ ...day, nightness: 1, fogColor: '#1a2230' }, { storm: 1, snowShare: 1 }, 0.0015);
  assert.ok(luminance(night.fogColor) < luminance(snow.fogColor) * 0.5, 'a night blizzard stays dark');
});

test('the controller lays the storm over the look and settles', () => {
  const applied = [];
  const controller = new SkyLookController({ skyView: { config: { sky: SKY }, applyLook: (l) => applied.push(l) }, preset: 'configured' });
  controller.setStorm({ cloud: 1, storm: 1, snowShare: 1 });
  for (let i = 0; i < 60; i += 1) controller.update(0.1);
  const look = applied.at(-1);
  assert.equal(look.whiteout, 1);
  assert.ok(Math.abs(0.0015 * look.fogDensityScale - 1.73 / 140) < 1e-9);
  assert.equal(controller.update(0.1), false, 'settled');
  controller.setStorm({ cloud: 1, storm: 1, snowShare: 1 });
  assert.equal(controller.update(0.1), false, 'a repeated frame writes nothing');
});

test('storm wind lifts ambient windiness up to twice the reference', () => {
  const ambience = { system: { settings: { windReference: 2.4 } }, defaultWind: { x: 1, z: 0 } };
  const windFor = (weather) => WorldAmbience.prototype.windFor.call(ambience, weather).strength;
  const calm = { enabled: true, mode: 'off', windX: 0, windZ: 0, intensity: 0 };
  assert.equal(windFor(calm), 2.4);
  assert.equal(windFor({ ...calm, storm: 1 }), 4.8);
  const breeze = { enabled: true, mode: 'wind', windX: 1, windZ: 0, intensity: 0.5 };
  assert.equal(windFor(breeze), 0.5, 'a weak weather wind stays weak at clear');
  assert.ok(Math.abs(windFor({ ...breeze, storm: 0.5 }) - 3.6) < 1e-9);
});
