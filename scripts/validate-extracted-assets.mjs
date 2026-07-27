import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHORED_ASSET_EXTRACTIONS } from './authored-asset-extraction.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'assets/extracted/manifest.json');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readGlbChunks(bytes, filePath) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${filePath} is not a complete GLB 2.0 file.`);
  }
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(body.toString('utf8'));
    if (type === 0x004e4942) binary = body;
    offset += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error(`${filePath} contains no GLB JSON document.`);
  return { json, binary };
}

function readGlbJson(bytes, filePath) {
  return readGlbChunks(bytes, filePath).json;
}

const IMAGE_MAGIC = Object.freeze({
  'image/webp': (image) => image.length > 12
    && image.toString('ascii', 0, 4) === 'RIFF'
    && image.toString('ascii', 8, 12) === 'WEBP',
  'image/png': (image) => image.length > 8
    && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (image) => image.length > 2 && image[0] === 0xff && image[1] === 0xd8,
});

/**
 * Every embedded image must be the format it declares. Texture data copied
 * between glTF documents can end up viewing the wrong slice of the source
 * binary, producing a GLB that writes, hashes and loads correctly but holds
 * geometry bytes where an image should be. Nothing else in the pipeline notices
 * until something tries to decode it, so it is checked here.
 */
function validateEmbeddedImages(json, binary, relativePath) {
  for (const [index, image] of (json.images ?? []).entries()) {
    const check = IMAGE_MAGIC[image.mimeType];
    if (!check || image.bufferView === undefined) continue;
    const view = json.bufferViews?.[image.bufferView];
    if (!view || !binary) {
      throw new Error(`${relativePath} image ${index} has no readable buffer view.`);
    }
    const start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    if (!check(bytes)) {
      throw new Error(
        `${relativePath} image ${index} declares ${image.mimeType} but begins `
        + `${bytes.subarray(0, 12).toString('hex')}; re-run extraction.`,
      );
    }
  }
}

function validateFile(relativePath, expectedHash, expectedBytes, expectedName) {
  const filePath = path.resolve(rootDir, relativePath);
  if (!filePath.startsWith(`${rootDir}${path.sep}`) || !fs.existsSync(filePath)) {
    throw new Error(`Missing extracted asset ${relativePath}.`);
  }
  const bytes = fs.readFileSync(filePath);
  if (bytes.length !== expectedBytes || hash(bytes) !== expectedHash) {
    throw new Error(`${relativePath} does not match the extraction manifest.`);
  }
  const { json, binary } = readGlbChunks(bytes, relativePath);
  if (json.asset?.extras?.extractedAsset !== expectedName
      || !Array.isArray(json.asset?.extras?.extractedRoots)
      || (json.scenes?.length ?? 0) !== 1) {
    throw new Error(`${relativePath} is missing extraction provenance or its single scene.`);
  }
  validateEmbeddedImages(json, binary, relativePath);
  return json;
}

/** Triangles bound to each material name in a parsed GLB document. */
function trianglesByMaterial(json) {
  const totals = new Map();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const name = json.materials?.[primitive.material]?.name ?? '<none>';
      const accessor = primitive.indices ?? primitive.attributes?.POSITION;
      const count = (json.accessors?.[accessor]?.count ?? 0) / 3;
      totals.set(name, (totals.get(name) ?? 0) + count);
    }
  }
  return totals;
}

// `simplifyRatio` is one number applied to every primitive, but primitives do not
// respond to it equally. Independent cards (leaf quads, alpha fronds) track it
// exactly, because the simplifier just deletes whole cards. Open-ended tube
// geometry — branches, stems — is border edges all the way down, and meshopt will
// not collapse a border, so it floors well above the target however low the ratio
// goes.
//
// Set aggressively enough, that asymmetry strips one part to nothing while leaving
// the other almost untouched. `stylized-oak` shipped that way: 5% of its leaf cards
// against 49% of its branches, which rendered as a bare skeleton with a few specks.
// Nothing else caught it, because every file was individually well-formed.
//
// Only simplified outputs are checked. Plenty of authored assets are lopsided by
// design — `lotus-01` carries a 9 120-triangle bloom beside a 52-triangle leaf tag
// at 175:1 — and that is not a defect, it is just how the artist built it.
const SIMPLIFY_DIVERGENCE_LIMIT = 6;

function validateSimplifyBalance(json, relativePath, simplifyRatio) {
  if (simplifyRatio === undefined) return;
  const totals = [...trianglesByMaterial(json).entries()].filter(([, count]) => count > 0);
  if (totals.length < 2) return;
  const counts = totals.map(([, count]) => count);
  const ratio = Math.max(...counts) / Math.min(...counts);
  if (ratio <= SIMPLIFY_DIVERGENCE_LIMIT) return;
  const summary = totals
    .map(([name, count]) => `${name}=${Math.round(count)}`)
    .join(', ');
  throw new Error(
    `${relativePath} is simplified at ratio ${simplifyRatio} and its materials came out `
    + `wildly uneven (${summary}; ${ratio.toFixed(1)}:1 against a ${SIMPLIFY_DIVERGENCE_LIMIT}:1 `
    + 'limit). One part has almost certainly been decimated away while another kept its '
    + 'triangles — see the stylized-oak notes in authored-asset-extraction.config.mjs.',
  );
}

if (!fs.existsSync(manifestPath)) {
  throw new Error('Missing assets/extracted/manifest.json; run npm run extract:authored-assets.');
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedKeys = AUTHORED_ASSET_EXTRACTIONS.map((definition) => definition.key);
const actualKeys = manifest.sources?.map((source) => source.key) ?? [];
if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
  throw new Error('The extraction manifest does not cover the configured source packs in order.');
}

let outputCount = 0;
let publishedCount = 0;
for (const source of manifest.sources) {
  const sourcePath = path.resolve(rootDir, source.input);
  const sourceBytes = fs.readFileSync(sourcePath);
  if (sourceBytes.length !== source.bytes || hash(sourceBytes) !== source.sha256) {
    throw new Error(`${source.input} changed; regenerate its individual assets.`);
  }
  if (!Array.isArray(source.outputs) || source.outputs.length === 0) {
    throw new Error(`${source.input} has no extracted outputs.`);
  }
  for (const output of source.outputs) {
    if (Math.abs(output.bounds?.min?.[1] ?? Number.POSITIVE_INFINITY) > 0.0001) {
      throw new Error(`${output.output} is not grounded at y=0.`);
    }
    const json = validateFile(output.output, output.sha256, output.bytes, output.name);
    validateSimplifyBalance(json, output.output, output.simplifyRatio);
    outputCount += 1;
    if (output.published) {
      publishedCount += 1;
    }
  }
}

console.log(
  `validated ${outputCount} individual authored assets; ${publishedCount} runtime selections`,
);
