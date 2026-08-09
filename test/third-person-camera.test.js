import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createThirdPersonCameraSettings,
  ThirdPersonCamera,
} from '../src/editor/player/ThirdPersonCamera.js';

function status() {
  return {
    position: { x: 0, y: 1.7, z: 0 },
    footY: 0,
    yaw: 0,
    pitch: 0,
  };
}

test('third-person camera validates resolved settings', () => {
  assert.throws(
    () => createThirdPersonCameraSettings({ occlusionSamples: 0 }),
    /occlusionSamples/,
  );
  assert.throws(
    () => createThirdPersonCameraSettings({ distance: 0.5 }),
    /minDistance must not exceed distance/,
  );
});

test('third-person camera reaches the configured boom on flat ground', () => {
  const view = new ThirdPersonCamera({
    terrain: { heightAt: () => 0 },
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(Math.abs(view.camera.position.z - view.settings.distance) < 1e-6);
  assert.ok(Math.abs(view.camera.position.x - view.settings.shoulder) < 1e-6);
});

test('third-person camera detects an obstruction between clear endpoints', () => {
  const terrain = {
    heightAt: (_x, z) => (z >= 1.45 && z <= 2.05 ? 2 : 0),
  };
  const view = new ThirdPersonCamera({
    terrain,
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(
    view.camera.position.z < 1.45,
    `camera passed through the bank to z=${view.camera.position.z}`,
  );
});

test('third-person occlusion follows the shoulder-offset path', () => {
  const terrain = {
    heightAt: (x, z) => (x > 0.15 && z >= 1.4 && z <= 2.1 ? 2 : 0),
  };
  const view = new ThirdPersonCamera({
    terrain,
    fovDegrees: 68,
    farPlane: 5000,
  });

  view.update(0, status());

  assert.ok(
    view.camera.position.z < 1.4,
    `camera ignored shoulder-path obstruction and reached z=${view.camera.position.z}`,
  );
});
