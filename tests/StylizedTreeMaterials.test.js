import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createStylizedLeafMaterial } from '../src/editor/stylized/StylizedTreeMaterials.js';

const CONFIG = Object.freeze({
  wind: Object.freeze({
    direction: Object.freeze([1, 0]),
    frequency: 0.47,
    speed: 1.3,
    turbulence: 0.04,
  }),
  trees: Object.freeze({
    flutterSpeed: 1,
    flutterAmplitude: 0.02,
    windStrength: 0.1,
    dip: 0.05,
    gradientPower: 1,
    leafBottom: '#315f35',
    leafTop: '#78a95c',
    variationScale: 1,
    variationColor: '#8baa66',
    variationStrength: 0.1,
    brightness: 1,
    rimStrength: 0,
    cardAlphaTest: 0.32,
  }),
});

function leafMaterial(source) {
  return createStylizedLeafMaterial({
    source,
    bounds: { minY: 0, maxY: 2 },
    time: uniform(0),
    config: CONFIG,
    preserveSourceColor: true,
  });
}

test('authored leaf cutouts retain their intended alpha threshold', () => {
  const map = new THREE.Texture();
  const masked = leafMaterial({ map, alphaTest: 0.5, color: new THREE.Color('#ffffff') });
  const blended = leafMaterial({ map, alphaTest: 0, color: new THREE.Color('#ffffff') });

  try {
    assert.equal(masked.alphaTest, 0.5);
    assert.equal(blended.alphaTest, CONFIG.trees.cardAlphaTest);
    assert.equal(masked.opacityNode.node.uvNode, null);
  } finally {
    masked.dispose();
    blended.dispose();
    map.dispose();
  }
});
