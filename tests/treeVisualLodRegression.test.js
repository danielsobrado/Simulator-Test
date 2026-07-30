import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float } from 'three/tsl';
import {
  createInstancedRenderers,
  treeMorphologyPivot,
  treeMorphologyPivotY,
} from '../src/editor/stylized/lod/StylizedLodRuntime.js';
import { createDitheredMaterial } from '../src/editor/stylized/lod/StylizedDitheredMaterial.js';
import { measureTreeImpostorProjection } from '../src/editor/stylized/impostor/TreeImpostorBaker.js';
import { createCaptureDirections } from '../src/editor/stylized/impostor/impostorFrame.js';
import { splitDisconnectedTreeParts } from '../src/editor/stylized/StylizedTreePrototypes.js';

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

test('tree morphology uses one trunk-axis pivot for offset crown and trunk parts', () => {
  const leafGeometry = new THREE.BoxGeometry(4, 5, 4);
  leafGeometry.translate(12, 8, -7);
  const trunkGeometry = new THREE.BoxGeometry(0.5, 8, 0.5);
  trunkGeometry.translate(12, 4, -7);
  const leaf = {
    geometry: leafGeometry,
    material: new THREE.MeshLambertNodeMaterial(),
    kind: 'leaf',
  };
  const trunk = {
    geometry: trunkGeometry,
    material: new THREE.MeshLambertNodeMaterial(),
    kind: 'trunk',
  };
  const parts = [leaf, trunk];

  try {
    assert.deepEqual(treeMorphologyPivot(parts, leaf), { x: 12, y: 5.5, z: -7 });
    assert.deepEqual(treeMorphologyPivot(parts, trunk), { x: 12, y: 0, z: -7 });
  } finally {
    leafGeometry.dispose();
    trunkGeometry.dispose();
    leaf.material.dispose();
    trunk.material.dispose();
  }
});

test('mapped foliage keeps source alpha outside the stochastic LOD fade', () => {
  const source = new THREE.MeshLambertNodeMaterial();
  source.opacityNode = float(0.7);
  source.alphaTest = 0.15;
  const material = createDitheredMaterial(source, { kind: 'leaf' });
  try {
    // TSL wraps assignments in VarNodes. The underlying top-level multiply is
    // source alpha * fade mask; the old regression was step(threshold,
    // source alpha * fade), which stippled leaves even at full coverage.
    assert.equal(material.opacityNode.node?.op, '*');
    assert.equal(material.opacityNode.node?.bNode?.node?.method, 'step');
    assert.equal(material.alphaTest, 0.15);
    assert.equal(material.alphaToCoverage, false);
  } finally {
    material.dispose();
    source.dispose();
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

test('disconnected showroom trees become independent grounded prototypes', () => {
  const parts = [];
  for (const x of [-4, 0, 4]) {
    const trunk = new THREE.CylinderGeometry(0.2, 0.3, 5, 6);
    trunk.translate(x, 2.5, 0);
    trunk.computeBoundingBox();
    const crown = new THREE.BoxGeometry(3, 4, 3);
    crown.translate(x, 6, 0);
    crown.computeBoundingBox();
    parts.push(
      { geometry: trunk, kind: 'trunk', source: null },
      { geometry: crown, kind: 'leaf', source: null },
    );
  }

  const groups = splitDisconnectedTreeParts(parts);
  try {
    assert.equal(groups.length, 3);
    for (const group of groups) {
      assert.deepEqual(group.map((part) => part.kind).sort(), ['leaf', 'trunk']);
      const bounds = new THREE.Box3();
      for (const part of group) bounds.union(part.geometry.boundingBox);
      assert.ok(Math.abs(bounds.min.y) < 1e-6);
      assert.ok(Math.abs((bounds.min.x + bounds.max.x) * 0.5) < 1e-6);
      assert.ok(Math.abs((bounds.min.z + bounds.max.z) * 0.5) < 1e-6);
    }
  } finally {
    for (const group of groups) {
      for (const part of group) part.geometry.dispose();
    }
  }
});

test('overlapping broadleaf branch meshes remain one prototype', () => {
  const trunkA = new THREE.BoxGeometry(2, 6, 2);
  trunkA.translate(-0.25, 3, 0);
  trunkA.computeBoundingBox();
  const trunkB = new THREE.BoxGeometry(2, 5, 2);
  trunkB.translate(0.25, 4, 0);
  trunkB.computeBoundingBox();
  const crown = new THREE.BoxGeometry(6, 4, 6);
  crown.translate(0, 7, 0);
  crown.computeBoundingBox();
  const parts = [
    { geometry: trunkA, kind: 'trunk', source: null },
    { geometry: trunkB, kind: 'trunk', source: null },
    { geometry: crown, kind: 'leaf', source: null },
  ];

  try {
    assert.deepEqual(splitDisconnectedTreeParts(parts), [parts]);
  } finally {
    for (const part of parts) part.geometry.dispose();
  }
});
