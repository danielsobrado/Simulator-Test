import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { UnderwaterViewController } from '../src/editor/water/UnderwaterViewController.js';

const underwaterConfig = Object.freeze({
  backgroundColor: '#123456',
  fogColor: '#234567',
  fogDensity: 0.05,
  lightScale: 0.4,
  transitionSeconds: 0.01,
  nearPlane: 0.15,
});

function createHarness({ fog = null } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0a100c');
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 1000);
  const playerController = {
    camera,
    getStatus: () => ({
      enabled: true,
      headSubmerged: playerController.headSubmerged,
    }),
    headSubmerged: false,
  };
  const terrainView = {
    scene,
    godRays: null,
  };
  const controller = new UnderwaterViewController({
    terrainView,
    playerController,
    config: underwaterConfig,
  });
  return { controller, scene, playerController };
}

test('fog-less worlds restore null fog after a dive cycle', () => {
  const { controller, scene, playerController } = createHarness({ fog: null });
  assert.equal(controller.originalFogExists, false);

  playerController.headSubmerged = true;
  for (let i = 0; i < 8; i += 1) {
    controller.update(i * 16);
  }
  assert.ok(scene.fog?.isFogExp2, 'diving installs temporary underwater fog');

  playerController.headSubmerged = false;
  for (let i = 0; i < 8; i += 1) {
    controller.update(1000 + i * 16);
  }
  assert.equal(controller.blend, 0);
  assert.ok(scene.fog?.isFogExp2, 'blend path may still hold a temporary fog object');

  controller.restoreSurfaceEnvironment();
  assert.equal(scene.fog, null);
  controller.dispose();
});

test('worlds that started with fog restore their surface fog', () => {
  const fog = new THREE.FogExp2('#9ab4c0', 0.012);
  const { controller, scene, playerController } = createHarness({ fog });
  assert.equal(controller.originalFogExists, true);

  playerController.headSubmerged = true;
  controller.update(0);
  playerController.headSubmerged = false;
  for (let i = 0; i < 8; i += 1) {
    controller.update(1000 + i * 16);
  }
  controller.restoreSurfaceEnvironment();
  assert.ok(scene.fog?.isFogExp2);
  assert.equal(scene.fog.density, 0.012);
  controller.dispose();
});
