import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralCastleWallParts } from '../src/editor/workshop/ProceduralCastleWallGenerator.js';
import { getCastleWallOpenings } from '../src/editor/workshop/ProceduralCastleWallLayout.js';

function recipe() {
  return {
    archetype: 'wall',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'stepped',
    towerSide: 'none',
    width: 10,
    depth: 1,
    height: 5,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 2,
    weathering: 0.35,
    windows: true,
    ivy: false,
    remesh: false,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
  };
}

function containsPoint(part, point) {
  part.geometry.computeBoundingBox();
  const bounds = part.geometry.boundingBox.clone().applyMatrix4(part.matrix);
  return bounds.containsPoint(point);
}

test('generated castle wall geometry leaves the complete arch passage clear', () => {
  const sourceRecipe = recipe();
  const openings = getCastleWallOpenings(sourceRecipe);
  const parts = createProceduralCastleWallParts(sourceRecipe);
  try {
    for (const opening of openings) {
      const y = opening.bottom + opening.springHeight * 0.55;
      const inset = Math.min(0.08, opening.width * 0.08);
      const samples = [
        new THREE.Vector3(opening.centerX, y, 0),
        new THREE.Vector3(opening.centerX - opening.width / 2 + inset, y, 0),
        new THREE.Vector3(opening.centerX + opening.width / 2 - inset, y, 0),
      ];
      for (const point of samples) {
        assert.equal(
          parts.some((part) => containsPoint(part, point)),
          false,
          `Generated geometry obstructs arch passage at ${point.toArray().join(', ')}.`,
        );
      }
    }
  } finally {
    disposeModelParts(parts);
  }
});
