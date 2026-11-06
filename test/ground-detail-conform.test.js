import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { StylizedGroundDetailView } from '../src/editor/stylized/StylizedGroundDetailView.js';

// A 30 degree plane rising toward +x: height = x * tan(30 deg).
const RISE = Math.tan(Math.PI / 6);
const view = Object.assign(Object.create(StylizedGroundDetailView.prototype), {
  terrainView: { getCanonicalHeight: (x) => x * RISE },
  prototypeConform: [true, false],
  prototypeHeightOffsets: [0, 0],
});
const placement = (prototypeIndex) => ({ prototypeIndex, x: 10, z: -4, height: 10 * RISE, rotationY: 0.7, scale: 1 });

function upAxis(matrix) {
  return new THREE.Vector3().setFromMatrixColumn(matrix, 1).normalize();
}

test('lying deadwood tilts to a 30 degree slope, so both ends meet the ground', () => {
  const up = upAxis(view.placementMatrix(placement(0)));
  const normal = new THREE.Vector3(-RISE, 1, 0).normalize();
  assert.ok(up.angleTo(normal) < 1e-3, `up ${up.toArray()} vs ground normal ${normal.toArray()}`);
  // The log's ends, 2 m either side along its own x axis, sit on the plane.
  const matrix = view.placementMatrix(placement(0));
  for (const end of [-2, 2]) {
    const p = new THREE.Vector3(end, 0, 0).applyMatrix4(matrix);
    assert.ok(Math.abs(p.y - p.x * RISE) < 1e-3, `end at ${p.toArray()} floats ${p.y - p.x * RISE} m`);
  }
});

test('standing details stay upright on the same slope', () => {
  const up = upAxis(view.placementMatrix(placement(1)));
  assert.ok(up.angleTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
});
