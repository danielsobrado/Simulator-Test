import assert from 'node:assert/strict';
import test from 'node:test';

import { CONSTRUCTION_STONE_SHADING_CONFIG } from '../src/editor/construction/config/ConstructionStoneShadingConfig.generated.js';

test('soft stone normals smooth bevel facets without washing out major cuts', () => {
  const config = CONSTRUCTION_STONE_SHADING_CONFIG.softStoneNormals;

  assert.equal(config.enabled, true);
  assert.ok(config.nearCreaseAngleRadians > 0.5);
  assert.ok(config.nearCreaseAngleRadians < Math.PI / 4);
  assert.ok(config.coarseCreaseAngleRadians >= config.nearCreaseAngleRadians);
  assert.ok(config.coarseCreaseAngleRadians < Math.PI / 2);
});
