import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';

const ROOT = path.resolve(import.meta.dirname, '..');
const EDITOR_ROOT = path.join(ROOT, 'src', 'editor');
const EXPLICIT_BAKER = path.join(
  EDITOR_ROOT,
  'stylized',
  'impostor',
  'TreeImpostorBaker.js',
);
const READBACK_PATTERN = new RegExp([
  'getArrayBufferAsync',
  'getBufferSubData',
  'getMappedRange',
  'mapAsync\\s*\\(',
  'readRenderTargetPixels(?:Async)?',
  'resolveTimestampsAsync',
  'GPUMapMode\\.READ',
].join('|'));

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(filePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [filePath] : [];
  }));
  return nested.flat();
}

test('normal editor runtime has no GPU-to-CPU readback APIs', async () => {
  const files = await javascriptFiles(EDITOR_ROOT);
  const violations = [];
  for (const filePath of files) {
    if (filePath === EXPLICIT_BAKER) continue;
    const source = await readFile(filePath, 'utf8');
    if (READBACK_PATTERN.test(source)) {
      violations.push(path.relative(ROOT, filePath));
    }
  }
  assert.deepEqual(violations, []);
});

test('tree readback is isolated to explicit impostor bake mode', async () => {
  const config = yaml.load(await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8'));
  const treeSource = await readFile(
    path.join(EDITOR_ROOT, 'stylized', 'StylizedTreeView.js'),
    'utf8',
  );
  const bakerSource = await readFile(EXPLICIT_BAKER, 'utf8');

  assert.equal(config.stylizedSurface.lod.impostor.runtimeBake, false);
  assert.match(treeSource, /forceBake\s*\|\|\s*settings\.runtimeBake !== false/);
  assert.equal(
    bakerSource.match(/readRenderTargetPixelsAsync/g)?.length,
    2,
    'the explicit offline baker owns exactly the albedo and normal atlas readbacks',
  );
  assert.doesNotMatch(bakerSource, /readRenderTargetPixels\s*\(/);
});

