import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

const EPSILON = 1e-9;

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} != ${expected}`);
}

function createHeightField(height = 5) {
  return {
    getVertex: () => height,
    sample: () => height,
  };
}

function createResolver({ bounds, definition, origin = [0, 0], height = 5 }) {
  const floatingOrigin = new FloatingOrigin({ threshold: 100, snapSize: 128 });
  floatingOrigin.setOrigin(...origin);
  const objectMap = {
    getBounds: () => ({ ...bounds }),
  };
  const definitionByKey = new Map([[definition.key, definition]]);
  return new ObjectPlacementResolver({
    objectMap,
    definitionByKey,
    heightField: createHeightField(height),
    tileSize: 2,
    floatingOrigin,
  });
}

const TERRACE = Object.freeze({
  key: 'wall',
  foundation: {
    mode: 'terrace',
    maxSlopeDegrees: 20,
    maxDepth: 4,
    alignToNormal: false,
  },
});

test('object matrices retain cell-centre, terrain-height, and quarter-turn semantics', () => {
  const resolver = createResolver({
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 1, depth: 1 },
    definition: TERRACE,
  });
  const object = { definitionKey: 'wall', x: 0, z: 0, rotation: 1 };
  const placement = resolver.resolve(object);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  resolver.createObjectMatrix(object, placement.surface).decompose(position, quaternion, scale);

  assert.deepEqual(position.toArray(), [1, 5, -1]);
  assert.deepEqual(scale.toArray(), [1, 1, 1]);
  const rotatedX = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  close(rotatedX.x, 0, 'rotated X component');
  close(rotatedX.z, 1, 'rotated Z component');
});

test('object matrices convert canonical centres to render-local coordinates once', () => {
  const resolver = createResolver({
    bounds: { minX: 64, maxX: 64, minZ: 127, maxZ: 127, width: 1, depth: 1 },
    definition: TERRACE,
    origin: [128, -256],
  });
  const object = { definitionKey: 'wall', x: 64, z: 127, rotation: 0 };
  const matrix = resolver.createObjectMatrix(object);
  assert.deepEqual(
    [matrix.elements[12], matrix.elements[13], matrix.elements[14]],
    [1, 5, 1],
  );
});

test('foundation matrices preserve overlap and footprint scaling', () => {
  const bounds = { minX: 2, maxX: 3, minZ: 4, maxZ: 5, width: 2, depth: 2 };
  const resolver = createResolver({ bounds, definition: TERRACE });
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  resolver.createFoundationMatrix(bounds, {
    baseHeight: 5,
    foundationDepth: 2,
  }).decompose(position, quaternion, scale);

  assert.deepEqual([position.x, position.z], [6, -10]);
  close(position.y, 3.98, 'foundation centre Y');
  close(scale.x, 3.84, 'foundation X scale');
  close(scale.y, 2.04, 'foundation Y scale');
  close(scale.z, 3.84, 'foundation Z scale');
  close(quaternion.angleTo(new THREE.Quaternion()), 0, 'foundation rotation');
});
