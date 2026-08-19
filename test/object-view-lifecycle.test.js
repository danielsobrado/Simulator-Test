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

test('ObjectView releases owned scene and placement resources exactly once', () => {
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
  let resolverDisposals = 0;
  objectView.placementResolver = {
    dispose() {
      resolverDisposals += 1;
    },
  };

  const fallbackLights = () => terrainView.scene.children.filter(
    (child) => child.userData?.fallbackLighting === true,
  );

  assert.equal(fallbackLights().length, 2);
  objectView.dispose();
  assert.equal(fallbackLights().length, 0);
  assert.equal(resolverDisposals, 1);
  assert.doesNotThrow(() => objectView.dispose());
  assert.equal(resolverDisposals, 1);
});
