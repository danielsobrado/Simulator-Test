import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { installVariants } from '../src/editor/stylized/VariantInstallation.js';
import { StylizedRockView } from '../src/editor/stylized/StylizedRockView.js';
import { StylizedBushView } from '../src/editor/stylized/StylizedBushView.js';
import { StylizedGroundDetailView } from '../src/editor/stylized/StylizedGroundDetailView.js';
import { StylizedVariantResidency } from '../src/editor/stylized/StylizedVariantResidency.js';

function fixture(t, kind) {
  const config = yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8')).stylizedSurface;
  config.rocks.perChunk = 1; config.bushes.perChunk = 1;
  const terrainView = { scene: new THREE.Scene(), getCanonicalHeight: () => 0,
    worldStore: { chunkSize: 64, tileSize: 2, generatorConfig: { seed: 7 } } };
  const options = { config, terrainView, revisionTracker: { signature: () => '' } };
  const create = () => kind === 'rock' ? new StylizedRockView(options)
    : kind === 'bush' ? new StylizedBushView(options)
      : new StylizedGroundDetailView({ ...options, layerName: 'groundDetail', priorityChannel: 41,
        layerConfig: { enabled: true, residentRadius: 0, perChunk: 1, castShadow: false } });
  const view = create(), reference = create();
  const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `part${i}`;
    mesh.position.set(i * 3, i, 0); scene.add(mesh);
  }
  const variants = [{ scene, definition: { id: 'test', scene: 'test.glb', scale: 1, tileIds: [4],
    prototypeGroups: [['part0'], ['part1', 'part2']] } }];
  t.after(() => { view.dispose(); reference.dispose(); geometry.dispose(); material.dispose(); });
  return { view, reference, variants, geometry };
}

for (const kind of ['rock', 'bush', 'detail']) test(`${kind} installation yields and publishes unchanged geometry and registries atomically`, t => {
  const { view, reference, variants } = fixture(t, kind);
  reference.appendVariants(variants);
  const arrays = [view.prototypes, view.meshes, view.prototypeBiomeRules];
  const job = installVariants(view, variants);
  let steps = 0;
  for (;;) {
    const result = job.next(); steps++;
    if (result.done) break;
    assert.equal(view.prototypes.length, 0);
    assert.equal(view.meshes.length, 0);
    assert.equal(view.root.children.length, 0);
    assert.equal(view.prototypeIndicesByAsset.size, 0);
    assert.ok(steps < 200);
  }
  assert.ok(steps > 10);
  assert.equal(view.prototypes, arrays[0]); assert.equal(view.meshes, arrays[1]);
  assert.equal(view.prototypeBiomeRules, arrays[2]);
  assert.equal(view.prototypes.length, reference.prototypes.length);
  assert.deepEqual(view.prototypeBiomeRules, reference.prototypeBiomeRules);
  assert.deepEqual(view.prototypeIndicesByAsset, reference.prototypeIndicesByAsset);
  assert.equal(view.root.children.length, reference.root.children.length);
  const parts = value => value.flatMap(part => Array.isArray(part) ? part : [part]);
  const actual = parts(view.prototypes), expected = parts(reference.prototypes);
  for (let i = 0; i < actual.length; i++) {
    for (const name of Object.keys(expected[i].geometry.attributes)) {
      assert.deepEqual(actual[i].geometry.attributes[name].array, expected[i].geometry.attributes[name].array);
    }
    assert.equal(actual[i].material.alphaTest, expected[i].material.alphaTest);
    assert.equal(actual[i].material.side, expected[i].material.side);
  }
});

test('bush instance rows shade beneath canopy and retain open-ground brightness without a forest field', t => {
  const { view } = fixture(t, 'bush');
  const placement = { x: 16, z: -12, height: 0, rotationY: 0, scale: 1, priority: 0.5, tileId: 6 };
  view.forestFieldProvider = () => ({ sample: (x, z) => {
    assert.deepEqual([x, z], [16, -12]);
    return { patchCoverage: 1 };
  } });
  const shaded = view.instanceRows.placementRows(placement).appearance;
  assert.equal(shaded.seed, 0.5);
  assert.equal(shaded.colorVariation, 0.72);
  view.forestFieldProvider = null;
  assert.equal(view.instanceRows.placementRows({ ...placement }).appearance.colorVariation, 1);
});

test('cancelled installation disposes extracted geometry without changing the live view', t => {
  const { view, variants } = fixture(t, 'rock');
  const created = [], clone = THREE.BufferGeometry.prototype.clone;
  t.mock.method(THREE.BufferGeometry.prototype, 'clone', function () {
    const geometry = clone.call(this);
    const record = { geometry, disposed: false };
    geometry.addEventListener('dispose', () => { record.disposed = true; });
    created.push(record); return geometry;
  });
  const job = installVariants(view, variants);
  for (let step = 0; step < 10; step++) job.next();
  assert.ok(created.length);
  job.return();
  assert.ok(created.every(record => record.disposed));
  assert.equal(view.prototypes.length, 0);
  assert.equal(view.root.children.length, 0);
});

test('variant residency retains an unfinished job across deadlines and cancels it on disposal', () => {
  let steps = 0, published = false, closed = false;
  const layer = { id: 'test', *apply() {
    try { for (let i = 0; i < 5; i++) { steps++; yield; } published = true; return []; }
    finally { closed = true; }
  } };
  const residency = new StylizedVariantResidency({ terrainView: {}, layers: [layer] });
  residency.pendingApplies.push({ layer, definition: { scene: 'test.glb' }, scene: {}, id: 'test|test' });
  let deadline = 2;
  residency.pumpApplies(() => steps >= deadline);
  assert.equal(steps, 2); assert.equal(published, false);
  assert.equal(residency.getPreparationStatus().pending, 1);
  deadline = 4;
  residency.pumpApplies(() => steps >= deadline);
  assert.equal(steps, 4); assert.equal(published, false);
  residency.dispose();
  assert.equal(closed, true); assert.equal(published, false);
  assert.equal(residency.getPreparationStatus().pending, 0);
});

test('failed material extraction leaves the live registry and existing renderers intact', t => {
  const { view, variants } = fixture(t, 'detail');
  view.appendVariants(variants);
  const prototypes = view.prototypes.slice(), meshes = view.meshes.slice();
  const indices = new Map(view.prototypeIndicesByAsset);
  const broken = { ...variants[0], definition: { ...variants[0].definition, id: 'broken' } };
  broken.scene.children[2].material = null;
  const job = installVariants(view, [broken]);
  assert.throws(() => { while (!job.next().done) { /* exercise all pre-publication slices */ } }, /without a material/);
  assert.deepEqual(view.prototypes, prototypes);
  assert.deepEqual(view.meshes, meshes);
  assert.deepEqual(view.prototypeIndicesByAsset, indices);
  assert.equal(view.root.children.length, meshes.flat().length);
});
