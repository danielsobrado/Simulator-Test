import assert from 'node:assert/strict';
import test from 'node:test';
import { float, vec2, vec3 } from 'three/tsl';

import { createFrozenWaterNodes } from '../src/editor/stylized/FrozenWaterNodes.js';

test('frozen water builds its parallax crack layers into one ice colour', () => {
  const ice = createFrozenWaterNodes({
    appearance: { lake: float(1), ocean: float(0), cold: float(1) },
    patterns: { latticePoint: (name, point) => point.mul(0.2) },
    localXZ: vec2(3, 4),
    waterDepth: float(2),
    currentStrength: float(0),
    shoreDistance: float(10),
  });
  assert.ok(ice.color(vec3(0, 0, 1)).isNode);
  assert.ok(ice.alpha(float(1), float(1), float(1)).isNode);
  assert.equal(createFrozenWaterNodes({ appearance: null }), null);
});
