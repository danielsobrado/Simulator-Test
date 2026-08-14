import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const MAIN_URL = new URL('../src/main.js', import.meta.url);

test('startup errors are rendered as inert text', async () => {
  const source = await readFile(MAIN_URL, 'utf8');
  const start = source.indexOf('function showStartupError(error)');
  assert.notEqual(start, -1);

  const startupRenderer = source.slice(start);
  assert.doesNotMatch(startupRenderer, /innerHTML\s*=/);
  assert.match(startupRenderer, /message\.textContent\s*=/);
  assert.match(startupRenderer, /root\.replaceChildren\(container\)/);
});
