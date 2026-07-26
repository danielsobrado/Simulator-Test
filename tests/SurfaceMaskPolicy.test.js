import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { vec4 } from 'three/tsl';
import {
  SURFACE_CLASSIFICATION_THRESHOLD,
  createSurfaceClassNodes,
} from '../src/editor/stylized/SurfaceMaskNodes.js';
import { resolveWaterSurfaceHeight } from '../src/editor/stylized/StylizedWaterSlot.js';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('surface classification centralizes a hard categorical threshold', () => {
  const nodes = createSurfaceClassNodes(vec4(0, 1, 0, 1));

  assert.equal(SURFACE_CLASSIFICATION_THRESHOLD, 0.5);
  assert.ok(nodes.grass?.isNode);
  assert.ok(nodes.water?.isNode);
  assert.ok(nodes.landGrass?.isNode);
});

test('water surface height comes from authoritative world sea level', () => {
  const terrainView = {
    worldStore: { generator: { toMetadata: () => ({ seaLevel: -2.75 }) } },
    streamingConfig: { seaLevel: -1.5 },
  };

  assert.equal(resolveWaterSurfaceHeight(terrainView), -2.75);
  assert.equal(resolveWaterSurfaceHeight({ streamingConfig: { seaLevel: -1.5 } }), -1.5);
  assert.equal(resolveWaterSurfaceHeight({}), 0);
});

test('water is level and vegetation consumes the live land-grass mask', () => {
  const water = source('../src/editor/stylized/StylizedWaterMaterial.js');
  const grass = source('../src/editor/stylized/StylizedGrassMaterial.js');
  const flowers = source('../src/editor/stylized/StylizedFlowerMaterial.js');

  assert.match(water, /surfaceHeight = float\(waterLevel\)/);
  assert.doesNotMatch(water, /terrainHeight\.add\(water\.heightOffset\)/);
  assert.match(grass, /opacityNode = surfaceClass\.landGrass/);
  assert.match(flowers, /alive = .*\.mul\(surfaceClass\.landGrass\)/);
});
