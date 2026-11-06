import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { treeImpostorBakeConfiguration } from '../../src/editor/stylized/impostor/TreeImpostorManifest.js';

const SOURCES = [
  'src/editor/stylized/StylizedTreeMaterials.js',
  'src/editor/stylized/StylizedTreeView.js',
  'src/editor/stylized/StylizedTreePrototypes.js',
  'src/editor/stylized/StylizedPrototypeBake.js',
  'src/editor/stylized/AuthoredTextureNode.js',
  'src/editor/stylized/AuthoredFoliageMaterial.js',
  'src/editor/stylized/forest/canopyGrade.js',
  'src/editor/stylized/forest/barkGrade.js',
  'src/editor/stylized/forest/TreeBarkMaterial.js',
  'src/editor/stylized/forest/TreeSurfaceMaterial.js',
  'src/editor/stylized/forest/crownEdge.js',
  'src/editor/stylized/forest/ForestSpeciesGeometry.js',
  'src/editor/stylized/forest/ProceduralBarkTextures.js',
  'src/editor/stylized/barkWeathering.js',
  'src/editor/stylized/impostor/TreeImpostorBaker.js',
  'src/editor/stylized/impostor/TreeImpostorAtlasPixels.js',
  'src/editor/stylized/impostor/TreeImpostorSupersample.js',
  'src/editor/stylized/impostor/TreeImpostorNormalEncoding.js',
  'src/editor/stylized/impostor/impostorFrame.js',
];
const hash = value => createHash('sha256').update(value).digest('hex');

/** Offline provenance guards source edits even when geometry counts stay equal. */
export async function treeImpostorSourceInputs(root = process.cwd(), sourceFiles = SOURCES) {
  const config = yaml.load(await readFile(path.join(root, 'editor.config.yaml'), 'utf8')).stylizedSurface;
  const assets = config.assets;
  const assetPaths = [assets.scene, assets.barkColor, assets.barkAo, assets.barkHeight,
    ...(config.trees.cardsPerLobe > 0 ? [assets.foliageCard] : []),
    ...(assets.treeVariants ?? []).map(value => value.scene)].filter(Boolean);
  const files = [...new Set([...sourceFiles, ...assetPaths.map(value => `public/${value.replace(/^\//, '')}`)])].sort();
  return {
    version: 1,
    configuration: hash(JSON.stringify(treeImpostorBakeConfiguration(config))),
    files: Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(path.join(root, file)))]))),
  };
}

export async function validateTreeImpostorSourceInputs(manifest, root = process.cwd(), sourceFiles = SOURCES) {
  const expected = manifest.sourceInputs;
  if (!expected || expected.version !== 1) throw new Error('Tree impostors have no source provenance. Run npm run bake:impostors.');
  const current = await treeImpostorSourceInputs(root, sourceFiles);
  if (current.configuration !== expected.configuration) throw new Error('Tree impostor bake configuration changed. Run npm run bake:impostors.');
  for (const [file, digest] of Object.entries(current.files)) {
    if (expected.files?.[file] !== digest) throw new Error(`Tree impostor source changed: ${file}. Run npm run bake:impostors.`);
  }
}
