import assert from 'node:assert/strict';
import test from 'node:test';
import { loadOptionalTreeVariants } from '../src/editor/stylized/loadOptionalTreeVariants.js';

test('optional tree failures do not discard successfully loaded variants', async () => {
  const definitions = [
    { scene: '/trees/oak.glb', species: 'oak' },
    { scene: '/trees/missing.glb', species: 'pine' },
    { scene: '/trees/birch.glb', species: 'birch' },
  ];
  const loaded = [];
  const warnings = [];
  const variants = await loadOptionalTreeVariants({
    definitions,
    acquire: async (scene) => {
      if (scene.includes('missing')) throw new Error('HTTP 404');
      return { name: scene };
    },
    onLoaded: (scene) => loaded.push(scene),
    warn: (...args) => warnings.push(args),
  });

  assert.deepEqual(
    variants.map(({ definition }) => definition.scene),
    ['/trees/oak.glb', '/trees/birch.glb'],
  );
  assert.deepEqual(loaded, ['/trees/oak.glb', '/trees/birch.glb']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /missing\.glb/);
});

test('optional tree loading validates its acquisition dependency', async () => {
  await assert.rejects(
    loadOptionalTreeVariants({ definitions: [] }),
    /requires an acquire function/,
  );
});
