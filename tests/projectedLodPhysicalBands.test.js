import assert from 'node:assert/strict';
import test from 'node:test';
import { clampLodToRadii } from '../src/editor/stylized/lod/projectedLod.js';

test('collapsed logical bush bands resolve to one proxy representation', () => {
  const radii = {
    meshRadius: 1,
    proxyRadius: 2,
    impostorRadius: 2,
    clusterRadius: 2,
  };
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 2, ...radii }), 'proxy');
  assert.equal(clampLodToRadii({ band: 'impostor', chunkDistance: 2, ...radii }), 'proxy');
  assert.equal(clampLodToRadii({ band: 'cluster', chunkDistance: 2, ...radii }), 'proxy');
});
