import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  FOREST_GENERATED_SPECIES,
  createForestSpeciesPrototypeGeometry,
} from '../src/editor/stylized/forest/ForestSpeciesGeometry.js';
import { createTreeProxyPrototype } from '../src/editor/stylized/lod/StylizedProxyGeometry.js';

const PROXY_CONFIG = Object.freeze({
  trees: Object.freeze({
    barkTint: '#6b4a30',
    leafTop: '#65a653',
  }),
});

function horizontalDiameter(geometry) {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  return Math.max(size.x, size.z);
}

function disposeProxy(proxy) {
  for (const part of [...proxy.proxyParts, ...proxy.fallbackImpostorParts]) {
    part.geometry.dispose();
    part.material.dispose();
  }
}

test('tree proxies keep branch extents out of the low-LOD trunk diameter', () => {
  const prototypes = createForestSpeciesPrototypeGeometry(FOREST_GENERATED_SPECIES);
  try {
    for (const prototype of prototypes) {
      const proxy = createTreeProxyPrototype(prototype.parts, PROXY_CONFIG);
      try {
        const canopy = proxy.proxyParts.find((part) => part.kind === 'leaf');
        const trunk = proxy.proxyParts.find((part) => part.kind === 'trunk');
        const fallbackTrunk = proxy.fallbackImpostorParts.find((part) => part.kind === 'trunk');
        const canopyDiameter = horizontalDiameter(canopy.geometry);

        assert.ok(
          horizontalDiameter(trunk.geometry) <= canopyDiameter * 0.16,
          `${prototype.speciesId} proxy trunk is wider than 16% of its canopy`,
        );
        assert.ok(
          horizontalDiameter(fallbackTrunk.geometry) <= canopyDiameter * 0.16,
          `${prototype.speciesId} fallback trunk is wider than 16% of its canopy`,
        );
      } finally {
        disposeProxy(proxy);
      }
    }
  } finally {
    for (const prototype of prototypes) {
      for (const part of prototype.parts) part.geometry.dispose();
    }
  }
});
