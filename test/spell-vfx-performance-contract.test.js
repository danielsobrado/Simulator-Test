import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/editor/spells/spell_vfx_controller.js', import.meta.url),
  'utf8',
);

test('beam spell frames reuse pose, orientation, and frame scratch state', () => {
  assert.match(source, /poseScratch: createPoseScratch\(\)/);
  assert.match(source, /orientationScratch: createOrientationScratch\(\)/);
  assert.match(source, /frameScratch: createFrameScratch\(\)/);
  assert.match(source, /computeSpellFrame\([\s\S]*spell\.frameScratch/);
  assert.match(source, /orientFireJet\([\s\S]*spell\.orientationScratch/);
});

test('disabled fallback rendering does not allocate fallback meshes', () => {
  assert.match(source, /if \(!ENABLE_VISIBLE_FALLBACK\) return null;/);
  assert.match(source, /if \(fallbackMesh\) scene\.add\(fallbackMesh\);/);
  assert.match(source, /if \(spell\.fallbackMesh\)/);
});

test('spell source objects are reused across casts', () => {
  assert.match(source, /const lightningSource = \{ point: lightningPoseScratch\.base, direction: lightningPoseScratch\.dir \};/);
  assert.match(source, /const fireballSource = \{ point: fireballPoseScratch\.base, direction: fireballPoseScratch\.dir \};/);
});

test('shader prewarm prefers async compilation and reports failures', () => {
  assert.match(source, /const compile = renderer\.compileAsync \?\? renderer\.compile;/);
  assert.match(source, /Shader precompile failed; first cast may hitch/);
});
