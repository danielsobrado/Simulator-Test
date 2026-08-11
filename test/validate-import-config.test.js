import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

import { validateImportConfig } from '../src/config/validateImportConfig.js';

const guidance = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

function validConfig(overrides = {}) {
  return {
    import: {
      azgaarAtlasLongEdge: 2000,
      azgaarGuidance: structuredClone(guidance),
      ...overrides,
    },
  };
}

test('Azgaar atlas long edge must be a bounded positive integer', () => {
  assert.doesNotThrow(() => validateImportConfig(validConfig()));

  for (const value of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 4_000_001]) {
    assert.throws(
      () => validateImportConfig(validConfig({ azgaarAtlasLongEdge: value })),
      /azgaarAtlasLongEdge must be an integer within/,
    );
  }
});

test('Azgaar guidance tuning is required and validated', () => {
  assert.throws(
    () => validateImportConfig({ import: { azgaarAtlasLongEdge: 2000 } }),
    /azgaarGuidance must be an object/,
  );

  const invalidDistance = validConfig();
  invalidDistance.import.azgaarGuidance.riverInfluenceKilometers = 0;
  assert.throws(
    () => validateImportConfig(invalidDistance),
    /riverInfluenceKilometers must be positive/,
  );

  const invalidRange = validConfig();
  invalidRange.import.azgaarGuidance.detailMaximumScale = 0.2;
  assert.throws(
    () => validateImportConfig(invalidRange),
    /detail maximum scale must cover minimum scale/,
  );

  const invalidKeywords = validConfig();
  invalidKeywords.import.azgaarGuidance.customBiomeForestKeywords = [];
  assert.throws(
    () => validateImportConfig(invalidKeywords),
    /customBiomeForestKeywords.*non-empty array of strings/,
  );
});

test('import configuration must be an object', () => {
  for (const value of [null, [], 'invalid']) {
    assert.throws(
      () => validateImportConfig({ import: value }),
      /import must be an object/,
    );
  }
});
