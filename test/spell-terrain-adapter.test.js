import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  applyEarthTerrainEdit,
  raycastTerrainHeightfield,
} from '../src/editor/spells/spell_terrain_adapter.js';

function terrainView({ heightAt = () => 0, sculpt = () => ({ indices: [], before: [], after: [] }) } = {}) {
  return {
    getWorldHeight: heightAt,
    worldStore: { tileSize: 2, revision: 7 },
    floatingOrigin: {
      toCanonical: (x, z) => ({ x: x + 100, z: z - 200 }),
    },
    heightField: { sculpt },
  };
}

test('terrain raycast resolves shallow-angle crossings', () => {
  const view = terrainView({ heightAt: (x) => x * 0.2 });
  const ray = new THREE.Ray(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
  );

  const hit = raycastTerrainHeightfield(view, ray, 10);

  assert.ok(hit);
  assert.ok(Math.abs(hit.distance - 5) < 0.1);
  assert.ok(Math.abs(hit.point.y - 1) < 0.05);
  assert.ok(hit.normal.y > 0.9);
});

test('terrain raycast returns null when the segment remains above terrain', () => {
  const view = terrainView();
  const ray = new THREE.Ray(
    new THREE.Vector3(0, 3, 0),
    new THREE.Vector3(1, 0, 0),
  );

  assert.equal(raycastTerrainHeightfield(view, ray, 5), null);
});

test('Earth edit converts render coordinates and commits a lower sculpt', () => {
  let request = null;
  const view = terrainView({
    sculpt: (options) => {
      request = options;
      return { indices: ['51:101'], before: [2], after: [0.5] };
    },
  });

  const result = applyEarthTerrainEdit(
    view,
    new THREE.Vector3(2, 1, -2),
    {
      enabled: true,
      operation: 'remove',
      shape: 'sphere',
      radiusM: 4,
      heightM: 2,
      strength: 0.75,
      falloff: 0.35,
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.revision, 7);
  assert.equal(request.centerX, 51);
  assert.equal(request.centerZ, 101);
  assert.equal(request.operation, 'lower');
  assert.equal(request.brushSize, 3);
  assert.equal(request.strength, 1.5);
});

test('unsupported Earth shapes fail without mutating terrain', () => {
  let calls = 0;
  const view = terrainView({ sculpt: () => { calls += 1; } });
  const result = applyEarthTerrainEdit(view, new THREE.Vector3(), {
    enabled: true,
    operation: 'remove',
    shape: 'capsule',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported-earth-shape');
  assert.equal(calls, 0);
});
