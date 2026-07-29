import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPerfQaDensityProfile,
  listPerfQaDensityProfiles,
} from '../src/editor/performance/qa/PerfQaDensityProfiles.js';

function config() {
  return {
    stylizedSurface: {
      trees: {
        perChunk: 12,
        habitat: {
          candidateBudgetPerChunk: 144,
          maxAcceptedPerChunk: 72,
        },
      },
      grass: {
        bladesPerCell: 576,
      },
    },
  };
}

test('performance QA exposes deterministic vegetation load envelopes', () => {
  assert.deepEqual(listPerfQaDensityProfiles(), [
    'standard',
    'dense-forest',
    'high-grass',
    'dense-mixed',
  ]);

  const forest = config();
  applyPerfQaDensityProfile(forest, 'dense-forest');
  assert.equal(forest.stylizedSurface.trees.perChunk, 24);
  assert.equal(forest.stylizedSurface.trees.habitat.candidateBudgetPerChunk, 288);
  assert.equal(forest.stylizedSurface.trees.habitat.maxAcceptedPerChunk, 144);
  assert.equal(forest.stylizedSurface.grass.bladesPerCell, 576);

  const grass = config();
  applyPerfQaDensityProfile(grass, 'high-grass');
  assert.equal(grass.stylizedSurface.trees.perChunk, 12);
  assert.equal(grass.stylizedSurface.grass.bladesPerCell, 1152);

  const mixed = config();
  applyPerfQaDensityProfile(mixed, 'dense-mixed');
  assert.equal(mixed.stylizedSurface.trees.perChunk, 24);
  assert.equal(mixed.stylizedSurface.grass.bladesPerCell, 1152);
});

test('unknown density profiles fall back without mutating production values', () => {
  const value = config();
  const result = applyPerfQaDensityProfile(value, 'not-a-profile');
  assert.equal(result.id, 'standard');
  assert.deepEqual(value, config());
});
