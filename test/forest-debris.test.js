import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFallenBranchGeometry,
  createFallenLogGeometry,
  createLeafLitterGeometry,
  createMossMoundGeometry,
  createStumpGeometry,
} from '../src/editor/stylized/forest/forestDebrisGeometry.js';
import { createForestDebrisPrototypes } from '../src/editor/stylized/forest/forestDebrisPrototypes.js';

const SHAPES = {
  createStumpGeometry, createFallenLogGeometry, createFallenBranchGeometry, createLeafLitterGeometry, createMossMoundGeometry,
};

for (const [name, create] of Object.entries(SHAPES)) {
  test(`${name} is finite, coloured and within its budget`, () => {
    const geometry = create();
    const position = geometry.getAttribute('position');
    assert.ok(position.array.every(Number.isFinite));
    assert.equal(geometry.getAttribute('color').count, position.count);
    assert.ok(geometry.getIndex().array.every((index) => index < position.count));
    assert.ok(geometry.getIndex().count / 3 <= 260, `${geometry.getIndex().count / 3} triangles`);
  });
}

test('fallen leaves face the sky, so a two-sided material lights them from above', () => {
  const geometry = createLeafLitterGeometry();
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const [a, b, c] = [index.getX(triangle), index.getX(triangle + 1), index.getX(triangle + 2)];
    const ux = position.getX(b) - position.getX(a);
    const uz = position.getZ(b) - position.getZ(a);
    const vx = position.getX(c) - position.getX(a);
    const vz = position.getZ(c) - position.getZ(a);
    assert.ok(uz * vx - ux * vz > 0, `triangle ${triangle / 3} faces down`);
  }
});

test('a debris variant keeps its biomes and an unknown kind leaves the rest standing', () => {
  const definitions = createForestDebrisPrototypes({
    variants: { leafLitter: { weight: 6, tileIds: [6] }, unicorn: {}, stump: { enabled: false } },
  });
  assert.deepEqual(definitions.map(({ id }) => id), ['leafLitter']);
  assert.deepEqual(definitions[0].tileIds, [6]);
  assert.equal(definitions[0].weight, 6);
});
