import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, normalWorld, positionGeometry, positionView, vec3 } from 'three/tsl';
import { createCpuTreeImpostorMaterial, treeImpostorBarkEmission } from '../src/editor/stylized/impostor/TreeImpostorMaterial.js';
import { treeBarkEmission, syncFoliageLight } from '../src/editor/stylized/forest/foliageLight.js';
import { evaluateShaderNode as evaluate } from './helpers/evaluateShaderNode.js';
import { buildShader } from './helpers/buildShader.js';

const atlas = { width: 4, height: 20, centerY: 10, columns: 1, rows: 1, tileSize: 16,
  lowElevationDegrees: 12, highElevationDegrees: 58, foliageLighting: true, barkLighting: true,
  albedo: new THREE.DataTexture(new Uint8Array([100, 80, 60, 255]), 1, 1),
  normal: new THREE.DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1) };

test('impostor bark gets the live fill at prototype height, and foliage never receives bark fill', () => {
  syncFoliageLight({ hemisphere: new THREE.HemisphereLight('#ffffff', '#96734a', 1) });
  for (const y of [-.5, -.4, 0, .5]) for (const mask of [0, 1]) {
    const values = new Map([[positionGeometry, [0, y, 0]], [positionView, [0, 0, 10]], [normalWorld, [0, 0, 1]]]);
    const after = evaluate(treeImpostorBarkEmission(vec3(.4, .3, .2), float(mask), vec3(0, 0, 1), atlas), { values });
    const expected = evaluate(treeBarkEmission(vec3(.4, .3, .2), { height: float(y * 20 + 10), up: float(0) }), { values });
    after.forEach((channel, i) => assert.ok(Math.abs(channel - expected[i] * (1 - mask)) < 1e-6));
  }
  syncFoliageLight(null);
});

test('impostor bark lighting generates valid WGSL with the existing instance layout', () => {
  const { material } = createCpuTreeImpostorMaterial(atlas);
  const geometry = new THREE.PlaneGeometry(1, 1);
  for (const [name, data] of Object.entries({ instanceTransform: [0, 10, 0, 1], instanceImpostorParams: [0, 1, .5, 0], instanceImpostorAppearance: [1, 1, 1, 1] })) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  }
  buildShader(new THREE.InstancedMesh(geometry, material, 1));
});
