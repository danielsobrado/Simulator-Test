import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDriftwoodGeometry,
  createLeafGeometry,
  createRibbonPlantGeometry,
  createShellGeometry,
  createStarfishGeometry,
} from '../src/editor/stylized/proceduralFlora.js';

const TRIANGLES = (geometry) => geometry.index.count / 3;

function bounds(geometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox;
}

test('the starfish is a cheap five-armed star', () => {
  const star = createStarfishGeometry();
  // Five arms is ten rim points and ten triangles off one centre vertex.
  assert.equal(star.attributes.position.count, 11);
  assert.equal(TRIANGLES(star), 10);
  // Arms reach the unit radius the placement scales from, and the notches sit
  // inside it — that ratio is the silhouette.
  const box = bounds(star);
  assert.ok(Math.abs(box.max.x - 1) < 1e-6 || Math.abs(box.max.z - 1) < 1e-6);
  assert.ok(box.max.y > 0, 'the centre should be ridged');
  assert.equal(star.attributes.normal.count, star.attributes.position.count);
});

test('the ridged and flat star are the same star at two costs', () => {
  // The donor draws a flat one further out, where the ridge is sub-pixel.
  const flat = createStarfishGeometry({ ridge: 0 });
  assert.equal(flat.attributes.position.count, 11);
  assert.equal(bounds(flat).max.y, 0);
});

test('the arm count is the only thing that changes the cost', () => {
  const seven = createStarfishGeometry({ arms: 7 });
  assert.equal(TRIANGLES(seven), 14);
  assert.equal(seven.attributes.position.count, 15);
});

test('a shell is a domed fan with a straight hinge', () => {
  const shell = createShellGeometry({ segments: 8 });
  assert.equal(TRIANGLES(shell), 8);
  const box = bounds(shell);
  assert.ok(box.max.y > 0, 'the shell should be domed');
  // The hinge edge is flat along z at the origin row.
  const positions = shell.attributes.position;
  let hingeVertices = 0;
  for (let index = 0; index < positions.count; index += 1) {
    if (positions.getY(index) === 0) hingeVertices += 1;
  }
  assert.equal(hingeVertices, positions.count - 1);
});

test('a leaf is two triangles, and it is flat', () => {
  const leaf = createLeafGeometry();
  assert.equal(leaf.attributes.position.count, 4);
  assert.equal(TRIANGLES(leaf), 2);
  const box = bounds(leaf);
  // Laid flat on the ground: the ground cover is what makes two triangles a plant.
  assert.equal(box.max.y, 0);
  assert.ok(box.max.z > 0 && box.min.z < 0, 'the leaf should run along z');
});

test('a ribbon plant costs blades x segments x two', () => {
  const clump = createRibbonPlantGeometry({ blades: 5, segments: 3 });
  assert.equal(TRIANGLES(clump), 5 * 3 * 2);
  assert.equal(clump.attributes.position.count, 5 * 4 * 2);
  // Rooted: every blade starts at the ground and reaches its own height.
  const box = bounds(clump);
  assert.equal(box.min.y, 0);
  assert.ok(box.max.y > 0);
  // A clump that fanned to the same height everywhere would be a fence, not a plant.
  const positions = clump.attributes.position;
  const heights = new Set();
  for (let index = 0; index < positions.count; index += 1) heights.add(positions.getY(index));
  assert.ok(heights.size > 4, 'blades should reach different heights');
});

test('geometry is deterministic, so a chunk rebuilds identically', () => {
  // Nothing here may read a random source: the placement already carries a
  // deterministic scale and rotation, and a shape that varied per build would make
  // a shore shimmer every time its chunk was paged back in.
  for (const factory of [
    () => createStarfishGeometry(),
    () => createShellGeometry(),
    () => createLeafGeometry(),
    () => createRibbonPlantGeometry(),
    () => createDriftwoodGeometry(),
  ]) {
    const first = factory();
    const second = factory();
    assert.deepEqual(
      Array.from(first.attributes.position.array),
      Array.from(second.attributes.position.array),
    );
    assert.deepEqual(Array.from(first.index.array), Array.from(second.index.array));
    first.dispose();
    second.dispose();
  }
});

test('driftwood lies along the ground, bedded in, instead of arching over it', () => {
  const radius = 0.05;
  const box = bounds(createDriftwoodGeometry({ length: 1.6, radius, bend: 0.18 }));
  assert.ok(box.min.y < -radius * 0.3 && box.min.y > -radius, `bedded: bottom at ${box.min.y}`);
  assert.ok(box.max.y < radius * 1.5, `no arch: top at ${box.max.y}`);
});
