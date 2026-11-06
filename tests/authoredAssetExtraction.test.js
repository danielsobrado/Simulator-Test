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

  // Ten sources: the tenth is grass-test's path pebbles, one file of four
  // (donor-rock-pebbles).
  assert.equal(manifest.sources.length, 10);
  assert.equal(outputs.length, 87);
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
  // Assets authored for the runtime directly (the Blender swamp understory) are
  // measured by the optimizer's own source stats instead.
  const runtime = JSON.parse(await readFile(path.join(ROOT, 'assets/runtime-asset-manifest.json'), 'utf8'));
  for (const asset of runtime.assets) {
    if (!trianglesByScene.has(asset.scene)) trianglesByScene.set(asset.scene, asset.sourceStats?.triangles);
  }

  for (const variant of config.stylizedSurface.assets.groundDetailVariants) {
    const triangles = trianglesByScene.get(variant.scene);
    assert.ok(triangles !== undefined, `${variant.scene} is neither a published extraction nor a runtime asset`);
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

test('biome understory kits differentiate all land biomes and regional character districts', async () => {
  const config = yaml.load(await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8'));
  const variants = config.stylizedSurface.assets.groundDetailVariants;
  const groundTileIds = new Set(config.stylizedSurface.groundDetails.tileIds);

  for (const requiredBiome of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 32]) {
    assert.ok(groundTileIds.has(requiredBiome), `groundDetails.tileIds must include biome ${requiredBiome}`);
    const matching = variants.filter((v) => Array.isArray(v.tileIds) && v.tileIds.includes(requiredBiome));
    assert.ok(matching.length >= 2, `biome ${requiredBiome} must have at least 2 dedicated understory variants`);
  }

  for (const kitDir of ['arid', 'meadow', 'forest', 'tropical', 'boreal', 'swamp', 'coastal', 'alpine', 'savanna', 'structures']) {
    const kitVariants = variants.filter((v) => v.scene.startsWith(`/assets/ground/${kitDir}/`));
    assert.ok(kitVariants.length >= 3, `understory kit ${kitDir} must publish at least 3 runtime variants`);
  }

  const bushVariants = config.stylizedSurface.assets.bushVariants;
  const authoredBiomeBushes = bushVariants.filter((b) => b.scene.startsWith('/assets/bushes/bush-'));
  assert.ok(authoredBiomeBushes.length >= 6, 'bushVariants must include at least 6 authored biome shrubs');

  const characters = new Set(variants.map((v) => v.character).filter(Boolean));
  for (const district of ['meadow', 'forest', 'scrub', 'rocky']) {
    assert.ok(characters.has(district), `regional district character '${district}' must be represented in groundDetailVariants`);
  }
});
