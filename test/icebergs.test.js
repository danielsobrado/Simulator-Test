import assert from 'node:assert/strict';
import test from 'node:test';
import { ICEBERG_CELL_METERS, ICEBERG_KINDS, icebergCandidate, icebergHasRoom } from '../src/editor/stylized/ice/icebergField.js';
import { createIcebergGeometry } from '../src/editor/stylized/ice/icebergGeometry.js';

test('a grid cell always grows the same berg, inside that cell', () => {
  let bergs = 0;
  for (let x = -40; x < 40; x += 1) {
    for (let z = -40; z < 40; z += 1) {
      const berg = icebergCandidate(x, z);
      assert.deepEqual(berg, icebergCandidate(x, z));
      if (!berg) continue;
      bergs += 1;
      assert.equal(Math.floor(berg.x / ICEBERG_CELL_METERS), x);
      assert.equal(Math.floor(berg.z / ICEBERG_CELL_METERS), z);
      assert.ok(berg.kind >= 0 && berg.kind < ICEBERG_KINDS);
    }
  }
  assert.ok(bergs > 1800 && bergs < 3200, `about 45% of cells, got ${bergs}`);
});

test('a berg needs open water around it, not just under it', () => {
  const berg = { x: 0, z: 0, scale: 50 };
  assert.equal(icebergHasRoom(berg, () => true), true);
  assert.equal(icebergHasRoom(berg, (x) => x < 60), false);
  assert.equal(icebergHasRoom(berg, () => false), false);
});

test('every berg shape stands proud of sea level with a shorter keel', () => {
  for (let kind = 0; kind < ICEBERG_KINDS; kind += 1) {
    const geometry = createIcebergGeometry(kind);
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    assert.ok(max.y > 0.3, `kind ${kind} rises above the water`);
    assert.ok(min.y < 0 && min.y > -0.8, `kind ${kind} has a stubby keel`);
    assert.ok(Number.isFinite(geometry.boundingSphere.radius));
  }
});
