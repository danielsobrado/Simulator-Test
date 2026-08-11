import assert from 'node:assert/strict';
import test from 'node:test';

import { createAzgaarBiomeDefinitions } from '../src/editor/AzgaarBiomeCatalog.js';

test('current pack.biomes metadata ignores removed custom records', () => {
  const definitions = createAzgaarBiomeDefinitions([
    { i: 13, name: 'Removed forest', color: '#123456', removed: true },
    { i: 14, name: 'Living barrens', color: '#654321' },
  ]);

  assert.equal(definitions.some((definition) => definition.sourceId === 13), false);
  assert.equal(definitions.find((definition) => definition.sourceId === 14)?.name, 'Living barrens');
});

test('an observed removed biome still gets a safe fallback definition', () => {
  const definitions = createAzgaarBiomeDefinitions([
    { i: 13, name: 'Removed forest', color: '#123456', removed: true },
  ], [13]);
  const fallback = definitions.find((definition) => definition.sourceId === 13);

  assert.equal(fallback.name, 'Custom biome 13');
  assert.equal(fallback.standard, false);
});
