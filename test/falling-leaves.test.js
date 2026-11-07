import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';

import {
  FallingLeaves,
  createLeafGeometry,
} from '../src/editor/stylized/leaves/FallingLeaves.js';
import {
  collectLeafShelters,
  insideShelter,
  sheddingWoodlandShare,
} from '../src/editor/stylized/leaves/fallingLeafPlaces.js';

test('each leaf is a seeded quad whose seeds switch on in order', () => {
  const geometry = createLeafGeometry(50, () => 0.5);
  assert.equal(geometry.index.count, 50 * 6);
  const seeds = geometry.attributes.leafSeed;
  assert.equal(seeds.count, 200);
  // All four corners of a leaf share its seed.
  for (let vertex = 1; vertex < 4; vertex += 1) assert.equal(seeds.getW(vertex), seeds.getW(0));
  const order = Array.from({ length: 50 }, (_, leaf) => seeds.getW(leaf * 4));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'amount reveals leaves in a fixed order');
});

test('only shedding canopy drops leaves, and never around an orbit camera', () => {
  const scene = new THREE.Scene();
  let tile = 6;
  const leaves = new FallingLeaves({
    scene,
    getTile: () => tile,
    getTileSize: () => 2,
    getOrigin: () => ({ x: 0, z: 0 }),
  });
  const camera = new THREE.PerspectiveCamera();
  for (let frame = 0; frame < 120; frame += 1) leaves.update(frame / 30, 1 / 30, camera, { x: 1, z: 0 });
  assert.ok(leaves.uniforms.amount.value > 0.8);
  assert.equal(leaves.mesh.visible, true);

  for (let frame = 0; frame < 300; frame += 1) leaves.update(4 + frame / 30, 1 / 30, camera, { x: 1, z: 0 }, false);
  assert.equal(leaves.mesh.visible, false, 'orbiting hides them');

  tile = 4;
  for (let frame = 0; frame < 300; frame += 1) leaves.update(14 + frame / 30, 1 / 30, camera, { x: 1, z: 0 });
  assert.equal(leaves.mesh.visible, false, 'grassland sheds nothing');
  leaves.dispose();
  assert.equal(scene.children.length, 0);
});

test('leaves follow woodland on shedding biomes, not meadows or town ground', () => {
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }, { x: 30, z: 0 }];
  const tiles = { 0: 6, 5: 6, 10: 8, 15: 4 }; // cell x -> tile id, tileSize 2
  const getTile = (cellX) => tiles[cellX];
  const base = { points, tileIds: [6, 8], getTile, tileSize: 2 };
  assert.equal(sheddingWoodlandShare(base), 0.75, 'no forest field: biome share alone');
  const forestField = { sample: (x) => ({ patchCoverage: x === 0 ? 1 : 0 }) };
  assert.equal(sheddingWoodlandShare({ ...base, forestField }), 0.25, 'a deciduous meadow sheds nothing');
  const planned = { plan: {} };
  const settlementField = {
    candidates: (cellX) => (cellX === 0 ? [planned] : []),
    cover: () => 1,
  };
  assert.equal(sheddingWoodlandShare({ ...base, forestField, settlementField }), 0, 'a town street sheds nothing');
  const unplanned = { ...settlementField, candidates: () => [{ plan: undefined }], cover: () => { throw new Error('planned a town'); } };
  assert.equal(sheddingWoodlandShare({ ...base, forestField, settlementField: unplanned }), 0.25, 'never plans a town');
  assert.equal(sheddingWoodlandShare({ ...base, points: [] }), 0);
});

test('a leaf inside a nearby building, below its roof, is sheltered', () => {
  // A 6 x 4 m house at plan (10, 2), turned 90 degrees, standing on a 5 m pad.
  const building = { x: 10, z: 2, width: 6, depth: 4, yaw: Math.PI / 2, pad: 5, kind: 'house', variant: 0 };
  const settlement = { cellX: 0, cellZ: 0 };
  const settlementField = {
    entriesNear: () => [{ entry: { settlement, plan: { buildings: [building] } } },
      { entry: { settlement, plan: undefined } }],
  };
  const shelters = collectLeafShelters({ settlementField, x: 0, z: 0, radius: 27, tileSize: 2 });
  assert.equal(shelters.length, 1, 'unplanned towns contribute nothing');
  const [house] = shelters;
  assert.equal(house.x, 10);
  assert.equal(house.z, -2, 'plan z runs opposite to canonical z');
  assert.ok(house.top > 5);
  // Turned a quarter, its 6 m width runs along canonical z and its 4 m depth along x.
  assert.equal(insideShelter(house, 10, 6, -2), true, 'the middle of the room');
  assert.equal(insideShelter(house, 10, 6, 1.2), true, 'under the eaves along its width');
  assert.equal(insideShelter(house, 12.6, 6, -2), false, 'beyond its depth');
  assert.equal(insideShelter(house, 10, house.top + 0.1, -2), false, 'above the roof');
  assert.deepEqual(collectLeafShelters({ settlementField, x: 200, z: 0, radius: 27, tileSize: 2 }), []);
});

test('the leaf shader builds with its shelter test in the vertex stage', async () => {
  const { lights } = await import('three/tsl');
  const renderer = new THREE.WebGPURenderer({ canvas: {
    width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {},
  } });
  renderer.hasFeature = () => false;
  renderer.hasCompatibility = () => true;
  renderer.backend.capabilities.getUniformBufferLimit = () => 65536;
  renderer._bindings = { getSharedBindGroup: group => group }; // set by init(), which needs a device
  const leaves = new FallingLeaves({ scene: new THREE.Scene(), getTile: () => 6, getTileSize: () => 2, getOrigin: () => ({ x: 0, z: 0 }) });
  const builder = renderer.backend.createNodeBuilder(leaves.mesh, renderer);
  builder.camera = new THREE.PerspectiveCamera();
  builder.scene = new THREE.Scene();
  builder.lightsNode = lights([]);
  builder.build();
  assert.match(builder.vertexShader, /@vertex/);
  assert.doesNotMatch(builder.vertexShader, /\b(?:NaN|undefined)\b/);
  assert.equal(leaves.material.userData.leafTexture?.isTexture, true, 'readable');
  assert.equal(JSON.stringify(leaves.material.userData), '{}', 'never serialized by a clone');
  leaves.dispose();
});
