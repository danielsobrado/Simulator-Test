import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SKY_LOOK_COLORS,
  SKY_LOOK_NUMBERS,
  mixSkyLooks,
  overcastSkyLook,
  resolveSkyLook,
} from '../src/editor/stylized/sky/SkyLook.js';
import { SkyLookController } from '../src/editor/stylized/sky/SkyLookController.js';
import { SKY_PRESETS } from '../src/editor/stylized/sky/SkyPresets.js';

const SKY = {
  lowColor: '#9cc9e2',
  highColor: '#3f83c2',
  sunColor: '#fff4dc',
  sunGlowColor: '#ffd7a6',
  cloudCore: '#b8c6d2',
  cloudEdge: '#f7fbff',
  cloudRim: '#fff3dc',
  fogColor: '#9cc9e2',
  groundLightColor: '#6f784d',
  directionalColor: '#fff3dc',
  sunElevation: 10,
  sunAzimuth: 258,
  sunEmission: 1.4,
  sunGlowIntensity: 0.45,
  cloudOpacity: 0.62,
  cloudDensity: 0.56,
  ambientIntensity: 2,
  directionalIntensity: 3,
  cloudShadows: { enabled: true, strength: 0.45 },
};

test('the configured look is the sky exactly as configured', () => {
  const look = resolveSkyLook(SKY, 'configured');
  for (const key of [...SKY_LOOK_COLORS, ...SKY_LOOK_NUMBERS]) {
    if (key in SKY) assert.equal(look[key], SKY[key], key);
  }
  assert.equal(look.fogDensityScale, 1);
  assert.equal(look.cloudShadowStrength, 0.45);
  assert.equal(look.night, false);
  assert.equal(resolveSkyLook(SKY, 'no-such-preset').sunAzimuth, resolveSkyLook(SKY, 'meadow').sunAzimuth, 'unknown names fall back to the default');
});

test('every preset resolves to a complete look', () => {
  for (const name of Object.keys(SKY_PRESETS)) {
    const look = resolveSkyLook(SKY, name);
    for (const key of SKY_LOOK_COLORS) assert.match(look[key], /^#[0-9a-f]{6}$/i, `${name}.${key}`);
    for (const key of SKY_LOOK_NUMBERS) assert.ok(Number.isFinite(look[key]), `${name}.${key}`);
  }
  assert.equal(resolveSkyLook(SKY, 'moonrise').night, true);
});

test('looks blend end to end and the sun turns the short way', () => {
  const day = resolveSkyLook(SKY, 'configured');
  const dusk = resolveSkyLook(SKY, 'emberfall');
  assert.equal(mixSkyLooks(day, dusk, 0).highColor, day.highColor);
  assert.equal(mixSkyLooks(day, dusk, 1).highColor, dusk.highColor);
  assert.equal(mixSkyLooks(day, dusk, 0.5).directionalIntensity, (day.directionalIntensity + dusk.directionalIntensity) / 2);
  const across = mixSkyLooks({ ...day, sunAzimuth: 350 }, { ...day, sunAzimuth: 10 }, 0.5);
  assert.ok(Math.abs(((across.sunAzimuth % 360) + 360) % 360) < 1e-9, 'through north, not round the south');
});

test('overcast greys any look and keeps night dark', () => {
  const day = resolveSkyLook(SKY, 'configured');
  assert.equal(overcastSkyLook(day, 0), day);
  const grey = overcastSkyLook(day, 1);
  assert.ok(grey.directionalIntensity < day.directionalIntensity * 0.5);
  assert.ok(grey.cloudDensity < day.cloudDensity, 'clouds close up');
  assert.ok(grey.cloudShadowStrength < day.cloudShadowStrength);
  assert.ok(grey.fogDensityScale > 1);
  const night = resolveSkyLook(SKY, 'moonrise');
  const rainyNight = overcastSkyLook(night, 1);
  assert.equal(rainyNight.night, true);
  assert.ok(rainyNight.directionalIntensity <= night.directionalIntensity);
});

test('the controller eases between presets and writes the sky only while changing', () => {
  const applied = [];
  const skyView = { config: { sky: SKY }, applyLook: (look) => applied.push(look) };
  const controller = new SkyLookController({ skyView, preset: 'configured' });
  assert.equal(controller.update(0.1), false, 'configured at rest touches nothing');
  controller.setPreset('moonrise');
  for (let i = 0; i < 40; i += 1) controller.update(0.1);
  const settled = applied.length;
  assert.ok(settled > 10);
  assert.equal(applied.at(-1).directionalIntensity, resolveSkyLook(SKY, 'moonrise').directionalIntensity);
  assert.equal(controller.night, true);
  assert.equal(controller.update(0.1), false, 'settled');
  assert.equal(applied.length, settled);
  controller.setOvercast(1);
  for (let i = 0; i < 60; i += 1) controller.update(0.1);
  assert.equal(controller.overcast, 1);
  assert.ok(applied.at(-1).directionalIntensity < resolveSkyLook(SKY, 'moonrise').directionalIntensity);

  const restored = new SkyLookController({ skyView, preset: 'emberfall' });
  assert.equal(restored.update(0), true, 'a stored preset is shown on the first frame');
});

test('unlit water keeps its authored colours under the configured look and dims at night', async () => {
  const { skyLightFor } = await import('../src/editor/stylized/sky/skyLight.js');
  const configured = resolveSkyLook(SKY, 'configured');
  const same = skyLightFor(configured, configured);
  assert.equal(same.brightness, 1);
  for (const channel of same.tint) assert.ok(Math.abs(channel - 1) < 1e-9);
  const night = skyLightFor(resolveSkyLook(SKY, 'moonrise'), configured);
  assert.ok(night.brightness < 0.4);
  assert.ok(night.tint.every((channel) => channel < 1));
});

test('changing preset mid-transition carries on from the look on screen', () => {
  const applied = [];
  const skyView = { config: { sky: SKY }, applyLook: (look) => applied.push(look) };
  const controller = new SkyLookController({ skyView });
  controller.setPreset('emberfall');
  // A fifth of the way: the eased mix is well behind the linear progress.
  controller.update(0.25);
  controller.update(0.25);
  const onScreen = applied.at(-1);
  controller.setPreset('moonrise');
  // The very first frame of the new transition starts where the old one was.
  controller.update(1e-6);
  const next = applied.at(-1);
  for (const key of ['sunElevation', 'directionalIntensity', 'ambientIntensity']) {
    assert.ok(Math.abs(next[key] - onScreen[key]) < 1e-3, `${key} jumped from ${onScreen[key]} to ${next[key]}`);
  }
});

test('the default look is applied on the first frame', () => {
  const applied = [];
  const skyView = { config: { sky: SKY }, applyLook: (look) => applied.push(look) };
  const controller = new SkyLookController({ skyView });
  assert.equal(controller.update(0.1), true);
  assert.equal(applied.at(-1).sunElevation, resolveSkyLook(SKY, 'meadow').sunElevation);
});

test('a preset chosen after a time blend replaces the blend, even with the same leading preset', () => {
  const skyView = { config: { sky: SKY }, applyLook: () => {} };
  const controller = new SkyLookController({ skyView, preset: 'configured' });
  controller.setTimeBlend({ emberfall: 0.6, moonrise: 0.4 });
  assert.equal(controller.preset, 'emberfall');
  controller.setPreset('emberfall');
  for (let i = 0; i < 40; i += 1) controller.update(0.1);
  assert.equal(controller.current.directionalIntensity, resolveSkyLook(SKY, 'emberfall').directionalIntensity);
});
