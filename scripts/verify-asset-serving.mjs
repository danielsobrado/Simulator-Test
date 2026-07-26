import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const baseUrl = readArg('url', process.env.ASSET_SERVING_BASE_URL);
const assetPath = readArg('asset', '/assets/grass-scene.glb');
if (!baseUrl) {
  throw new Error(
    'Provide --url https://deployment.example or set ASSET_SERVING_BASE_URL.',
  );
}

const target = new URL(assetPath, `${baseUrl.replace(/\/$/, '')}/`);
const response = await fetch(target, {
  headers: {
    'Accept-Encoding': 'br, gzip',
  },
});
if (!response.ok) {
  throw new Error(`${target.href} returned HTTP ${response.status}.`);
}
await response.arrayBuffer();

const contentEncoding = response.headers.get('content-encoding');
if (contentEncoding !== 'br' && contentEncoding !== 'gzip') {
  throw new Error(
    `${target.href} did not negotiate Brotli or gzip; `
    + `Content-Encoding was ${contentEncoding ?? '(missing)'}.`,
  );
}
const vary = response.headers.get('vary') ?? '';
if (!vary.toLowerCase().split(',').map((value) => value.trim()).includes('accept-encoding')) {
  throw new Error(`${target.href} must send "Vary: Accept-Encoding".`);
}

const report = {
  version: 1,
  kind: 'simcity-dnd-asset-serving-verification',
  generatedAt: new Date().toISOString(),
  url: target.href,
  status: response.status,
  contentEncoding,
  contentType: response.headers.get('content-type'),
  contentLength: Number(response.headers.get('content-length')) || null,
  cacheControl: response.headers.get('cache-control'),
  vary,
};
const reportPath = path.join(root, 'tmp', 'asset-serving-latest.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
