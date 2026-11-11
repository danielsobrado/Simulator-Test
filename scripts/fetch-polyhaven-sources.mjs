#!/usr/bin/env node
/**
 * Downloads named texture maps of Poly Haven assets (CC0 1.0) into the
 * git-ignored source cache and records them in a committed lock file.
 *
 * Map mode (`maps`) reads `response[map][resolution][format]` and fetches no
 * scan geometry. Model mode (`model: true`) fetches the scan's glTF with every
 * file it includes, plus its separate alpha map when it has one.
 *
 * Usage: node scripts/fetch-polyhaven-sources.mjs --config <config.mjs> [--check]
 * The config exports `assets` ([{ id, maps, preview? } | { id, model: true }]),
 * `lockFile` and `resolution`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS = { 'User-Agent': 'world-builder-asset-fetch/1.0' };

function option(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
}

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
/** Cutouts and masks keep lossless PNG; everything else is fine as JPEG. */
const formatFor = (map) => (/alpha|mask/i.test(map) ? 'png' : 'jpg');

async function download(url) {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

function isCached(entry) {
  const file = path.join(rootDir, entry.path);
  return fs.existsSync(file) && (!entry.md5 || md5(fs.readFileSync(file)) === entry.md5);
}

/** The scan's glTF, every file it includes (kept at the relative path the glTF names) and its alpha map. */
function modelEntries(id, files, resolution, authors) {
  const gltf = files.gltf?.[resolution]?.gltf;
  if (!gltf?.url) throw new Error(`Poly Haven asset ${id} has no ${resolution} glTF.`);
  const entry = (map, relative, file) => {
    // Include keys come from the API: never let one leave the asset's folder.
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Poly Haven asset ${id} names an unsafe path "${relative}".`);
    return { id, map, path: `assets/source-cache/polyhaven/${id}/${relative}`, url: file.url, md5: file.md5, size: file.size, authors };
  };
  const entries = [
    entry('gltf', `${id}_${resolution}.gltf`, gltf),
    ...Object.entries(gltf.include ?? {}).map(([relative, file]) => entry(relative, relative, file)),
  ];
  const alpha = files.Alpha?.[resolution];
  const format = alpha?.png ? 'png' : 'jpg';
  if (alpha?.[format]) entries.push(entry('alpha', `textures/${id}_alpha_${resolution}.${format}`, alpha[format]));
  return entries;
}

async function resolveAsset({ id, maps, preview, model }, resolution) {
  const files = JSON.parse((await download(`https://api.polyhaven.com/files/${id}`)).toString('utf8'));
  const info = JSON.parse((await download(`https://api.polyhaven.com/info/${id}`)).toString('utf8'));
  const authors = Object.keys(info.authors ?? {}).sort();
  if (model) return modelEntries(id, files, resolution, authors);
  const entries = maps.map((map) => {
    const format = formatFor(map);
    const file = files[map]?.[resolution]?.[format];
    if (!file?.url) throw new Error(`Poly Haven asset ${id} has no ${resolution} ${format} file for map "${map}".`);
    return {
      id, map, path: `assets/source-cache/polyhaven/${id}/${id}_${map}_${resolution}.${format}`,
      url: file.url, md5: file.md5, size: file.size, authors,
    };
  });
  if (preview) {
    // The scan's own render: the reference row of the Blender contact sheets.
    entries.push({
      id, map: 'preview', path: `assets/source-cache/polyhaven/${id}/${id}_preview.png`,
      url: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=512&height=512`, md5: null, size: null, authors,
    });
  }
  return entries;
}

async function main() {
  const configPath = option('--config');
  if (!configPath) throw new Error('Usage: fetch-polyhaven-sources.mjs --config <config.mjs> [--check]');
  const config = await import(pathToFileURL(path.resolve(rootDir, configPath)).href);
  const lockPath = path.join(rootDir, config.lockFile);

  if (process.argv.includes('--check')) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const bad = lock.files.filter((entry) => !isCached(entry));
    if (bad.length > 0) throw new Error(`Source cache does not match the lock:\n${bad.map((entry) => `  ${entry.path}`).join('\n')}`);
    console.log(`${lock.files.length} cached files match ${config.lockFile}.`);
    return;
  }

  const entries = [];
  let downloaded = 0;
  for (const asset of config.assets) {
    for (const entry of await resolveAsset(asset, config.resolution ?? '2k')) {
      if (!isCached(entry)) {
        const bytes = await download(entry.url);
        // A preview has no published checksum; its own hash is what the lock pins.
        if (entry.md5 && md5(bytes) !== entry.md5) throw new Error(`${entry.url} failed its md5 check.`);
        const file = path.join(rootDir, entry.path);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        downloaded += 1;
      }
      if (!entry.md5) {
        const bytes = fs.readFileSync(path.join(rootDir, entry.path));
        entry.md5 = md5(bytes);
        entry.size = bytes.length;
      }
      entries.push(entry);
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id) || a.map.localeCompare(b.map));
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify({ source: 'https://polyhaven.com', license: 'CC0-1.0', files: entries }, null, 2)}\n`);
  const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  console.log(`${entries.length} files in cache (${(bytes / 2 ** 20).toFixed(1)} MiB), ${downloaded} downloaded.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
