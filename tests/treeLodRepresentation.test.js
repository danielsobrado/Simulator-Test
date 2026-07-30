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

test('authored impostors cover living age classes and reject dead or extreme crowns', () => {
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'young',
    crownScale: 0.8,
    crownAspect: 1,
    foliageDensity: 0.9,
  }), true);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'sapling',
    crownScale: 0.55,
    crownAspect: 1,
    foliageDensity: 0.9,
  }), true);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'mature',
    crownScale: 1,
    crownAspect: 1,
    foliageDensity: 1,
  }), true);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'dead',
    crownScale: 1,
    crownAspect: 1,
    foliageDensity: 1,
  }), false);
  assert.equal(isTreeImpostorMorphologyCompatible({
    ageClass: 'mature',
    crownScale: 1,
    crownAspect: 1,
    foliageDensity: 0.2,
  }), false);
});
