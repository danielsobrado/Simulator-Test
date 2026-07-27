import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampTreeInstanceMorphology,
  deriveForestPlacementMorphology,
  deriveTreeInstanceMorphology,
  packTreeInstanceMorphology,
  unpackTreeInstanceMorphology,
  stableIdToIdentity,
} from '../src/editor/stylized/forest/morphology/index.js';

test('morphology packing round-trips within clamped ranges', () => {
  const packed = packTreeInstanceMorphology({
    age01: 0.55,
    leanX: 0.1,
    leanZ: -0.08,
    health01: 0.9,
    crownBiasX: 0.12,
    crownBiasZ: -0.05,
    crownWidth: 1.05,
    crownFlattening: 0.95,
    branchDroop: 0.1,
    foliageDensity: 0.88,
    rootFlare: 1.1,
    stiffness: 0.95,
  });
  const unpacked = unpackTreeInstanceMorphology(packed);
  assert.ok(Math.abs(unpacked.age01 - 0.55) < 1e-6);
  assert.ok(Math.abs(unpacked.crownWidth - 1.05) < 1e-6);
  assert.ok(Math.abs(unpacked.stiffness - 0.95) < 1e-6);
});

test('clamp rejects out-of-range lean vectors', () => {
  const clamped = clampTreeInstanceMorphology({
    age01: 2,
    leanX: 5,
    leanZ: 5,
    health01: -1,
    crownBiasX: 0,
    crownBiasZ: 0,
    crownWidth: 0,
    crownFlattening: 9,
    branchDroop: 9,
    foliageDensity: 0,
    rootFlare: 0,
    stiffness: 0,
  });
  assert.ok(clamped.age01 <= 1);
  assert.ok(Math.hypot(clamped.leanX, clamped.leanZ) <= 0.22 + 1e-9);
});

test('forest placement morphology is deterministic for a stable id', () => {
  const habitat = {
    slope: 0.4,
    waterWeight: 0.6,
    patchEdge: 0.2,
    patchCoverage: 0.8,
    downhillDirectionXZ: [1, 0],
  };
  const a = deriveForestPlacementMorphology({
    stableId: 'tree:12:34',
    speciesId: 'broadleaf_round',
    habitat,
  });
  const b = deriveForestPlacementMorphology({
    stableId: 'tree:12:34',
    speciesId: 'broadleaf_round',
    habitat,
  });
  assert.deepEqual(a, b);
  assert.ok(a.crownWidth >= 0.82 && a.crownWidth <= 1.18);
});

test('deriveTreeInstanceMorphology uses identity salts', () => {
  const identity = stableIdToIdentity('oak-a');
  const morph = deriveTreeInstanceMorphology(
    identity,
    'conifer_narrow',
    {
      slope01: 0.2,
      downhillDirectionXZ: [0, 1],
      exposure01: 0.3,
      exposedRootPotential: 0.1,
    },
    {
      oldForestBias: 0.4,
      moisture: 0.5,
      moistureSuitability: 0.7,
      temperatureSuitability: 0.7,
      stress: 0.1,
    },
    {
      crownPressure: 0.2,
      directionalPressure: 0.15,
      openLightDirectionXZ: [1, 0],
    },
  );
  assert.ok(morph.stiffness >= 0.65);
});
