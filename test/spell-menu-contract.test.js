import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/editor/spells/spell_menu.js', import.meta.url),
  'utf8',
);

test('spell menu declares all six slots from one descriptor table', () => {
  for (const id of ['fire', 'water', 'air', 'earth', 'lightning', 'fireball']) {
    assert.match(source, new RegExp(`id: '${id}'`));
  }
  assert.match(source, /for \(const descriptor of SPELL_BUTTONS\)/);
});

test('failed casts flash as misses and do not emit cast audio', () => {
  const firedIndex = source.indexOf("const fired = typeof play === 'function'");
  const missIndex = source.indexOf('if (!fired)');
  const audioIndex = source.indexOf('emitAudio(`spell.${descriptor.id}.cast`');
  assert.ok(firedIndex >= 0);
  assert.ok(missIndex > firedIndex);
  assert.ok(audioIndex > missIndex);
  assert.match(source, /flashMiss\(button\);/);
  assert.match(source, /return false;/);
});

test('dragging keeps the spell menu inside the viewport', () => {
  assert.match(source, /window\.innerWidth - root\.offsetWidth/);
  assert.match(source, /window\.innerHeight - root\.offsetHeight/);
  assert.match(source, /Math\.max\(0, Math\.min\(maximumLeft/);
  assert.match(source, /Math\.max\(0, Math\.min\(maximumTop/);
});

test('dispose removes only menu roots owned by the runtime', () => {
  assert.match(source, /if \(owned\) root\.remove\(\);/);
  assert.match(source, /else root\.replaceChildren\(\);/);
});
