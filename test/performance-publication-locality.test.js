import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Matrix4, MeshBasicMaterial, Scene, Mesh, BufferGeometry, BufferAttribute } from 'three/webgpu';
import { ObjectView } from '../src/editor/ObjectView.js';
import { StreamedDrawPreparation } from '../src/render/preparation/StreamedDrawPreparation.js';
import { MeadowBandBatch } from '../src/editor/stylized/meadow/MeadowBandBatch.js';
import { createMeadowTemplate } from '../src/editor/stylized/meadow/meadowGrassGeometry.js';
import { prepareSurfaceJob } from '../src/editor/world/settlements/view/SettlementPreparationJobs.js';
import { settlementPlacements, settlementPlacementsJob } from '../src/editor/world/settlements/view/SettlementPlacements.js';
import { drainJob } from '../src/editor/world/settlements/SettlementArrayJobs.js';

test('one object edit preserves unrelated matrices and only marks the changed instance', () => {
  let objects = [];
  const catalog = ['a', 'b'].map(key => ({ key, asset: true, foundation: { mode: 'none' } }));
  const map = { revision: 0, list: () => objects.map(object => ({ ...object })) };
  const view = new ObjectView({ terrainView: { scene: new Scene(), floatingOrigin: { getState: () => ({ x: 0, z: 0 }) } },
    tileMap: { tileSize: 2 }, heightField: {}, objectMap: map, objectCatalog: catalog });
  const geometries = [], materials = [];
  view.resolvePlacement = () => ({ surface: { foundationDepth: 0 } });
  view.createObjectMatrix = object => new Matrix4().makeTranslation(object.x, 0, object.z);
  objects = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, x: i, z: 0, rotation: 0, definitionKey: i < 10 ? 'a' : 'b' }));
  try {
    for (const definition of catalog) {
      const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
      geometries.push(geometry); materials.push(material);
      view.registerDefinition(definition, [{ geometry, material, matrix: new Matrix4() }]);
    }
    const a = view.renderers.get('a').meshes[0], b = view.renderers.get('b').meshes[0];
    a.instanceMatrix.clearUpdateRanges(); b.instanceMatrix.clearUpdateRanges();
    const bVersion = b.instanceMatrix.version;
    objects = objects.map(object => object.id === 5 ? { ...object, x: 100 } : object); map.revision++;
    view.refreshAll();
    assert.deepEqual(a.instanceMatrix.updateRanges, [{ start: 4 * 16, count: 16 }]);
    assert.equal(b.instanceMatrix.version, bVersion);
    objects = Array.from({ length: 64 }, (_, i) => ({ id: i + 1, x: i, z: 0, rotation: 0, definitionKey: 'a' }));
    const staged = [], prepared = new WeakSet();
    view.terrainView.drawPreparation = { settings: { enabled: true }, prepared, register: mesh => staged.push(mesh) };
    map.revision++; view.refreshAll();
    assert.equal(a.count, 10, 'previous complete publication remains while replacement is staged');
    assert.equal(view.pendingObjectUpdates.size, 1);
    view.advancePreparation(() => false);
    assert.equal(a.count, 10, 'uncompiled replacement capacity cannot hide the old draw');
    assert.ok(a.parent, 'old complete buffers remain attached during warmup');
    assert.equal(view.pendingObjectUpdates.size, 1);
    for (const mesh of staged) prepared.add(mesh);
    view.advancePreparation(() => false);
    const grown = view.renderers.get('a').meshes[0];
    assert.equal(grown.count, 64);
    view.createObjectMatrix = object => new Matrix4().makeTranslation(object.x, 7, object.z);
    view.dirtyPlacements.add(5); view.refreshAll(); view.advancePreparation(() => false);
    assert.equal(grown.instanceMatrix.array[4 * 16 + 13], 7, 'terrain invalidation survives deferred scheduling');
    assert.equal(grown.instanceMatrix.array[5 * 16 + 13], 0, 'unrelated placement was retained');
    objects = []; map.revision++; view.refreshAll();
    assert.equal(grown.count, 0); assert.equal(b.count, 0);
  } finally { view.dispose(); for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose(); }
});

test('draw registration never visits unrelated prepared scene roots', () => {
  const scene = new Scene(), geometry = new BoxGeometry(), material = new MeshBasicMaterial();
  for (let i = 0; i < 1000; i++) scene.add(new Mesh(geometry, material));
  const prep = new StreamedDrawPreparation({ scene, settings: { enabled: true } });
  prep.markInitialScene();
  scene.traverse = () => { throw new Error('whole-scene discovery'); };
  for (let i = 0; i < 100; i++) { const mesh = new Mesh(geometry, material); scene.add(mesh); prep.register(mesh); }
  assert.equal(prep.pending.size, 100);
  prep.dispose(); geometry.dispose(); material.dispose();
});

test('equal-size retirement rewrites one tail tile without fragmented or empty draws', () => {
  const template = createMeadowTemplate({ count: 4096, detail: 2, tileSize: 8 });
  const material = new MeshBasicMaterial();
  const page = new MeadowBandBatch({ scene: new Scene(), template, material, name: 'retirement' });
  const tiles = Array.from({ length: 16 }, (_, i) => ({ renderX: i * 8, renderZ: 0, buildId: 1,
    output: { count: 4096, position: new Float32Array(16384).fill(i),
      rotation: new Float32Array(8192).fill(i), data: new Float32Array(16384).fill(i) } }));
  page.update(tiles);
  for (const attr of Object.values(page.geometry.attributes)) attr.clearUpdateRanges();
  page.update(tiles.slice(1));
  let bytes = 0;
  for (const name of ['instancePosition', 'instanceRotation', 'instanceData', 'instanceTile']) {
    const attr = page.geometry.getAttribute(name);
    bytes += attr.updateRanges.reduce((sum, range) => sum + range.count * 4, 0);
  }
  assert.equal(bytes, 4096 * 56);
  assert.equal(page.geometry.instanceCount, 15 * 4096);
  assert.equal(page.slots.size, 15);
  for (const tile of tiles.slice(1)) {
    const slot = page.slots.get(tile);
    const [{ start, count }] = slot.ranges;
    assert.deepEqual(page.geometry.getAttribute('instancePosition').array.subarray(start * 4, (start + count) * 4), tile.output.position);
  }
  page.dispose(); template.dispose(); material.dispose();
});

test('sliced normals and bounds equal Three and placements yield before all samples', () => {
  const source = new BoxGeometry(5, 3, 2, 8, 8, 8);
  const arrays = { positions: source.attributes.position.array.slice(), indices: source.index.array.slice() };
  const reference = new BufferGeometry(); reference.setAttribute('position', new BufferAttribute(arrays.positions, 3));
  reference.setIndex(new BufferAttribute(arrays.indices, 1)); reference.computeVertexNormals(); reference.computeBoundingSphere();
  drainJob(prepareSurfaceJob(arrays, true));
  assert.deepEqual(arrays.normals, reference.attributes.normal.array);
  assert.deepEqual(arrays.boundingSphere, reference.boundingSphere);
  const plan = { profile: { style: { key: 'review' } }, buildings: [],
    props: Array.from({ length: 1000 }, (_, i) => ({ kind: 'bench', variant: 0, x: i, z: 0, yaw: 0 })) };
  let samples = 0;
  const job = settlementPlacementsJob({ id: 1, cellX: 0, cellZ: 0 }, plan, 2, () => { samples++; return 3; });
  assert.equal(job.next().done, false); assert.equal(samples, 16);
  const result = drainJob(job);
  assert.deepEqual(result, settlementPlacements({ id: 1, cellX: 0, cellZ: 0 }, plan, 2, () => 3));
  source.dispose(); reference.dispose();
});
