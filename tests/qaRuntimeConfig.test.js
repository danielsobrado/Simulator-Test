import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  normaliseQaBaseUrl,
  resolveQaOutputDirectory,
} from '../scripts/lib/qaRuntimeConfig.mjs';

const root = path.resolve('/workspace/project');

test('QA output defaults to a named child under tmp', () => {
  assert.equal(
    resolveQaOutputDirectory(root, null, 'collision-acceptance'),
    path.join(root, 'tmp', 'collision-acceptance'),
  );
});

test('QA output accepts nested paths inside tmp', () => {
  assert.equal(
    resolveQaOutputDirectory(root, path.join(root, 'tmp', 'qa', 'run-1'), 'unused'),
    path.join(root, 'tmp', 'qa', 'run-1'),
  );
});

test('QA output rejects tmp itself and paths outside it', () => {
  assert.throws(
    () => resolveQaOutputDirectory(root, path.join(root, 'tmp'), 'unused'),
    /must be a child/,
  );
  assert.throws(
    () => resolveQaOutputDirectory(root, path.join(root, 'reports'), 'unused'),
    /must be a child/,
  );
  assert.throws(
    () => resolveQaOutputDirectory(root, path.join(root, 'tmp', '..', 'src'), 'unused'),
    /must be a child/,
  );
});

test('QA base URL removes query, fragment, and trailing slash', () => {
  assert.equal(
    normaliseQaBaseUrl('http://127.0.0.1:5173/app/?old=1#section'),
    'http://127.0.0.1:5173/app',
  );
});

test('QA base URL rejects non-HTTP schemes', () => {
  assert.throws(
    () => normaliseQaBaseUrl('file:///tmp/index.html'),
    /must use HTTP or HTTPS/,
  );
});
