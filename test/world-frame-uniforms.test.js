import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { frameGroup, objectGroup } from 'three/tsl';
import { GrassTuning } from '../src/editor/stylized/GrassTuning.js';
import { blownStreakUniforms } from '../src/editor/stylized/ambient/BlownStreaks.js';
import { jungleMistUniforms } from '../src/editor/stylized/ambient/JungleMist.js';
import { createCpuTreeImpostorMaterial, updateImpostorCameraUniforms } from '../src/editor/stylized/impostor/TreeImpostorMaterial.js';
import { createSnowfallField } from '../src/editor/weather/snowfall/SnowfallField.js';

test('world weather and live grass settings share the frame uniform group', () => {
  for (const node of [
    ...Object.values(blownStreakUniforms),
    ...Object.values(jungleMistUniforms),
    ...Object.values(new GrassTuning({}).uniforms),
  ]) assert.equal(node.groupNode, frameGroup);
});

test('impostor camera state and reflection clocks remain per render', () => {
  const albedo = new THREE.DataTexture(new Uint8Array([100, 80, 60, 255]), 1, 1);
  const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 128]), 1, 1);
  const { material, uniforms } = createCpuTreeImpostorMaterial({
    width: 4, height: 20, centerY: 10, columns: 1, rows: 1, tileSize: 16,
    lowElevationDegrees: 12, highElevationDegrees: 58, albedo, normal,
  });
  try {
    for (const key of ['cameraRight', 'cameraUp', 'sphericalBlend', 'time']) {
      assert.equal(uniforms[key].groupNode, objectGroup, key);
    }
    assert.equal(uniforms.windStrength.groupNode, frameGroup);
    const camera = new THREE.PerspectiveCamera();
    updateImpostorCameraUniforms(uniforms, camera, 1000);
    const right = uniforms.cameraRight.value.clone();
    camera.rotation.y = Math.PI / 2;
    updateImpostorCameraUniforms(uniforms, camera, 2000);
    assert.ok(uniforms.cameraRight.value.distanceTo(right) > 1);
    assert.equal(uniforms.time.value, 2);
  } finally { material.dispose(); albedo.dispose(); normal.dispose(); }
});

test('snowfall keeps camera position per render while its clock joins the frame group', () => {
  const field = createSnowfallField();
  try {
    assert.equal(field.uniforms.center.groupNode, objectGroup);
    assert.equal(field.uniforms.time.groupNode, frameGroup);
    field.setCenter(new THREE.Vector3(10, 20, 30));
    assert.deepEqual(field.uniforms.center.value.toArray(), [10, 20, 30]);
  } finally { field.dispose(); }
});
