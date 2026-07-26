import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  extractAuthoredGroupedPrototypes,
  extractAuthoredMeshPrototypes,
} from '../src/editor/stylized/StylizedPrototypeBake.js';
import { createBiomePrototypeSelector } from '../src/editor/stylized/BiomePrototypeSelector.js';
import { extractPrototypePartsFromRoots } from '../src/editor/stylized/StylizedTreePrototypes.js';

function mesh(name, materialName, size = [1, 1, 1]) {
  const material = new THREE.MeshStandardMaterial();
  material.name = materialName;
  const value = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  value.name = name;
  return value;
}

test('grouped authored prototypes retain material parts and ground the combined object', () => {
  const scene = new THREE.Scene();
  const plant = new THREE.Group();
  plant.name = 'plant';
  const stem = mesh('stem-mesh', 'Stem', [0.2, 1, 0.2]);
  stem.position.set(5, 1, -4);
  const leaves = mesh('leaf-mesh', 'Leaves', [1.2, 0.5, 1.1]);
  leaves.position.set(5, 1.6, -4);
  plant.add(stem, leaves);
  scene.add(plant);

  const [parts] = extractAuthoredGroupedPrototypes(scene, {
    scale: 2,
    groups: [['plant']],
  });
  try {
    assert.equal(parts.length, 2);
    assert.deepEqual(parts.map((part) => part.source.material.name), ['Stem', 'Leaves']);
    const bounds = new THREE.Box3();
    for (const part of parts) bounds.union(part.geometry.boundingBox);
    assert.ok(Math.abs(bounds.min.y) < 1e-6);
    assert.ok(Math.abs((bounds.min.x + bounds.max.x) * 0.5) < 1e-6);
    assert.ok(Math.abs((bounds.min.z + bounds.max.z) * 0.5) < 1e-6);
    assert.ok(bounds.max.y > 2);
  } finally {
    for (const part of parts) part.geometry.dispose();
  }
});

test('mesh root selection excludes unrelated showroom geometry', () => {
  const scene = new THREE.Scene();
  const selected = new THREE.Group();
  selected.name = 'selected-rock';
  selected.add(mesh('rock-mesh', 'Rock'));
  const background = new THREE.Group();
  background.name = 'background-card';
  background.add(mesh('card-mesh', 'Backdrop', [100, 100, 1]));
  scene.add(selected, background);

  const prototypes = extractAuthoredMeshPrototypes(scene, {
    rootNames: ['selected-rock'],
  });
  try {
    assert.equal(prototypes.length, 1);
    assert.equal(prototypes[0].source.name, 'rock-mesh');
    assert.throws(
      () => extractAuthoredMeshPrototypes(scene, { rootNames: ['missing'] }),
      /missing GLB nodes/,
    );
  } finally {
    for (const prototype of prototypes) prototype.geometry.dispose();
  }
});

test('tree sibling groups are classified, centred and grounded as one prototype', () => {
  const scene = new THREE.Scene();
  const trunkRoot = new THREE.Group();
  trunkRoot.name = 'trunk-root';
  const trunk = mesh('trunk', 'Bark', [0.5, 4, 0.5]);
  trunk.position.set(8, 2, 3);
  trunkRoot.add(trunk);
  const crownRoot = new THREE.Group();
  crownRoot.name = 'crown-root';
  const crown = mesh('crown', 'Foliage', [3, 5, 3]);
  crown.position.set(8, 6, 3);
  crownRoot.add(crown);
  scene.add(trunkRoot, crownRoot);
  scene.updateMatrixWorld(true);

  const parts = extractPrototypePartsFromRoots([trunkRoot, crownRoot], {
    assets: {
      trunkMaterial: 'Bark',
      leafMaterial: 'Foliage',
    },
  });
  try {
    assert.deepEqual(parts.map((part) => part.kind).sort(), ['leaf', 'trunk']);
    const trunkPart = parts.find((part) => part.kind === 'trunk');
    assert.ok(Math.abs(trunkPart.geometry.boundingBox.min.y) < 1e-6);
    const bounds = new THREE.Box3();
    for (const part of parts) bounds.union(part.geometry.boundingBox);
    assert.ok(Math.abs((bounds.min.x + bounds.max.x) * 0.5) < 1e-6);
    assert.ok(bounds.max.y >= 8.5);
  } finally {
    for (const part of parts) part.geometry.dispose();
  }
});

test('authored detail weights keep expensive models as deterministic rare accents', () => {
  // A rule set with no biome, character or canopy steering must behave exactly
  // like the global weighted roll this replaced.
  const select = createBiomePrototypeSelector({
    rules: [{ weight: 8 }, { weight: 1 }, { weight: 1 }],
  });

  assert.equal(select(0, 4), 0);
  assert.equal(select(0.7999, 4), 0);
  assert.equal(select(0.8, 4), 1);
  assert.equal(select(0.8999, 4), 1);
  assert.equal(select(0.9, 4), 2);
  assert.equal(select(1, 4), 2);
  assert.throws(
    () => createBiomePrototypeSelector({ rules: [{ weight: 1 }, { weight: 0 }] }),
    /must be positive/,
  );
});
