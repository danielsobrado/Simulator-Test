import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
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

test('a physical mesh radius can guarantee near geometry despite chunk-center projection', () => {
  const radii = {
    meshRadius: 1,
    proxyRadius: 2,
    impostorRadius: 2,
    clusterRadius: 2,
    forceNearWithinMeshRadius: true,
  };

  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 0, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'culled', chunkDistance: 1, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 2, ...radii }), 'proxy');
});

test('configured bushes keep a distinct near and proxy ring', () => {
  const config = yaml.load(readFileSync(
    new URL('../editor.config.yaml', import.meta.url),
    'utf8',
  ));
  const bush = config.stylizedSurface.lod.bush;
  const radii = {
    meshRadius: bush.meshRadius,
    proxyRadius: bush.proxyRadius,
    impostorRadius: bush.proxyRadius,
    clusterRadius: bush.proxyRadius,
    forceNearWithinMeshRadius: bush.forceNearWithinMeshRadius,
  };

  assert.ok(bush.meshRadius < bush.proxyRadius);
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 0, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 1, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 2, ...radii }), 'proxy');
});

test('configured trees cannot select proxy geometry beside the player', () => {
  const config = yaml.load(readFileSync(
    new URL('../editor.config.yaml', import.meta.url),
    'utf8',
  ));
  const tree = config.stylizedSurface.lod.tree;
  const radii = {
    meshRadius: tree.meshRadius,
    proxyRadius: tree.proxyRadius,
    impostorRadius: tree.impostorRadius,
    clusterRadius: tree.clusterRadius,
    forceNearWithinMeshRadius: tree.forceNearWithinMeshRadius,
  };

  assert.equal(tree.forceNearWithinMeshRadius, true);
  assert.equal(tree.proxyRadius, tree.meshRadius);
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 0, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 1, ...radii }), 'near');
  assert.equal(clampLodToRadii({ band: 'proxy', chunkDistance: 2, ...radii }), 'impostor');
});
