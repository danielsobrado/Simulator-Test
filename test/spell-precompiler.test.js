import assert from 'node:assert/strict';
import test from 'node:test';
import { precompileSpellObjects } from '../src/editor/spells/spell_precompiler.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

test('spell precompiler keeps hidden spell objects visible until WebGPU compilation completes', async () => {
  const compilation = deferred();
  const spell = { name: 'fire-spell', visible: false };
  const unrelated = { name: 'terrain', visible: false };
  const scene = { children: [spell, unrelated] };
  const camera = {};
  let compileArguments = null;
  const renderer = {
    compileAsync(compiledScene, compiledCamera) {
      compileArguments = [compiledScene, compiledCamera];
      return compilation.promise;
    },
  };

  const resultPromise = precompileSpellObjects(renderer, scene, camera);

  assert.deepEqual(compileArguments, [scene, camera]);
  assert.equal(spell.visible, true);
  assert.equal(unrelated.visible, false);

  compilation.resolve();
  assert.equal(await resultPromise, true);
  assert.equal(spell.visible, false);
});

test('spell precompiler restores visibility and reports asynchronous compilation failure', async () => {
  const spell = { name: 'water-spell', visible: false };
  const renderer = {
    compileAsync() {
      return Promise.reject(new Error('pipeline rejected'));
    },
  };

  const warnings = [];
  const result = await precompileSpellObjects(
    renderer,
    { children: [spell] },
    {},
    { warn: (message) => warnings.push(message) },
  );

  assert.equal(result, false);
  assert.equal(spell.visible, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /pipeline rejected/);
});
