import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { load } from 'js-yaml';
import {
  defaultSpellConfig,
  parseSpellConfig,
} from '../src/editor/spells/spell_config.js';
import generatedDefaults from '../src/editor/spells/spells_yaml_defaults.json' with { type: 'json' };

test('generated spell defaults remain in sync with config/spells.yaml', async () => {
  const yaml = await readFile(
    new URL('../config/spells.yaml', import.meta.url),
    'utf8',
  );
  assert.deepEqual(generatedDefaults, load(yaml));
});

test('spell runtime reads the generated YAML configuration', () => {
  assert.equal(defaultSpellConfig.menu.rootId, 'spell-menu');
  assert.equal(defaultSpellConfig.fire.castDurationMs, 2600);
  assert.equal(defaultSpellConfig.lightning.vfx.segmentCount, 52);
  assert.equal(defaultSpellConfig.fireball.vfx.launchSpeed, 19);
});

test('spell parser applies YAML overrides without losing generated defaults', () => {
  const parsed = parseSpellConfig(`
spells:
  menu:
    title: Arcana
  fire:
    cast_duration_ms: 700
    audio:
      volume: 0.2
    vfx:
      glow_intensity: 4.5
`);

  assert.equal(parsed.menu.title, 'Arcana');
  assert.equal(parsed.fire.castDurationMs, 700);
  assert.equal(parsed.fire.audio.volume, 0.2);
  assert.equal(parsed.fire.vfx.glowIntensity, 4.5);
  assert.equal(parsed.fire.vfx.worldWidth, 1.6);
  assert.equal(parsed.fireball.vfx.projectileRadius, 0.42);
});

test('spell parser clamps unsafe tuning values', () => {
  const parsed = parseSpellConfig({
    spells: {
      lightning: {
        cast_duration_ms: 1,
        audio: { volume: 12 },
        vfx: {
          segment_count: 999,
          refresh_hz: 0,
          core_color: [2, -1, 0.5],
        },
      },
    },
  });

  assert.equal(parsed.lightning.castDurationMs, 250);
  assert.equal(parsed.lightning.audio.volume, 1);
  assert.equal(parsed.lightning.vfx.segmentCount, 128);
  assert.equal(parsed.lightning.vfx.refreshHz, 1);
  assert.deepEqual(parsed.lightning.vfx.coreColor, [1, 0, 0.5]);
});

test('invalid spell leaf values preserve generated defaults', () => {
  const parsed = parseSpellConfig({
    spells: {
      fire: {
        cast_duration_ms: 'not-a-duration',
        audio: { volume: 'not-a-volume' },
        vfx: {
          glow_color: ['not-a-color'],
          glow_intensity: 'not-an-intensity',
        },
      },
    },
  });

  assert.equal(parsed.fire.castDurationMs, defaultSpellConfig.fire.castDurationMs);
  assert.equal(parsed.fire.audio.volume, defaultSpellConfig.fire.audio.volume);
  assert.deepEqual(parsed.fire.vfx.glowColor, defaultSpellConfig.fire.vfx.glowColor);
  assert.equal(parsed.fire.vfx.glowIntensity, defaultSpellConfig.fire.vfx.glowIntensity);
});

test('malformed YAML falls back without preventing startup', () => {
  const parsed = parseSpellConfig('spells: [');
  assert.equal(parsed.fire.id, 'fire');
  assert.equal(parsed.earth.vfx.shardCount, 24);
});
