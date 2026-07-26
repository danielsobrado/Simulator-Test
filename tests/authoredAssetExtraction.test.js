import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');

test('runtime natural assets never reference whole-scene extraction sources', async () => {
  const config = yaml.load(await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8'));
  const assets = config.stylizedSurface.assets;
  const runtimeScenes = [
    ...assets.rockVariants,
    ...assets.bushVariants,
    ...assets.treeVariants,
    ...assets.groundDetailVariants,
    ...assets.aquaticVariants,
  ].map((variant) => variant.scene);
  const forbiddenSources = [
    'low_poly_tree_scene_free.glb',
    'low_poly_forest_tree_pack.glb',
    'stylized_tree.glb',
    'ruined_rock_fence.glb',
    'stylized_grass.glb',
    'weeds_and_grass.glb',
    'clover_grass.glb',
    'lotus.glb',
    'simple_grass_chunks.glb',
  ];

  for (const source of forbiddenSources) {
    assert.ok(
      runtimeScenes.every((scene) => !scene.endsWith(`/${source}`)),
      `${source} must remain an offline extraction source`,
    );
  }
});

test('extraction manifest covers the complete offline library and runtime subset', async () => {
  const manifest = JSON.parse(await readFile(
    path.join(ROOT, 'assets/extracted/manifest.json'),
    'utf8',
  ));
  const outputs = manifest.sources.flatMap((source) => source.outputs);
  const published = outputs.filter((output) => output.published);
  const wholeScene = manifest.sources.find((source) => source.key === 'low-poly-tree-scene');

  assert.equal(manifest.sources.length, 9);
  assert.equal(outputs.length, 86);
  assert.equal(published.length, 38);
  assert.equal(wholeScene.outputs.filter((output) => output.name.startsWith('tree-')).length, 23);
  assert.ok(outputs.every((output) => Math.abs(output.bounds.min[1]) < 0.0001));
});

test('every published ambient ground detail stays cheap enough to stream', async () => {
  // The measured rejection list: clover at 10 912 triangles and the 2 681-52 188
  // triangle ground patches cost roughly 87 FPS in chunk-cross when streamed as
  // ambient cover. This guards the boundary rather than the individual names.
  const manifest = JSON.parse(await readFile(
    path.join(ROOT, 'assets/extracted/manifest.json'),
    'utf8',
  ));
  const config = yaml.load(await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8'));
  const trianglesByScene = new Map(manifest.sources
    .flatMap((source) => source.outputs)
    .filter((output) => output.published)
    .map((output) => [
      `/${output.published.replace(/^public\//, '')}`,
      output.triangles,
    ]));

  for (const variant of config.stylizedSurface.assets.groundDetailVariants) {
    const triangles = trianglesByScene.get(variant.scene);
    assert.ok(triangles !== undefined, `${variant.scene} is not a published extraction`);
    assert.ok(
      triangles <= 350,
      `${variant.scene} streams ${triangles} triangles as ambient ground cover`,
    );
  }
});

test('the heavy rooted aquatic plants are confined to wetland', async () => {
  const config = yaml.load(await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8'));
  for (const variant of config.stylizedSurface.assets.aquaticVariants) {
    if (!variant.scene.includes('grass-plant-')) continue;
    // 4 975 and 6 145 triangles: heavier than every runtime tree but the oak.
    assert.deepEqual(variant.tileIds, [12], `${variant.scene} must stay wetland-only`);
  }
});
