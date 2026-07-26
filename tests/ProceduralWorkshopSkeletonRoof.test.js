import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createSkeletonRoofParts } from '../src/editor/workshop/ProceduralWorkshopSkeletonRoof.js';

function rectangle(id, {
  position = [0, 0],
  dimensions = [6, 4],
  rotation = 0,
  elevation = 0,
  height = 5,
  roofFamily = 'hip',
} = {}) {
  return {
    id, kind: 'rectangle', position, dimensions, rotation,
    elevation, height, roofFamily,
  };
}

function materials() {
  return {
    roofMaterial: new THREE.MeshStandardMaterial(),
    wallMaterial: new THREE.MeshStandardMaterial(),
  };
}

function dispose(result, ownedMaterials) {
  disposeModelParts(result.parts);
  ownedMaterials.roofMaterial.dispose();
  ownedMaterials.wallMaterial.dispose();
}

test('an L footprint emits one finite coherent hip roof with no fallback', () => {
  const ownedMaterials = materials();
  const result = createSkeletonRoofParts({
    rectangles: [
      rectangle('hall', { dimensions: [8, 3] }),
      rectangle('wing', { position: [-2.5, 2], dimensions: [3, 5] }),
    ],
    ...ownedMaterials,
  });
  try {
    assert.equal(result.stats.roofGroups, 1);
    assert.equal(result.stats.roofSkeletonFallbacks, 0);
    assert.equal(result.parts.length, 1);
    const position = result.parts[0].geometry.getAttribute('position');
    assert.ok(position.count > 6);
    assert.ok(Array.from(position.array).every(Number.isFinite));
  } finally {
    dispose(result, ownedMaterials);
  }
});

test('gable and hip rectangles emit observably different geometry', () => {
  const gableMaterials = materials();
  const gable = createSkeletonRoofParts({
    rectangles: [rectangle('hall', { dimensions: [8, 4], roofFamily: 'gable' })],
    ...gableMaterials,
  });
  const hipMaterials = materials();
  const hip = createSkeletonRoofParts({
    rectangles: [rectangle('hall', { dimensions: [8, 4], roofFamily: 'hip' })],
    ...hipMaterials,
  });
  try {
    assert.equal(gable.parts.length, 2);
    assert.ok(gable.parts.some(({ materialRegion }) => materialRegion.id === 'hall:gable-panels'));
    assert.equal(hip.parts.length, 1);
    assert.notEqual(
      gable.parts[0].geometry.getAttribute('position').count,
      hip.parts[0].geometry.getAttribute('position').count,
    );
  } finally {
    dispose(gable, gableMaterials);
    dispose(hip, hipMaterials);
  }
});

test('different wall-top heights create distinct roof groups', () => {
  const ownedMaterials = materials();
  const result = createSkeletonRoofParts({
    rectangles: [
      rectangle('low', { position: [-3, 0], height: 4 }),
      rectangle('high', { position: [3, 0], height: 6 }),
    ],
    ...ownedMaterials,
  });
  try {
    assert.equal(result.stats.roofGroups, 2);
    assert.equal(result.parts.length, 2);
  } finally {
    dispose(result, ownedMaterials);
  }
});

test('a tower clips a hole from a hall roof without producing non-finite geometry', () => {
  const ownedMaterials = materials();
  const result = createSkeletonRoofParts({
    rectangles: [rectangle('hall', { dimensions: [10, 6] })],
    circles: [{
      id: 'tower',
      kind: 'circle',
      position: [4, 0],
      radius: 2,
      elevation: 0,
      height: 8,
    }],
    ...ownedMaterials,
  });
  try {
    assert.equal(result.stats.roofSkeletonFallbacks, 0);
    const positions = result.parts[0].geometry.getAttribute('position').array;
    assert.ok(Array.from(positions).every(Number.isFinite));
  } finally {
    dispose(result, ownedMaterials);
  }
});

test('Ultra detail tiles arbitrary skeleton faces within the per-roof budget', () => {
  const ownedMaterials = materials();
  const result = createSkeletonRoofParts({
    recipe: {
      detail: 3,
      seed: 17,
      irregularity: 0.45,
      roofPitch: 38,
      roofOverhang: 0.35,
    },
    rectangles: [
      rectangle('hall', { dimensions: [8, 3] }),
      rectangle('wing', { position: [-2.5, 2], dimensions: [3, 5] }),
    ],
    ...ownedMaterials,
  });
  try {
    assert.ok(result.stats.roofShingles > 0);
    assert.ok(result.stats.roofShingles <= 1400);
    assert.equal(result.stats.roofSkeletonFallbacks, 0);
    assert.ok(result.parts.slice(1).every(({ geometry }) => (
      Array.from(geometry.getAttribute('position').array).every(Number.isFinite)
    )));
  } finally {
    dispose(result, ownedMaterials);
  }
});
