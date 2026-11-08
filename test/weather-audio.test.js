import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import {
  GustTrigger, shelterMuffle, stormBedWeights, thunderVoice,
} from '../src/editor/audio/weather_audio_mix.js';
import { soundscapeWeights } from '../src/editor/audio/soundscape_weights.js';
import { insideBuilding, roofedShare } from '../src/editor/audio/settlement_shelter.js';
import { WeatherSoundscape } from '../src/editor/audio/weather_soundscape.js';
import { SampleBank } from '../src/editor/audio/sample_bank.js';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);

test('storm beds come in with the storm and are silent at clear', () => {
  assert.deepEqual(stormBedWeights({ rain: 0, snow: 0, wind: 0.25 }), { rainStorm: 0, rainRoof: 0, windStrong: 0, blizzard: 0 });
  const moderate = stormBedWeights({ rain: 0.5, snow: 0, wind: 0.5 });
  assert.equal(moderate.rainStorm, 0, 'torrential rain only at the top of the storm');
  assert.equal(moderate.windStrong, 0);
  const full = stormBedWeights({ rain: 1, snow: 0, wind: 1 });
  assert.equal(full.rainStorm, 1);
  assert.equal(full.windStrong, 1);
  assert.equal(full.blizzard, 0, 'a rain storm does not howl like a blizzard');
  near(stormBedWeights({ rain: 0, snow: 0, wind: 0.7 }).windStrong, 0.5, 1e-9, 'strong wind midway');
  assert.equal(stormBedWeights({ rain: 0, snow: 1, wind: 1 }).blizzard, 1);
  assert.equal(stormBedWeights({ rain: 0, snow: 1, wind: 0.6 }).blizzard, 0);
  // Rising wind and rain only ever raise the beds.
  let previous = stormBedWeights({ rain: 0, snow: 0, wind: 0 });
  for (let level = 0.05; level <= 1; level += 0.05) {
    const next = stormBedWeights({ rain: level, snow: 0, wind: level });
    for (const key of Object.keys(next)) assert.ok(next[key] >= previous[key] - 1e-12, `${key} at ${level}`);
    previous = next;
  }
});

test('under a roof the roof rain replaces the ground rain', () => {
  const open = stormBedWeights({ rain: 1, snow: 0, wind: 1 }, 0);
  const roofed = stormBedWeights({ rain: 1, snow: 0, wind: 1 }, 1);
  assert.equal(open.rainRoof, 0);
  assert.equal(roofed.rainRoof, 1);
  assert.equal(roofed.rainStorm, 0);
});

test('shelter muffles the weather sub-bus', () => {
  assert.deepEqual(shelterMuffle(0, 0), { cutoff: 18000, gain: 1 });
  const roof = shelterMuffle(1, 0);
  near(roof.cutoff, 900, 1e-6, 'roof cutoff');
  near(20 * Math.log10(roof.gain), -8, 1e-9, 'roof gain dB');
  const canopy = shelterMuffle(0, 1);
  near(canopy.cutoff, 4000, 1e-6, 'canopy cutoff');
  assert.equal(canopy.gain, 1, 'trees only dull the sound');
  assert.ok(shelterMuffle(0.5, 0).cutoff < 18000 && shelterMuffle(0.5, 0).cutoff > 900);
});

test('thunder is delayed, quietened and darkened by distance', () => {
  near(thunderVoice(3000).delay, 3000 / 343, 1e-9, '3 km delay');
  near(thunderVoice(343).delay, 1, 1e-9, '343 m delay');
  assert.equal(thunderVoice(0).gain, 1);
  near(thunderVoice(600).gain, 0.5, 1e-9, 'half loudness at 600 m');
  assert.equal(thunderVoice(8000).gain, 0.08, 'far thunder is clamped, never silent');
  assert.equal(thunderVoice(300).cutoff, 8000);
  assert.equal(thunderVoice(100).cutoff, 8000);
  near(thunderVoice(4000).cutoff, 250, 1e-6, '4 km cutoff');
  assert.equal(thunderVoice(8000).cutoff, 250);
  near(thunderVoice(Math.sqrt(300 * 4000)).cutoff, Math.sqrt(8000 * 250), 1e-6, 'log midpoint');
  assert.equal(thunderVoice(799).near, true);
  assert.equal(thunderVoice(800).near, false);
});

test('gust swells fire on the rise and re-arm after the lull', () => {
  const trigger = new GustTrigger({ fire: 0.55, rearm: 0.35, minSeconds: 2.5 });
  assert.equal(trigger.update(0.6, 0.1), true);
  assert.equal(trigger.update(0.7, 5), false, 'one swell per gust');
  assert.equal(trigger.update(0.2, 0.1), false);
  assert.equal(trigger.update(0.6, 0.1), true);
  assert.equal(trigger.update(0.1, 0.1), false);
  assert.equal(trigger.update(0.6, 0.1), false, 'too soon after the last');
});

test('a blizzard or a gale silences the birds too', () => {
  const day = { tiles: [4, 4, 6, 6], heightAboveSea: 50, rain: 0, wind: 0.3, night: false, underwater: false };
  assert.ok(soundscapeWeights(day).birds > 0.3);
  assert.equal(soundscapeWeights({ ...day, snow: 1 }).birds, 0);
  assert.equal(soundscapeWeights({ ...day, wind: 1.5 }).birds, 0);
  assert.equal(soundscapeWeights({ ...day, tiles: [6, 6] }).canopy, 1);
});

test('a probe inside a house footprint is roofed, one outside is not', () => {
  // A 6 × 4 m house turned 30°: four walls around (10, 20), 3 m tall.
  const rotationY = Math.PI / 6;
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  const toWorld = (lx, lz) => [10 + lx * cos + lz * sin, 20 - lx * sin + lz * cos];
  const wall = (lx, lz, width, depth, part) => {
    const [x, z] = toWorld(lx, lz);
    return { sourceId: `settlement:town-1:b3.${part}`, position: [x, 1.5, z], rotationY, dimensions: [width, 3, depth] };
  };
  const parts = [wall(0, -2, 6, 0.3, 0), wall(0, 2, 6, 0.3, 1), wall(-3, 0, 0.3, 4, 2), wall(3, 0, 0.3, 4, 3)];
  assert.equal(insideBuilding(parts, 10, 1.7, 20), true);
  const [cornerX, cornerZ] = toWorld(2.8, 1.8);
  assert.equal(insideBuilding(parts, cornerX, 1.7, cornerZ), true, 'in the turned corner');
  const [outX, outZ] = toWorld(3.6, 0);
  assert.equal(insideBuilding(parts, outX, 1.7, outZ), false);
  assert.equal(insideBuilding(parts, 10, 9, 20), false, 'far above the roof');
  const world = { collectCandidates: (aabb, layers, out) => { out.length = 0; out.push(...parts, { sourceId: 'tree:1', position: [10, 0, 20], dimensions: [1, 1, 1] }); return out; } };
  assert.equal(roofedShare(world, { x: 10, y: 1.7, z: 20, yaw: 0 }), 1);
  assert.equal(roofedShare(world, { x: 40, y: 1.7, z: 20, yaw: 0 }), 0);
  assert.equal(roofedShare({ collectCandidates: (a, l, out) => out }, { x: 10, y: 1.7, z: 20, yaw: 0 }), 0);
});

function fakeAudio() {
  const param = (value) => ({ value });
  const node = () => ({ connect() {}, disconnect() {} });
  const started = [];
  const context = {
    currentTime: 100,
    createGain: () => ({ ...node(), gain: param(1) }),
    createStereoPanner: () => ({ ...node(), pan: param(0) }),
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(350), Q: param(1) }),
    createBufferSource: () => ({ ...node(), playbackRate: param(1), start(when = 0) { this.when = when; started.push(this); }, stop() {} }),
    decodeAudioData: async () => ({ duration: 10 }),
  };
  return { context, started };
}

test('the weather sub-bus ramps the storm beds and schedules thunder', async () => {
  const { context, started } = fakeAudio();
  const loaded = [];
  const bank = new SampleBank({ getContext: () => context, getDestination: () => ({}), fetchBytes: async (url) => { loaded.push(url); return new ArrayBuffer(8); } });
  const weather = new WeatherSoundscape({ bank, getContext: () => context, getDestination: () => ({ connect() {} }), random: () => 0.5 });
  const listener = { x: 0, z: 0, yaw: 0 };
  const clear = { rain: 0, snow: 0, wind: 0.25, lightning: 0 };
  const weights = soundscapeWeights({ tiles: [4], heightAboveSea: 50, rain: 0, wind: 0.25, night: false, underwater: false });
  for (let frame = 0; frame < 20; frame += 1) weather.update(0.1, { weights, storm: clear, listener });
  assert.equal(weather.beds.size, 0, 'a clear sky starts no loops');
  assert.equal(loaded.length, 0, 'and loads nothing');

  const storm = { rain: 1, snow: 0, wind: 1, lightning: 1 };
  const stormWeights = soundscapeWeights({ tiles: [4], heightAboveSea: 50, rain: 1, wind: 1, night: false, underwater: false });
  weather.update(0.1, { weights: stormWeights, storm, listener });
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let frame = 0; frame < 100; frame += 1) weather.update(0.1, { weights: stormWeights, storm, listener });
  near(weather.beds.get('rainStorm').gain.gain.value, 0.55, 0.01, 'storm rain');
  near(weather.beds.get('windStrong').gain.gain.value, 0.45, 0.01, 'strong wind');
  assert.ok(loaded.some((url) => url.includes('storm/thunder-far-01.mp3')), 'thunder streams in with the storm');

  weather.update(0.1, { weights: stormWeights, storm, listener, roofed: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let frame = 0; frame < 30; frame += 1) weather.update(0.1, { weights: stormWeights, storm, listener, roofed: 1 });
  near(weather.filter.frequency.value, 900, 5, 'roofed lowpass');
  near(weather.beds.get('rainRoof').gain.gain.value, 0.5, 0.02, 'roof rain');
  assert.ok(weather.beds.get('rainStorm').gain.gain.value < 0.05, 'ground storm rain gives way');

  const before = started.length;
  weather.strike({ bearing: 0, distance: 3430 });
  const thunder = started.at(-1);
  assert.equal(started.length, before + 1);
  near(thunder.when, 110, 1e-9, 'heard 10 s after the flash');
});

test('every storm sample the soundscape names is in the bank and the catalog', () => {
  const catalog = readFileSync('public/audio/cc0/CATALOG.md', 'utf8');
  const source = readFileSync('src/editor/audio/weather_soundscape.js', 'utf8');
  const named = [...source.matchAll(/'storm\/([a-z-]+\.mp3)'/g)].map((match) => match[1]);
  const numbered = [...source.matchAll(/numbered\('([a-z-]+)', (\d+)\)/g)]
    .flatMap(([, stem, count]) => Array.from({ length: Number(count) }, (_, i) => `${stem}-${String(i + 1).padStart(2, '0')}.mp3`));
  const files = [...named, ...numbered];
  assert.ok(files.length >= 18);
  for (const file of files) {
    assert.ok(existsSync(`public/audio/cc0/storm/${file}`), `${file} on disk`);
    assert.match(catalog, new RegExp(`\`storm/${file}\`.*\\| (CC0|Public domain) \\|`), `${file} catalogued`);
  }
});
