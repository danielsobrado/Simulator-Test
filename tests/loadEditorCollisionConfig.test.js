import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../src/config/loadEditorConfig.js', import.meta.url),
  'utf8',
);

test('editor config loader installs collision without dropping water config', () => {
  assert.match(source, /config\.collision = createCollisionConfig/);
  assert.match(source, /config\/collision\.yaml\?raw/);
  assert.match(source, /applyWaterDomainConfig/);
  assert.match(source, /validateWaterDomainConfig/);
});
