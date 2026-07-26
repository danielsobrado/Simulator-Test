import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  copyToDocument,
  getBounds,
  simplify,
  textureCompress,
} from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { AUTHORED_ASSET_EXTRACTIONS } from './authored-asset-extraction.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onlyIndex = process.argv.indexOf('--only');
const onlyKey = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// Serialised deliberately. Encoding several textures at once intermittently
// produced GLBs whose image bufferView pointed at geometry bytes instead of the
// encoded image — three of 267 embedded images in one full run, each still
// declaring `image/webp`. The corruption is silent: the file writes, hashes and
// loads, and only fails later when something tries to decode the texture.
// `assertEmbeddedImagesDecodable` below is the guard; this is the fix.
sharp.concurrency(1);

const IMAGE_MAGIC = Object.freeze({
  'image/webp': (bytes) => bytes.length > 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP',
  'image/png': (bytes) => bytes.length > 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (bytes) => bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8,
});

/**
 * Every embedded image must actually be the format its mime type claims. A
 * mismatch means the write produced a GLB that publishes and hashes fine but
 * cannot be decoded downstream, which is far more expensive to diagnose there.
 */
class CorruptEmbeddedImageError extends Error {}

function assertEmbeddedImagesDecodable(document, label) {
  for (const texture of document.getRoot().listTextures()) {
    const mimeType = texture.getMimeType();
    const check = IMAGE_MAGIC[mimeType];
    if (!check) continue;
    const bytes = Buffer.from(texture.getImage() ?? []);
    if (!check(bytes)) {
      throw new CorruptEmbeddedImageError(
        `${label}: embedded ${mimeType} image is not ${mimeType} `
        + `(${bytes.byteLength} bytes beginning ${bytes.subarray(0, 12).toString('hex')}).`,
      );
    }
  }
}

function absolute(relativePath) {
  return path.resolve(rootDir, relativePath);
}

function slash(relativePath) {
  return relativePath.replaceAll('\\', '/');
}

function hashBytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function findUniqueNode(document, name, sourcePath) {
  const matches = document.getRoot().listNodes().filter((node) => node.getName() === name);
  if (matches.length !== 1) {
    throw new Error(
      `${sourcePath}: expected exactly one node named "${name}", found ${matches.length}.`,
    );
  }
  return matches[0];
}

function naturalName(prefix, index, count) {
  const digits = Math.max(2, String(count).length);
  return `${prefix}-${String(index + 1).padStart(digits, '0')}`;
}

function expandExports(document, definition) {
  const expanded = [];
  for (const entry of definition.exports) {
    if (!entry.eachChildOf) {
      expanded.push(entry);
      continue;
    }
    const parent = findUniqueNode(document, entry.eachChildOf, definition.input);
    const include = entry.include ? new RegExp(entry.include) : null;
    const exclude = entry.exclude ? new RegExp(entry.exclude) : null;
    const children = parent.listChildren().filter((node) => (
      (!include || include.test(node.getName()))
      && (!exclude || !exclude.test(node.getName()))
    ));
    if (children.length === 0) {
      throw new Error(
        `${definition.input}: selector below "${entry.eachChildOf}" matched no child nodes.`,
      );
    }
    children.forEach((node, index) => {
      expanded.push({
        name: naturalName(entry.prefix, index, children.length),
        roots: [node.getName()],
        scale: entry.scale,
        textureSize: entry.textureSize,
        simplifyRatio: entry.simplifyRatio,
        simplifyError: entry.simplifyError,
        publishDir: !entry.publishIndices || entry.publishIndices.includes(index)
          ? entry.publishDir
          : null,
      });
    });
  }
  const names = expanded.map((entry) => entry.name);
  if (new Set(names).size !== names.length) {
    throw new Error(`${definition.input}: extracted asset names must be unique.`);
  }
  return expanded;
}

function registerSourceExtensions(target, source) {
  for (const extension of source.getRoot().listExtensionsUsed()) {
    const targetExtension = target.createExtension(extension.constructor);
    if (extension.isRequired()) targetExtension.setRequired(true);
  }
}

function triangleCount(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const count = primitive.getIndices()?.getCount()
        ?? primitive.getAttribute('POSITION')?.getCount()
        ?? 0;
      const mode = primitive.getMode();
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
    }
  }
  return triangles;
}

function roundedVector(vector) {
  return vector.map((value) => Number(value.toFixed(6)));
}

async function extractOne(sourceDocument, definition, entry, sourceMetadata) {
  const selected = entry.roots.map(
    (name) => findUniqueNode(sourceDocument, name, definition.input),
  );
  const target = new Document();
  registerSourceExtensions(target, sourceDocument);
  const propertyMap = copyToDocument(target, sourceDocument, selected);
  // `copyToDocument` leaves the copied textures viewing the source document's
  // binary buffer. One source document serves every child of a pack, so
  // re-encoding one child's texture could change the bytes a later child was
  // still pointing at — which is how three of 267 embedded images came out as
  // geometry data declaring `image/webp`. Detaching each image onto its own
  // buffer makes each extraction independent of the others.
  for (const texture of target.getRoot().listTextures()) {
    const image = texture.getImage();
    if (image) texture.setImage(new Uint8Array(image));
  }
  const scene = target.createScene(entry.name);
  const wrapper = target.createNode(entry.name);
  scene.addChild(wrapper);

  for (const sourceNode of selected) {
    const targetNode = propertyMap.get(sourceNode);
    targetNode.setMatrix(sourceNode.getWorldMatrix());
    wrapper.addChild(targetNode);
  }

  // Decimation happens here, not in the runtime optimizer: that stage asserts
  // triangle parity between its input and output, deliberately, so that gltfpack
  // can never silently change what a configured asset looks like. Reducing an
  // asset is an authoring decision and belongs in this manifest.
  if (entry.simplifyRatio !== undefined) {
    if (!Number.isFinite(entry.simplifyRatio)
        || entry.simplifyRatio <= 0
        || entry.simplifyRatio >= 1) {
      throw new Error(
        `${definition.input}: ${entry.name} simplifyRatio must be within (0, 1).`,
      );
    }
    await MeshoptSimplifier.ready;
    await target.transform(simplify({
      simplifier: MeshoptSimplifier,
      ratio: entry.simplifyRatio,
      error: entry.simplifyError ?? 0.01,
    }));
  }

  const scale = Number(entry.scale ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`${definition.input}: ${entry.name} scale must be positive.`);
  }
  wrapper.setScale([scale, scale, scale]);
  const initialBounds = getBounds(scene);
  const values = [...initialBounds.min, ...initialBounds.max];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${definition.input}: ${entry.name} has invalid geometry bounds.`);
  }
  wrapper.setTranslation([
    -(initialBounds.min[0] + initialBounds.max[0]) * 0.5,
    -initialBounds.min[1],
    -(initialBounds.min[2] + initialBounds.max[2]) * 0.5,
  ]);
  const bounds = getBounds(scene);

  const asset = target.getRoot().getAsset();
  asset.generator = 'SimCity-DnD authored asset extractor';
  asset.extras = {
    ...(sourceMetadata ?? {}),
    extractedAsset: entry.name,
    extractedFrom: slash(definition.input),
    extractedRoots: entry.roots,
    normalizedScale: scale,
    ...(entry.simplifyRatio === undefined
      ? {}
      : { simplifyRatio: entry.simplifyRatio }),
  };

  // 1024 px suits a tree or a boulder. A 0.5 m grass tuft never resolves more
  // than a fraction of that on screen, and the KTX2 encoding the runtime
  // optimizer applies has a per-texture floor cost, so an oversized map turns a
  // 37-triangle weed into a megabyte of download.
  const textureSize = Number(entry.textureSize ?? 1024);
  if (!Number.isInteger(textureSize) || textureSize < 16 || textureSize > 4096) {
    throw new Error(`${definition.input}: ${entry.name} textureSize must be 16-4096.`);
  }
  if (target.getRoot().listTextures().length > 0) {
    await target.transform(textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [textureSize, textureSize],
      quality: 90,
      effort: 4,
    }));
    assertEmbeddedImagesDecodable(target, `${definition.input}: ${entry.name}`);
  }

  const bytes = await io.writeBinary(target);
  // Re-read what was actually serialised. The in-memory check above cannot see a
  // bufferView assembled with the wrong offset, which is how this corruption
  // presented, so the written bytes are the ones that have to be verified.
  assertEmbeddedImagesDecodable(
    await io.readBinary(bytes),
    `${definition.input}: ${entry.name} (written)`,
  );
  const outputRelative = slash(path.join(definition.outputDir, `${entry.name}.glb`));
  const outputPath = absolute(outputRelative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bytes);

  let publishedRelative = null;
  if (entry.publishDir) {
    publishedRelative = slash(path.join(entry.publishDir, `${entry.name}.glb`));
  }

  return {
    name: entry.name,
    roots: entry.roots,
    scale,
    output: outputRelative,
    published: publishedRelative,
    ...(entry.simplifyRatio === undefined
      ? {}
      : { simplifyRatio: entry.simplifyRatio }),
    sha256: hashBytes(bytes),
    bytes: bytes.byteLength,
    nodes: target.getRoot().listNodes().length,
    meshes: target.getRoot().listMeshes().length,
    materials: target.getRoot().listMaterials().length,
    textures: target.getRoot().listTextures().length,
    triangles: triangleCount(target),
    bounds: {
      min: roundedVector(bounds.min),
      max: roundedVector(bounds.max),
    },
  };
}

/**
 * `extractOne` rebuilds its target document from the source on every call, so a
 * failed attempt leaves nothing behind and a retry is a clean re-run.
 *
 * The texture encoder intermittently hands back another buffer's bytes under
 * sustained load — three of 267 embedded images in one full run, a different
 * three in the next, and never when the same pack is extracted in isolation.
 * `assertEmbeddedImagesDecodable` makes that deterministic to detect even though
 * it is not deterministic to reproduce, so the response is to redo the asset
 * rather than to publish it or to abort the whole library.
 */
async function extractOneVerified(sourceDocument, definition, entry, sourceMetadata) {
  const attempts = 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await extractOne(sourceDocument, definition, entry, sourceMetadata);
    } catch (error) {
      if (!(error instanceof CorruptEmbeddedImageError) || attempt >= attempts) throw error;
      console.warn(`  retrying ${entry.name} (attempt ${attempt + 1}): ${error.message}`);
    }
  }
}

async function main() {
  const definitions = onlyKey
    ? AUTHORED_ASSET_EXTRACTIONS.filter((definition) => definition.key === onlyKey)
    : AUTHORED_ASSET_EXTRACTIONS;
  if (onlyKey && definitions.length === 0) {
    throw new Error(`Unknown extraction source "${onlyKey}".`);
  }

  const manifest = {
    version: 1,
    generator: 'scripts/extract-authored-assets.mjs',
    sources: [],
  };
  let outputCount = 0;
  let publishedCount = 0;

  for (const definition of definitions) {
    const inputPath = absolute(definition.input);
    const inputBytes = fs.readFileSync(inputPath);
    const sourceDocument = await io.read(inputPath);
    const sourceAsset = sourceDocument.getRoot().getAsset();
    const entries = expandExports(sourceDocument, definition);
    const outputs = [];
    for (const entry of entries) {
      const output = await extractOneVerified(
        sourceDocument,
        definition,
        entry,
        sourceAsset.extras,
      );
      outputs.push(output);
      outputCount += 1;
      if (output.published) publishedCount += 1;
      console.log(
        `${definition.key}/${output.name}: ${output.meshes} meshes, `
        + `${output.triangles} triangles, ${(output.bytes / 1024).toFixed(1)} KiB`,
      );
    }
    manifest.sources.push({
      key: definition.key,
      input: slash(definition.input),
      sha256: hashBytes(inputBytes),
      bytes: inputBytes.byteLength,
      sourceAsset: sourceAsset.extras ?? {},
      outputs,
    });
  }

  const manifestPath = absolute('assets/extracted/manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `extracted ${outputCount} individual assets; ${publishedCount} selected for runtime`,
  );
}

await main();
