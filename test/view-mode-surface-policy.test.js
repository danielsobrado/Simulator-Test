import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyTerrainInspectionMode } from '../src/editor/player/ViewModeSurfacePolicy.js';

function createFixture() {
  const nearMaterial = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const farMaterial = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const waterMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const scene = new THREE.Scene();
  const farTerrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), farMaterial);
  farTerrain.name = 'macro-far-terrain';
  const water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), waterMaterial);
  water.name = 'stylized-water-test';
  scene.add(farTerrain, water);

  return {
    terrainView: {
      slots: [{ material: nearMaterial }],
      scene,
    },
    nearMaterial,
    farMaterial,
    waterMaterial,
  };
}

test('orbit inspection renders terrain from both sides without changing water', () => {
  const fixture = createFixture();

  const changed = applyTerrainInspectionMode(fixture.terrainView, true);

  assert.equal(changed, 2);
  assert.equal(fixture.nearMaterial.side, THREE.DoubleSide);
  assert.equal(fixture.farMaterial.side, THREE.DoubleSide);
  assert.equal(fixture.waterMaterial.side, THREE.DoubleSide);
});

test('player mode restores front-face terrain while underwater water remains double-sided', () => {
  const fixture = createFixture();
  applyTerrainInspectionMode(fixture.terrainView, true);

  const changed = applyTerrainInspectionMode(fixture.terrainView, false);

  assert.equal(changed, 2);
  assert.equal(fixture.nearMaterial.side, THREE.FrontSide);
  assert.equal(fixture.farMaterial.side, THREE.FrontSide);
  assert.equal(fixture.waterMaterial.side, THREE.DoubleSide);
});
