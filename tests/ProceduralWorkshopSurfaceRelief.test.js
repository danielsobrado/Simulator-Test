import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceRelief } from '../src/editor/workshop/ProceduralWorkshopSurfaceRelief.js';
import { buildProceduralFacadeIvy } from '../src/editor/workshop/ProceduralWorkshopIvy.js';

test('relief reports the local maximum protrusion', () => {
  const relief = createSurfaceRelief({ cellSize: 0.3 });
  assert.equal(relief.sample(0, 0), 0, 'an empty field must report no relief');

  relief.record(0, 0, 0.05);
  relief.record(0, 0, 0.09);
  relief.record(0, 0, 0.02);
  assert.equal(relief.sample(0, 0), 0.09, 'the largest protrusion in a cell wins');

  // Neighbouring cells are included, so growth lifts before it reaches a stone.
  assert.equal(relief.sample(0.3, 0), 0.09);
  assert.equal(relief.sample(0, 0.3), 0.09);
  // Two cells away is out of range.
  assert.equal(relief.sample(1.2, 0), 0);
});

test('relief ignores recessed stones and non-finite input', () => {
  const relief = createSurfaceRelief();
  relief.record(0, 0, -0.08);
  relief.record(1, 1, 0);
  relief.record(Number.NaN, 0, 0.1);
  relief.record(0, Number.POSITIVE_INFINITY, 0.1);
  relief.record(2, 2, Number.NaN);
  assert.equal(relief.size, 0, 'only positive, finite protrusion is recorded');
  assert.equal(relief.sample(0, 0), 0);
  assert.equal(relief.sample(Number.NaN, 0), 0);
});

test('ivy stands off by the recorded masonry relief', () => {
  const recipe = { seed: 1848, detail: 2, ivy: true, irregularity: 0.45 };
  const input = {
    width: 8, height: 6, frontZ: 1, seedOffset: 60, preferredSide: 1,
  };

  const relief = createSurfaceRelief();
  const proud = 0.09;
  for (let x = -4; x <= 4; x += 0.3) {
    for (let y = 0; y <= 6; y += 0.3) relief.record(x, y, proud);
  }

  const bare = buildProceduralFacadeIvy(recipe, input);
  const lifted = buildProceduralFacadeIvy(recipe, { ...input, relief });
  try {
    // Same growth, just pushed clear of the stones.
    assert.equal(bare.length, lifted.length);

    const frontOf = (geometries) => {
      let front = -Infinity;
      for (const geometry of geometries) {
        const position = geometry.getAttribute('position');
        for (let index = 0; index < position.count; index += 1) {
          front = Math.max(front, position.getZ(index));
        }
      }
      return front;
    };
    const delta = frontOf(lifted) - frontOf(bare);
    assert.ok(
      Math.abs(delta - proud) < 1e-6,
      `expected a ${proud} stand-off, saw ${delta}`,
    );
  } finally {
    bare.forEach((geometry) => geometry.dispose());
    lifted.forEach((geometry) => geometry.dispose());
  }
});

test('a round host measures relief in arc length', () => {
  const radius = 2;
  const recipe = { seed: 7, detail: 3, ivy: true, irregularity: 0.5 };
  const relief = createSurfaceRelief();
  const proud = 0.07;
  const circumference = Math.PI * 2 * radius;
  for (let arc = -circumference / 2; arc <= circumference / 2; arc += 0.3) {
    for (let y = 0; y <= 7; y += 0.3) relief.record(arc, y, proud);
  }

  const shared = {
    width: circumference, height: 7, surfaceType: 'round', radius, seedOffset: 170,
  };
  const bare = buildProceduralFacadeIvy(recipe, shared);
  const lifted = buildProceduralFacadeIvy(recipe, { ...shared, relief });
  try {
    const maxRadius = (geometries) => {
      let found = 0;
      for (const geometry of geometries) {
        const position = geometry.getAttribute('position');
        for (let index = 0; index < position.count; index += 1) {
          found = Math.max(
            found,
            Math.hypot(position.getX(index), position.getZ(index)),
          );
        }
      }
      return found;
    };
    const delta = maxRadius(lifted) - maxRadius(bare);
    // Not exact: a leaf is a rotated quad, so the vertex furthest from the axis
    // is not the one the radial offset is applied to, and its bounding radius
    // therefore does not translate perfectly linearly.
    assert.ok(
      Math.abs(delta - proud) < proud * 0.02,
      `expected a ${proud} radial stand-off, saw ${delta}`,
    );
  } finally {
    bare.forEach((geometry) => geometry.dispose());
    lifted.forEach((geometry) => geometry.dispose());
  }
});
