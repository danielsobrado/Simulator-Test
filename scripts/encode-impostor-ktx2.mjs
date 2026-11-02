import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { foliageMipmaps } from '../src/editor/stylized/impostor/alphaCoverage.js';
import { ktx2MipChain, sharpenCutoutAlpha, FOLIAGE_KTX2_ALPHA_CUTOFF } from './lib/foliage-ktx2-mips.mjs';
import { requireKtx2Encoder } from './lib/ktx2-encoder.mjs';

const option = (key, fallback) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? fallback : process.argv[index + 1];
};
const directory = path.resolve(option('--directory', 'public/assets/impostors/trees'));
const encoder = option('--encoder', process.env.TOKTX ?? 'toktx');
const version = requireKtx2Encoder(encoder);
const encoderPath = value => process.platform === 'linux' && /\.exe$/i.test(encoder)
  ? execFileSync('wslpath', ['-w', value], { encoding: 'utf8' }).trim() : value;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = path.join(directory, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'impostor-ktx2-'));
// Windows scanners and indexers briefly hold files just written beside these.
async function writeRetrying(file, data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeFile(file, data);
    } catch (error) {
      if (attempt >= 5 || !['EBUSY', 'EPERM', 'UNKNOWN'].includes(error.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}
const run = args => new Promise((resolve, reject) => {
  const child = spawn(encoder, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`toktx exited with ${code}.`)));
});

try {
  for (const prototype of manifest.prototypes) {
    const filename = path.basename(prototype.albedo);
    const source = await readFile(path.join(directory, filename));
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const levels = ktx2MipChain(foliageMipmaps(data, info.width, info.height, FOLIAGE_KTX2_ALPHA_CUTOFF));
    const mipFiles = [];
    for (let index = 0; index < levels.length; index++) {
      const mip = sharpenCutoutAlpha(levels[index]);
      const file = path.join(temporary, `${prototype.prototypeIndex}-${index}.png`);
      await sharp(Buffer.from(mip.data), { raw: { width: mip.width, height: mip.height, channels: 4 } }).png().toFile(file);
      mipFiles.push(encoderPath(file));
    }
    const outputName = filename.replace(/\.png$/, '.ktx2');
    // Encode to a temporary output: failures leave the published file intact.
    const output = path.join(temporary, outputName);
    await run(['--t2', '--2d', '--mipmap', '--levels', String(levels.length),
      '--lower_left_maps_to_s0t0', '--encode', 'etc1s', '--clevel', '5', '--qlevel', '192',
      '--threads', '1', '--assign_oetf', 'srgb', '--assign_primaries', 'bt709',
      '--', encoderPath(output), ...mipFiles]);
    const bytes = await readFile(output);
    await writeRetrying(path.join(directory, outputName), bytes);
    prototype.albedoKtx2 = prototype.albedo.replace(filename, outputName);
    prototype.albedoKtx2Metadata = { encoder: version, sourceSha256: hash(source), sha256: hash(bytes),
      width: info.width, height: info.height, levels: levels.length, alphaCutoff: FOLIAGE_KTX2_ALPHA_CUTOFF };
    console.log(`Encoded ${outputName}: ${bytes.length} bytes, ${levels.length} mip levels.`);
  }
  await writeRetrying(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
