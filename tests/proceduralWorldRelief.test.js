import assert from 'node:assert/strict';
import test from 'node:test';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

function sampledRelief(generator, radius = 128, step = 4) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let z = -radius; z <= radius; z += step) {
    for (let x = -radius; x <= radius; x += step) {
      const height = generator.sampleHeight(x, z);
      minimum = Math.min(minimum, height);
      maximum = Math.max(maximum, height);
    }
  }
  return maximum - minimum;
}

test('new procedural worlds have visible local relief around their starting area', () => {
  for (const seed of [42, 73, 918273]) {
    const generator = new ProceduralWorldGenerator({ seed });
    assert.ok(
      sampledRelief(generator) >= 12,
      `seed ${seed} generated less than 12 height units of local relief`,
    );
  }
});
