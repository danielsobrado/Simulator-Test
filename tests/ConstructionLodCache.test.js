import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three/webgpu';
import { ConstructionLodCache } from '../src/editor/construction/render/ConstructionLodCache.js';
import { ConstructionModuleBuilder } from '../src/editor/construction/render/ConstructionModuleBuilder.js';
import { encodeConstructionGeometry } from '../src/editor/construction/compile/ConstructionGeometryCodec.js';

test('LOD cache bounds detached geometry, transfers ownership on hits and invalidates local owners', () => {
  const root = new Group(), material = new MeshBasicMaterial(), disposed = new Map();
  let materialDisposals = 0;
  material.addEventListener('dispose', () => materialDisposals++);
  const product = () => {
    const geometry = new BoxGeometry(), mesh = new Mesh(geometry, material);
    geometry.addEventListener('dispose', () => disposed.set(mesh, (disposed.get(mesh) ?? 0) + 1));
    root.add(mesh);
    return { meshes: [mesh], stats: { totalTriangles: 12, growthTriangles: 0 }, placements: [] };
  };
  const first = product(), second = product(), third = product();
  const cache = new ConstructionLodCache({ maxEntries: 2 });
  cache.put('a', 'wall-a', 'module-a', first);
  cache.put('b', 'wall-b', 'module-b', second);
  assert.equal(first.meshes[0].parent, null);
  assert.equal(second.meshes[0].parent, null);
  assert.ok(cache.bytes > 0);
  cache.put('c', 'wall-b', 'module-c', third);
  assert.equal(disposed.get(first.meshes[0]), 1);
  assert.equal(cache.take('a'), null);
  assert.equal(cache.take('b'), second);
  cache.invalidate('wall-b', 'module-c');
  assert.equal(disposed.get(third.meshes[0]), 1);
  assert.equal(disposed.has(second.meshes[0]), false, 'taken geometry belongs to its caller');
  assert.equal(cache.bytes, 0);
  const oversized = product();
  const zero = new ConstructionLodCache({ maxBytes: 0 });
  zero.put('large', 'wall-a', 'module-a', oversized);
  assert.equal(zero.entries.size, 0); assert.equal(zero.bytes, 0);
  assert.equal(disposed.get(oversized.meshes[0]), 1);
  second.meshes[0].geometry.dispose(); cache.clear(); zero.clear();
  assert.equal(materialDisposals, 0, 'cache never owns shared materials');
  material.dispose();
});

test('cached masonry bypasses workers, retains growth and is disposed on cancellation', () => {
  const material = new MeshBasicMaterial(), geometry = new BoxGeometry(), growthGeometry = new BoxGeometry();
  const stone = new Mesh(geometry, material), growth = new Mesh(growthGeometry, material);
  growth.userData.constructionGrowthLeaves = 1;
  const builder = new ConstructionModuleBuilder({ terrainView: {}, geometryWorker: {
    available: true, request: () => assert.fail('cached masonry and retained growth need no worker'), dispose() {} } });
  const options = { record: {}, placements: [{}], materials: { growth: material }, lodBand: 'coarse',
    retainedGrowth: growth, cachedMasonry: { meshes: [stone], stats: { totalTriangles: 12 } } };
  const state = builder.createState(options);
  const result = builder.advance(state);
  assert.equal(result.done, true);
  assert.deepEqual(result.built.meshes, [stone, growth]);
  assert.equal(growth.castShadow, false);
  assert.equal(result.built.stats.totalTriangles, 24);
  let disposals = 0;
  geometry.addEventListener('dispose', () => disposals++);
  builder.dispose(state);
  assert.equal(disposals, 0, 'completed geometry belongs to the resident');
  const cancelled = builder.createState({ ...options, cachedMasonry: { meshes: [stone] } });
  builder.dispose(cancelled); builder.dispose(cancelled);
  assert.equal(disposals, 1);
  growthGeometry.dispose(); material.dispose(); builder.shutdown();
});

test('a cached tier combines freshly returned worker growth with the original masonry', () => {
  const material = new MeshBasicMaterial(), geometry = new BoxGeometry(), growthGeometry = new BoxGeometry();
  const stone = new Mesh(geometry, material), growth = new Mesh(growthGeometry, material);
  growth.userData.constructionMaterialSlot = 'growth';
  growth.userData.constructionGrowthLeaves = 1;
  const builder = new ConstructionModuleBuilder({ terrainView: {}, geometryWorker: {
    available: true, request: () => assert.fail('worker response is already ready'), dispose() {} } });
  const state = builder.createState({ record: {}, placements: [{}], materials: { growth: material },
    cachedMasonry: { meshes: [stone], stats: { totalTriangles: 12 } } });
  state.workerProduct = encodeConstructionGeometry({ meshes: [growth], stats: { totalTriangles: 12 } });
  const result = builder.advance(state);
  assert.equal(state.growthOnly, true);
  assert.equal(result.done, true);
  assert.equal(result.built.meshes[0], stone);
  assert.equal(result.built.meshes[1].userData.constructionMaterialSlot, 'growth');
  assert.equal(result.built.stats.totalTriangles, 24);
  assert.equal(state.cachedMasonry, null);
  builder.dispose(state);
  for (const mesh of result.built.meshes) mesh.geometry.dispose();
  growthGeometry.dispose(); material.dispose(); builder.shutdown();
});
