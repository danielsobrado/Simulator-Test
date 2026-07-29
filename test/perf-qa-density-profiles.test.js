import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPerfQaDensityProfile,
  listPerfQaDensityProfiles,
  resolvePerfQaDensityProfile,
} from '../src/editor/performance/qa/PerfQaDensityProfiles.js';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

function config() {
  return {
    stylizedSurface: {
      trees: {
        perChunk: 24,
        habitat: {
          candidateBudgetPerChunk: 64,
          maxAcceptedPerChunk: 32,
        },
      },
      grass: { bladesPerCell: 576 },
    },
  };
}

test('performance QA exposes every supported biome density envelope', () => {
  assert.deepEqual(listPerfQaDensityProfiles(), [
    'standard',
    'dense-forest',
    'high-grass',
    'dense-mixed',
  ]);
});

test('dense biome profiles multiply tree and grass work before runtime creation', () => {
  const denseForest = config();
  applyPerfQaDensityProfile(denseForest, 'dense-forest');
  assert.equal(denseForest.stylizedSurface.trees.perChunk, 48);
  assert.equal(denseForest.stylizedSurface.trees.habitat.candidateBudgetPerChunk, 128);
  assert.equal(denseForest.stylizedSurface.trees.habitat.maxAcceptedPerChunk, 64);
  assert.equal(denseForest.stylizedSurface.grass.bladesPerCell, 576);

  const highGrass = config();
  applyPerfQaDensityProfile(highGrass, 'high-grass');
  assert.equal(highGrass.stylizedSurface.trees.perChunk, 24);
  assert.equal(highGrass.stylizedSurface.grass.bladesPerCell, 1152);

  const denseMixed = config();
  applyPerfQaDensityProfile(denseMixed, 'dense-mixed');
  assert.equal(denseMixed.stylizedSurface.trees.perChunk, 48);
  assert.equal(denseMixed.stylizedSurface.grass.bladesPerCell, 1152);
});

test('unknown density profiles resolve and report as standard', () => {
  assert.equal(resolvePerfQaDensityProfile('typo').id, 'standard');
  assert.equal(parseQaParams('?qa=diagonal&density=typo').densityProfile, 'standard');
});
