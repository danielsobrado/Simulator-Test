import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  metalRough,
  prune,
  resample,
  textureCompress,
} from '@gltf-transform/functions';
import sharp from 'sharp';
import { WILDLIFE_ASSETS } from './wildlife-assets.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'assets', 'extracted', 'wildlife-manifest.json');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function animationDuration(animation) {
  return animation.listSamplers().reduce((duration, sampler) => {
    const times = sampler.getInput()?.getArray();
    return Math.max(duration, times?.[times.length - 1] ?? 0);
  }, 0);
}

const manifest = {
  version: 1,
  generator: 'scripts/prepare-wildlife-assets.mjs',
  assets: [],
};

for (const definition of WILDLIFE_ASSETS) {
  const inputPath = path.join(rootDir, definition.input);
  const preparedPath = path.join(rootDir, definition.prepared);
  const inputBytes = fs.readFileSync(inputPath);
  const document = await io.read(inputPath);
  const root = document.getRoot();
  const selected = root.listAnimations().find(
    (animation) => animation.getName() === definition.clip,
  );
  if (!selected) {
    throw new Error(`${definition.input} does not contain animation "${definition.clip}".`);
  }
  for (const animation of root.listAnimations()) {
    if (animation !== selected) animation.dispose();
  }

  const sourceMetadata = root.getAsset().extras ?? {};
  root.getAsset().generator = 'SimCity-DnD wildlife asset preparer';
  root.getAsset().extras = {
    ...sourceMetadata,
    preparedFrom: definition.input.replaceAll('\\', '/'),
    runtimeSpecies: definition.id,
    runtimeClip: definition.clip,
  };

  await document.transform(
    metalRough(),
    resample({ tolerance: 1e-4 }),
    dedup(),
    prune(),
  );
  if (root.listTextures().length > 0) {
    await document.transform(textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [1024, 1024],
      quality: 90,
      effort: 4,
    }));
  }

  const outputBytes = await io.writeBinary(document);
  fs.mkdirSync(path.dirname(preparedPath), { recursive: true });
  fs.writeFileSync(preparedPath, outputBytes);
  manifest.assets.push({
    id: definition.id,
    input: definition.input,
    inputBytes: inputBytes.length,
    inputSha256: hash(inputBytes),
    prepared: definition.prepared,
    published: definition.published,
    preparedBytes: outputBytes.length,
    preparedSha256: hash(outputBytes),
    clip: definition.clip,
    duration: Number(animationDuration(selected).toFixed(6)),
    triangles: triangleCount(document),
    sourceAsset: sourceMetadata,
  });
  console.log(
    `${definition.id}: ${(inputBytes.length / 1048576).toFixed(2)} MiB -> `
    + `${(outputBytes.length / 1048576).toFixed(2)} MiB, `
    + `${root.listAnimations().length} clip, ${triangleCount(document)} triangles`,
  );
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
