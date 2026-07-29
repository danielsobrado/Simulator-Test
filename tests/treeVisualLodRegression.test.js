import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  createInstancedRenderers,
  treeMorphologyPivotY,
} from '../src/editor/stylized/lod/StylizedLodRuntime.js';
import { measureTreeImpostorProjection } from '../src/editor/stylized/impostor/TreeImpostorBaker.js';
import { createCaptureDirections } from '../src/editor/stylized/impostor/impostorFrame.js';

test('leaf morphology scales around the canopy base instead of pulling crowns to ground', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(4, 6, 4);
  geometry.translate(0, 9, 0);
  geometry.computeBoundingBox();
  const sourceMaterial = new THREE.MeshLambertNodeMaterial();
  const parts = [[{ geometry, material: sourceMaterial, kind: 'leaf' }]];

  const renderers = createInstancedRenderers({
    root,
    partsByPrototype: parts,
    capacity: 1,
    name: 'tree-pivot-regression',
    castShadow: false,
    tintLeaves: true,
  });

  try {
    assert.equal(treeMorphologyPivotY(geometry, 'leaf'), 6);
    assert.equal(renderers[0][0].material.userData.treeMorphologyPivotY, 6);
  } finally {
    renderers[0][0].geometry.dispose();
    renderers[0][0].material.dispose();
    renderers[0][0].dispose();
    geometry.dispose();
    sourceMaterial.dispose();
  }
});

test('impostor projection fits the tree silhouette instead of its bounding sphere', () => {
  const geometry = new THREE.BoxGeometry(2, 8, 4);
  geometry.translate(0, 4, 0);
  geometry.computeBoundingBox();
  const directions = createCaptureDirections({
    columns: 8,
    rows: 2,
    lowElevationDegrees: 12,
    highElevationDegrees: 58,
  });

  try {
    const projection = measureTreeImpostorProjection(
      [{ geometry, kind: 'leaf' }],
      directions,
    );
    const sphereDiameter = Math.hypot(2, 8, 4);

    assert.ok(projection.width < sphereDiameter * 0.65);
    assert.ok(projection.height < sphereDiameter);
    assert.ok(projection.width >= 4.2);
    assert.ok(projection.height >= 8 * Math.cos(12 * Math.PI / 180));
  } finally {
    geometry.dispose();
  }
});
