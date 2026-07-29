import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const runtimeSource = await readFile(
  new URL('../src/editor/spells/spell_runtime.js', import.meta.url),
  'utf8',
);

test('fireball collision uses the ray callback contract', () => {
  assert.match(
    runtimeSource,
    /raycastFireballTerrain:\s*\(ray\)\s*=>\s*\([\s\S]*deps\.raycastTerrain\?\.\(ray, fireballCollisionRange\(/,
  );
  assert.doesNotMatch(runtimeSource, /raycastFireballTerrain:\s*\(origin, direction, maxDistance\)/);
});

test('Earth commits gameplay before playing VFX at the same target', () => {
  assert.match(runtimeSource, /const result = target\.commitEarthEdit\?\.\(gameplay\);/);
  assert.match(runtimeSource, /if \(!result\?\.ok \|\| !result\.changed\) return false;/);
  assert.match(runtimeSource, /earthTargetOverride = \{ point: target\.point, normal: target\.normal \};/);
  assert.match(runtimeSource, /return vfx\.playEarth\(durationMs\) !== false;/);
});

test('all six spell slots route through one guarded cast API', () => {
  assert.match(runtimeSource, /const SPELL_IDS = Object\.freeze\(\['fire', 'water', 'air', 'earth', 'lightning', 'fireball'\]\);/);
  assert.match(runtimeSource, /const cast = \(spellId, durationMs\) => \{/);
  assert.match(runtimeSource, /disposed \|\| !isCastMode\(\) \|\| deps\.isInputBlocked\?\.\(\)/);
  assert.match(runtimeSource, /return \{\s*cast,\s*handleKeyDown,/);
});

test('casting and menu visibility stop while player mode is paused', () => {
  assert.match(runtimeSource, /viewState\?\.paused !== true/);
  assert.match(runtimeSource, /viewState\?\.awaitingSpawn !== true/);
  assert.match(runtimeSource, /deps\.subscribeViewMode\(\(state\) => \{/);
  assert.match(runtimeSource, /const visible = isCastMode\(\);/);
});

test('spell keyboard handling covers top-row and numpad digits', () => {
  assert.match(runtimeSource, /event\.code\.startsWith\('Digit'\)/);
  assert.match(runtimeSource, /event\.code\.startsWith\('Numpad'\)/);
  assert.match(runtimeSource, /const spellId = SPELL_IDS\[numericCode - 1\];/);
  assert.match(runtimeSource, /if \(!spellId\) return false;/);
  assert.match(runtimeSource, /export function attachSpellHotkeys/);
  assert.match(runtimeSource, /deps\.registerKeys !== false/);
});

test('composition root must attach spell hotkeys before the player swallows keys', async () => {
  const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /import \{ attachSpellHotkeys, createSpellRuntime \}/);
  assert.match(mainSource, /attachSpellHotkeys\(\(\) => spellKeyHandler\)/);
  assert.match(mainSource, /registerKeys:\s*false/);
  const attachIdx = mainSource.indexOf('attachSpellHotkeys(() => spellKeyHandler)');
  const playerIdx = mainSource.indexOf('playerController = new PlayerController');
  assert.ok(attachIdx >= 0 && playerIdx >= 0 && attachIdx < playerIdx);
});
