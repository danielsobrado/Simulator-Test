import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ObjectView } from '../src/editor/ObjectView.js';

function createTerrainView() {
  return {
    scene: new THREE.Scene(),
    floatingOrigin: {
      toRender(x, z) {
        return { x, z };
      },
    },
    renderer: {
      domElement: {
        clientHeight: 1,
        height: 1,
      },
    },
  };
}

test('ObjectView disposes its scene-owned fallback lights and teardown is idempotent', () => {
  const terrainView = createTerrainView();
  const objectView = new ObjectView({
    terrainView,
    tileMap: { tileSize: 1 },
    heightField: {},
    objectMap: {
      list() {
        return [];
      },
    },
    objectCatalog: [],
  });

  const fallbackLights = () => terrainView.scene.children.filter(
    (child) => child.userData?.fallbackLighting === true,
  );

  assert.equal(fallbackLights().length, 2);
  objectView.dispose();
  assert.equal(fallbackLights().length, 0);
  assert.doesNotThrow(() => objectView.dispose());
});
