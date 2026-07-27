import assert from 'node:assert/strict';
import test from 'node:test';
import { selectTreePhysicalRepresentation } from '../src/editor/stylized/TreeLodAssembler.js';

test('tree impostor band uses the cross-card fallback when no atlas batch exists', () => {
  assert.equal(
    selectTreePhysicalRepresentation({ band: 'impostor', hasImpostor: false }),
    'fallback',
  );
  assert.equal(
    selectTreePhysicalRepresentation({ band: 'impostor', hasImpostor: true }),
    'impostor',
  );
});
