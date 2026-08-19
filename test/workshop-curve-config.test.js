import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  CURVE_PATH_VERSION,
  CURVE_SEGMENT_KINDS,
  DEFAULT_GEOMETRY_TOLERANCE,
  MAX_CURVE_POINTS,
  MAX_CURVE_SEGMENTS,
} from '../src/editor/workshop/curves/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function jsFiles(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => path.join(directory, entry.name));
}

test('curve-kernel YAML stays synchronized with runtime-safe defaults', async () => {
  const config = yaml.load(await readFile(path.join(root, 'config', 'workshop-curve-kernel.yaml'), 'utf8'));
  assert.equal(config.version, 1);
  assert.equal(config.curvePathVersion, CURVE_PATH_VERSION);
  assert.deepEqual(config.supportedSegments, CURVE_SEGMENT_KINDS);
  assert.equal(config.limits.pointsPerPath, MAX_CURVE_POINTS);
  assert.equal(config.limits.segmentsPerPath, MAX_CURVE_SEGMENTS);
  assert.deepEqual(config.tolerance, DEFAULT_GEOMETRY_TOLERANCE);
});

test('curve and topology kernels remain renderer-free and contain no private epsilon literals', async () => {
  const directories = [
    path.join(root, 'src', 'editor', 'workshop', 'curves'),
    path.join(root, 'src', 'editor', 'workshop', 'topology'),
  ];
  const files = (await Promise.all(directories.map(jsFiles))).flat();
  for (const file of files) {
    if (file.endsWith('CurveKernelConstants.js')) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]three(?:\/[^'"]*)?['"]|import\s+['"]three(?:\/[^'"]*)?['"]/);
    assert.doesNotMatch(source, /\b1e-\d+\b|Number\.EPSILON/);
  }
});
