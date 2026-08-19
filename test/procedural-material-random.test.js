import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRandom as sharedCreateRandom,
  mixSeed as sharedMixSeed,
} from '../src/editor/materials/ProceduralMaterialRandom.js';
import {
  createRandom as workshopCreateRandom,
  mixSeed as workshopMixSeed,
} from '../src/editor/workshop/ProceduralRandom.js';

test('workshop random API preserves the shared deterministic seed mixer', () => {
  const cases = [
    [0, 0],
    [7717, 5],
    [0xffffffff, 1024],
    [123456789, -17],
  ];
  for (const [seed, value] of cases) {
    assert.equal(workshopMixSeed(seed, value), sharedMixSeed(seed, value));
  }
});

test('workshop random API preserves the shared deterministic sequence', () => {
  const shared = sharedCreateRandom(7717);
  const workshop = workshopCreateRandom(7717);
  for (let index = 0; index < 16; index += 1) {
    assert.equal(workshop(), shared());
  }
});
