import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import sharp from 'sharp';
import {
  validateTreeImpostorManifest,
} from '../src/editor/stylized/impostor/TreeImpostorManifest.js';

const CONFIG_PATH = resolve('editor.config.yaml');
const MANIFEST_PATH = resolve('public/assets/impostors/trees/manifest.json');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const REQUIRED = process.argv.includes('--required');
const VISIBLE_ALPHA = 127;

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function publicPath(path) {
  return resolve('public', path.slice(1));
}

function pngSize(buffer, label) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a valid PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function alphaCoverage(buffer, label) {
  const { data, info } = await sharp(buffer, { failOn: 'error' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) {
    throw new Error(`${label} could not be decoded as RGBA.`);
  }
  let visible = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] > VISIBLE_ALPHA) visible += 1;
  }
  return visible;
}

async function runtimeBakeEnabled() {
  const config = yaml.load(await readFile(CONFIG_PATH, 'utf8'));
  const settings = config?.stylizedSurface?.lod?.impostor;
  return settings?.enabled !== false && settings?.runtimeBake !== false;
}

async function main() {
  if (!await exists(MANIFEST_PATH)) {
    if (REQUIRED) {
      throw new Error(`Required tree impostor manifest is missing: ${MANIFEST_PATH}`);
    }
    console.log('tree impostor manifest not present; runtime bake fallback remains enabled');
    return;
  }
  const manifest = validateTreeImpostorManifest(
    JSON.parse(await readFile(MANIFEST_PATH, 'utf8')),
    { allowLegacy: !REQUIRED },
  );
  if (manifest.requiresRuntimeBake && !await runtimeBakeEnabled()) {
    throw new Error(
      `Tree impostor manifest v${manifest.version} requires runtime bake, but runtimeBake is disabled.`,
    );
  }

  for (const prototype of manifest.prototypes) {
    const expectedWidth = prototype.columns * prototype.tileSize;
    const expectedHeight = prototype.rows * prototype.tileSize;
    const buffers = {};
    for (const field of ['albedo', 'normal']) {
      const path = publicPath(prototype[field]);
      const buffer = await readFile(path);
      buffers[field] = buffer;
      const size = pngSize(buffer, `${field} atlas ${path}`);
      if (size.width !== expectedWidth || size.height !== expectedHeight) {
        throw new Error(
          `${field} atlas ${path} is ${size.width}×${size.height}; expected ${expectedWidth}×${expectedHeight}.`,
        );
      }
    }
    if (manifest.requiresRuntimeBake) continue;

    const albedoPixels = await alphaCoverage(buffers.albedo, `albedo atlas ${prototype.albedo}`);
    const foliagePixels = await alphaCoverage(buffers.normal, `normal atlas ${prototype.normal}`);
    if (albedoPixels === 0) {
      throw new Error(`Albedo atlas ${prototype.albedo} contains no visible tree pixels.`);
    }
    if (foliagePixels === 0 || foliagePixels >= albedoPixels) {
      throw new Error(
        `Normal atlas ${prototype.normal} alpha is not a foliage-only mask (${foliagePixels}/${albedoPixels} visible pixels).`,
      );
    }
  }

  const mode = manifest.requiresRuntimeBake
    ? `legacy v${manifest.version}; exact runtime v3 bake enabled`
    : manifest.normalEncoding;
  console.log(
    `validated ${manifest.prototypes.length} tree impostor prototypes (${manifest.sourceSignature}; ${mode})`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
