import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { vec4 } from 'three/tsl';
import {
  SURFACE_CLASSIFICATION_THRESHOLD,
  createSurfaceClassNodes,
} from '../src/editor/stylized/SurfaceMaskNodes.js';

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

test('water rides the streamed field and vegetation consumes the live land-grass mask', () => {
  const water = source('../src/editor/stylized/StylizedWaterMaterial.js');
  const grass = source('../src/editor/stylized/StylizedGrassMaterial.js');
  const flowers = source('../src/editor/stylized/StylizedFlowerMaterial.js');

  // W3/W4 replaced the single flat sea level with a per-chunk water field, so
  // the surface height is read from that field instead of from a scalar level
  // or from terrain height.
  assert.match(water, /surfaceHeight = waterField\.g\.add\(waterSurfaceOrigin\)/);
  assert.doesNotMatch(water, /terrainHeight\.add\(water\.heightOffset\)/);
  assert.match(grass, /opacityNode = surfaceClass\.landGrass/);
  assert.match(flowers, /alive = .*\.mul\(surfaceClass\.landGrass\)/);
});
