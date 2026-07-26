import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WILDLIFE_ASSETS } from './wildlife-assets.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'assets', 'extracted', 'wildlife-manifest.json');

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readGlbJson(bytes, filePath) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${filePath} is not a complete GLB 2.0 file.`);
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(bytes.subarray(offset + 8, offset + 8 + length).toString('utf8'));
    }
    offset += 8 + length;
  }
  throw new Error(`${filePath} contains no GLB JSON document.`);
}

if (!fs.existsSync(manifestPath)) {
  throw new Error('Missing wildlife manifest; run npm run prepare:wildlife-assets.');
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedIds = WILDLIFE_ASSETS.map((asset) => asset.id);
if (JSON.stringify(manifest.assets?.map((asset) => asset.id)) !== JSON.stringify(expectedIds)) {
  throw new Error('Wildlife manifest does not match configured species.');
}

for (const [index, definition] of WILDLIFE_ASSETS.entries()) {
  const record = manifest.assets[index];
  for (const [relativePath, expectedBytes, expectedHash] of [
    [record.input, record.inputBytes, record.inputSha256],
    [record.prepared, record.preparedBytes, record.preparedSha256],
  ]) {
    const bytes = fs.readFileSync(path.join(rootDir, relativePath));
    if (bytes.length !== expectedBytes || hash(bytes) !== expectedHash) {
      throw new Error(`${relativePath} does not match the wildlife manifest.`);
    }
  }
  if (record.prepared !== definition.prepared || record.published !== definition.published) {
    throw new Error(`${definition.id} wildlife paths do not match configuration.`);
  }
  const outputBytes = fs.readFileSync(path.join(rootDir, record.prepared));
  const json = readGlbJson(outputBytes, record.prepared);
  const animations = json.animations ?? [];
  if (animations.length !== 1 || animations[0].name !== definition.clip) {
    throw new Error(`${record.prepared} must contain only animation "${definition.clip}".`);
  }
  if ((json.extensionsUsed ?? []).includes('KHR_materials_pbrSpecularGlossiness')) {
    throw new Error(`${record.prepared} still uses legacy specular/glossiness materials.`);
  }
  if (json.asset?.extras?.runtimeSpecies !== definition.id
      || json.asset?.extras?.runtimeClip !== definition.clip
      || (json.skins?.length ?? 0) < 1) {
    throw new Error(`${record.prepared} is missing its rig or wildlife provenance.`);
  }
}

console.log(`validated ${WILDLIFE_ASSETS.length} flight-only wildlife GLBs`);
