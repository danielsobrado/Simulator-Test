import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTreeImpostorMorphologyCompatible,
  selectTreePhysicalRepresentation,
} from '../src/editor/stylized/TreeLodAssembler.js';

test('tree impostor band uses the low-poly proxy fallback when no atlas batch exists', () => {
  assert.equal(
    selectTreePhysicalRepresentation({ band: 'impostor', hasImpostor: false }),
    'fallback',
  );
  assert.equal(
    selectTreePhysicalRepresentation({ band: 'impostor', hasImpostor: true }),
    'impostor',
  );
  assert.equal(
    selectTreePhysicalRepresentation({
      band: 'impostor',
      hasImpostor: true,
      morphologyCompatible: false,
    }),
    'fallback',
  );
});

test('single-shape impostors reject age and crown morphologies they cannot represent', () => {
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'young',
    crownScale: 0.8,
    crownAspect: 1,
    foliageDensity: 0.9,
  }), false);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'mature',
    crownScale: 1,
    crownAspect: 1,
    foliageDensity: 1,
  }), true);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'mature',
    crownScale: 1,
    crownAspect: 1,
    foliageDensity: 0.55,
  }), false);
});
