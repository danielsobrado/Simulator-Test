import assert from 'node:assert/strict';
import test from 'node:test';

import { validateImportConfig } from '../src/config/validateImportConfig.js';

test('Azgaar atlas long edge must be a bounded positive integer', () => {
  assert.doesNotThrow(() => validateImportConfig({
    import: { azgaarAtlasLongEdge: 2000 },
  }));

  for (const value of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 4_000_001]) {
    assert.throws(
      () => validateImportConfig({ import: { azgaarAtlasLongEdge: value } }),
      /azgaarAtlasLongEdge must be an integer within/,
    );
  }
});

test('import configuration must be an object', () => {
  for (const value of [null, [], 'invalid']) {
    assert.throws(
      () => validateImportConfig({ import: value }),
      /import must be an object/,
    );
  }
});
