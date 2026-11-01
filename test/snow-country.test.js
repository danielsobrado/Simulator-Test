import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import { snowCountryWeight } from '../src/editor/stylized/sky/SnowCountryWeight.js';
import { snowCountryLook } from '../src/editor/stylized/sky/snowCountryLook.js';
import { resolveSkyLook } from '../src/editor/stylized/sky/SkyLook.js';
import { SkyLookController } from '../src/editor/stylized/sky/SkyLookController.js';
import { sampleTilesAround, tileShare } from '../src/editor/world/sampleTilesAround.js';

const SKY = {
  lowColor: '#9cc9e2', highColor: '#3f83c2', sunColor: '#fff4dc', sunGlowColor: '#ffd7a6',
  cloudCore: '#b8c6d2', cloudEdge: '#f7fbff', cloudRim: '#fff3dc', fogColor: '#9cc9e2',
  groundLightColor: '#6f784d', directionalColor: '#fff3dc',
  sunElevation: 10, sunAzimuth: 258, sunEmission: 1.4, sunGlowIntensity: 0.45,
  cloudOpacity: 0.62, cloudDensity: 0.56, ambientIntensity: 2, directionalIntensity: 3,
};
const BAND = { snowLine: 700, snowFade: 250 };

test('snow country comes from snowy biomes or height, whichever is more', () => {
  assert.equal(snowCountryWeight({ tiles: [4, 4], groundHeight: 100, ...BAND }), 0);
  assert.equal(snowCountryWeight({ tiles: [11, 11], groundHeight: 100, ...BAND }), 1);
  assert.equal(snowCountryWeight({ tiles: [10, 10], groundHeight: 100, ...BAND }), 0.6, 'tundra is partly snowy');
  assert.equal(snowCountryWeight({ tiles: [9, 9], groundHeight: 1000, ...BAND }), 1, 'a high taiga ridge is snow country');
  assert.equal(snowCountryWeight({ tiles: [9], groundHeight: 700, ...BAND }), 0.5);
  assert.equal(snowCountryWeight({ tiles: [], groundHeight: Number.NaN, ...BAND }), 0);
});

function luminance(hex) {
  const color = new THREE.Color(hex);
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

test('snow air cools the look relative to it, so night stays night', () => {
  const day = { ...resolveSkyLook(SKY, 'configured'), sunElevation: 45 };
  assert.equal(snowCountryLook(day, 0), day);
  const alpine = snowCountryLook(day, 1);
  const fog = new THREE.Color(alpine.fogColor);
  const dayFog = new THREE.Color(day.fogColor);
  const saturation = (color) => Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  assert.ok(saturation(fog) < saturation(dayFog), 'the haze pales');
  assert.ok(fog.b > fog.r, 'and stays cool');
  assert.ok(alpine.ambientIntensity > day.ambientIntensity, 'light bounces off the snow');
  assert.ok(alpine.fogDensityScale > day.fogDensityScale);

  const night = resolveSkyLook(SKY, 'moonrise');
  const moonlitSummit = snowCountryLook(night, 1);
  assert.equal(moonlitSummit.night, true);
  assert.ok(luminance(moonlitSummit.highColor) < 0.05, 'the night sky stays dark');
  assert.ok(Math.abs(luminance(moonlitSummit.lowColor) - luminance(night.lowColor)) < 0.05);
});

test('the controller eases into snow country and back', () => {
  const applied = [];
  const controller = new SkyLookController({ skyView: { config: { sky: SKY }, applyLook: (look) => applied.push(look) } });
  controller.setSnowCountry(1);
  for (let frame = 0; frame < 20; frame += 1) controller.update(0.1);
  assert.ok(controller.snowCountry > 0.25 && controller.snowCountry < 0.35, 'a few seconds, not a cut');
  for (let frame = 0; frame < 80; frame += 1) controller.update(0.1);
  assert.equal(controller.snowCountry, 1);
  const settled = applied.length;
  controller.update(0.1);
  assert.equal(applied.length, settled, 'settled air writes nothing');
});

test('tiles are sampled on rings, canonical z running opposite to cell z', () => {
  const seen = [];
  const tiles = sampleTilesAround({
    getTile: (cellX, cellZ) => { seen.push([cellX, cellZ]); return cellX === 5 && cellZ === -3 ? 11 : 4; },
    tileSize: 2,
    x: 10,
    z: 6,
    rings: [0, 4],
    directions: 4,
  });
  assert.equal(tiles.length, 5);
  assert.deepEqual(seen[0], [5, -3]);
  assert.equal(tiles[0], 11);
  assert.equal(tileShare(tiles, [11]), 0.2);
});

test('snow country listens to the ground underfoot and ignores open water', () => {
  const band = { groundHeight: 100, snowLine: 700, snowFade: 250 };
  const byTile = { 9: 0.4, 6: 0 };
  // Centre taiga, near ring half lake, far ring deciduous wood.
  const tiles = [9, 9, 9, 9, 9, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6, 6, 6];
  const weights = [4, 1, 1, 1, 1, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
  const equal = snowCountryWeight({ tiles, ...band, byTile });
  const weighted = snowCountryWeight({ tiles, weights, ...band, byTile });
  assert.ok(weighted > 0.25 && weighted > equal * 1.5, `${weighted} vs ${equal}`);
  assert.equal(snowCountryWeight({ tiles: [0, 0], ...band, byTile }), 0, 'open water alone is not snow country');
  assert.equal(snowCountryWeight({ tiles: [10, 0], ...BAND, groundHeight: 100 }), 0.6, 'a tundra lake shore is tundra');
});

test('a low sun keeps its warm sky over snow and only half the stop-down', () => {
  const golden = { ...resolveSkyLook(SKY, 'configured'), sunElevation: 7 };
  const alpine = snowCountryLook(golden, 1);
  assert.equal(alpine.lowColor, golden.lowColor);
  assert.equal(alpine.highColor, golden.highColor);
  assert.ok(Math.abs(alpine.exposure - (golden.exposure ?? 1) * 0.87) < 1e-9);
});

test('a daylit snow-country sky turns pale, not merely tinted', () => {
  const day = { ...resolveSkyLook(SKY, 'configured'), sunElevation: 45 };
  const alpine = snowCountryLook(day, 1);
  const zenith = new THREE.Color(alpine.highColor);
  const summer = new THREE.Color(day.highColor);
  const saturation = (color) => (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b))
    / Math.max(color.r, color.g, color.b);
  assert.ok(luminance(alpine.highColor) > luminance(day.highColor) * 1.6, 'the zenith lifts');
  assert.ok(saturation(zenith) < saturation(summer), 'and loses its summer saturation');
  assert.ok(zenith.b > zenith.r, 'while staying blue');
});
