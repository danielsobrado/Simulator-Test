import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { disposeConstructionMaterials } from '../src/editor/construction/render/ConstructionMaterials.js';
import { ConstructionView } from '../src/editor/construction/render/ConstructionView.js';
import { MODULE_STAT_KEYS } from '../src/editor/construction/render/ConstructionModuleStats.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';
import { advanceConstructionFrames } from './helpers/constructionFrames.js';

const VIEWPORT_HEIGHT = 600;

function wallRecord() {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'rounded-fieldstone', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat' },
    path: createCubicBezierPathFromStroke([[0, 0], [12, 0], [24, 0], [36, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

function createTerrainView() {
  return {
    scene: new THREE.Scene(),
    floatingOrigin: new FloatingOrigin({ threshold: 1024, snapSize: 128 }),
    getCanonicalHeight: () => 0,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: VIEWPORT_HEIGHT }),
      },
    },
  };
}

/** A camera at medium range: the middle module is near, the outer ones coarse. */
function coarseCamera() {
  const camera = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 1000);
  camera.position.set(18, 2, 30);
  camera.lookAt(18, 1.5, 0);
  camera.updateMatrixWorld();
  return camera;
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('modules the LOD sends to another band while queued still get built', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({ terrainView: createTerrainView(), store, compilerClient: null });
  const record = wallRecord();
  store.add(record);
  const plan = planConstruction(record);
  assert.ok(plan.modules.length >= 3, 'fixture needs several modules');
  view.applyPlan(record, plan);

  const camera = coarseCamera();
  // The frame loop's order: drain one build, then classify.
  advanceConstructionFrames(view, { camera, viewportHeight: VIEWPORT_HEIGHT });

  const residents = [...view.entries.get(record.id).modules.values()];
  // The scenario: jobs queued as `near` that the LOD reclassified before
  // their turn came.
  assert.ok(residents.some((resident) => resident.requestedBand === 'coarse'));
  for (const resident of residents) {
    assert.equal(resident.builtBand, resident.requestedBand);
    assert.equal(resident.meshes.length, 2);
    assert.ok(resident.meshes.every((mesh) => mesh.visible));
  }
  assert.equal(view.stats.queueDepth, 0);
  view.dispose();
});

test('a wall first seen from afar gets its masonry when the camera comes close', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({ terrainView: createTerrainView(), store, compilerClient: null, residencyRadius: 1024 });
  const record = wallRecord();
  store.add(record);
  const plan = planConstruction(record);
  view.applyPlan(record, plan);

  const distant = new THREE.PerspectiveCamera(60, 800 / VIEWPORT_HEIGHT, 0.1, 5000);
  distant.position.set(18, 20, 900);
  distant.lookAt(18, 1.5, 0);
  distant.updateMatrixWorld();
  advanceConstructionFrames(view, { camera: distant, viewportHeight: VIEWPORT_HEIGHT });
  const residents = [...view.entries.get(record.id).modules.values()];
  // A resumable slice starts before classification; the far classification
  // cancels it and keeps each module's shell resident.
  const far = residents.filter((resident) => resident.requestedBand === 'shell');
  assert.ok(far.length >= 2);
  assert.ok(far.every((resident) => resident.meshes.length === 0));

  const near = coarseCamera();
  advanceConstructionFrames(view, { camera: near, viewportHeight: VIEWPORT_HEIGHT });
  for (const resident of residents) {
    assert.notEqual(resident.requestedBand, 'shell');
    assert.equal(resident.builtBand, resident.requestedBand);
    assert.equal(resident.meshes.length, 2);
    assert.equal(resident.shellMesh.visible, false);
  }
  view.dispose();
});

test('pure LOD changes retain ivy while terrain and authored changes rebuild it', () => {
  const store = new ConstructionStore();
  const terrainView = createTerrainView();
  terrainView.worldStore = { revision: 1 };
  const view = new ConstructionView({ terrainView, store, compilerClient: null });
  const record = normalizeConstructionRecord({ ...wallRecord(), seed: 3141,
    style: { key: 'glade-sandstone', version: 1 } });
  store.add(record);
  const plan = planConstruction(record);
  view.applyPlan(record, plan);
  const entry = view.entries.get(record.id);
  advanceConstructionFrames(view);
  const module = plan.modules.find(m => entry.modules.get(m.id).meshes.some(mesh =>
    mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.GROWTH));
  assert.ok(module, 'fixture includes an occupied growth patch');
  const resident = entry.modules.get(module.id);
  const growth = () => resident.meshes.find(mesh => mesh.userData.constructionMaterialSlot === CONSTRUCTION_MATERIAL_SLOT.GROWTH);
  const original = growth();
  let disposals = 0;
  original.geometry.addEventListener('dispose', () => { disposals += 1; });
  const rebuild = band => {
    view.enqueueModuleBuild(record.id, module, band);
    advanceConstructionFrames(view);
  };
  rebuild('coarse');
  assert.equal(growth(), original);
  assert.equal(disposals, 0);
  assert.equal(original.castShadow, false);
  assert.equal(resident.stats.totalTriangles, resident.stats.stoneTriangles + resident.stats.mortarTriangles + resident.stats.growthTriangles);
  rebuild('near');
  assert.equal(growth(), original);
  assert.equal(original.castShadow, true);
  terrainView.worldStore.revision += 1;
  rebuild('coarse');
  assert.notEqual(growth(), original);
  assert.equal(disposals, 1);
  const afterTerrain = growth();
  entry.record = normalizeConstructionRecord({ ...record, seed: 456, revision: 2 });
  rebuild('near');
  assert.notEqual(growth(), afterTerrain);
  view.dispose();
});

test('LOD revisits reuse exact masonry while terrain, edits and retirement release stale products', () => {
  const store = new ConstructionStore(), terrainView = createTerrainView();
  terrainView.worldStore = { revision: 1 };
  const view = new ConstructionView({ terrainView, store, compilerClient: null });
  try {
    const record = wallRecord(); store.add(record);
    const plan = planConstruction(record); view.applyPlan(record, plan);
    advanceConstructionFrames(view);
    const entry = view.entries.get(record.id), module = plan.modules[0];
    const resident = entry.modules.get(module.id);
    const masonry = () => resident.meshes.filter(mesh => mesh.userData.constructionMaterialSlot !== CONSTRUCTION_MATERIAL_SLOT.GROWTH);
    const near = masonry();
    const before = view.stats.nearBuilds;
    let disposals = 0;
    for (const mesh of near) mesh.geometry.addEventListener('dispose', () => disposals++);
    // A shell visit hides the retained tier before it gets cached.
    for (const mesh of near) mesh.visible = false;
    view.enqueueModuleBuild(record.id, module, 'coarse'); advanceConstructionFrames(view);
    assert.equal(disposals, 0);
    assert.ok(near.every(mesh => mesh.parent === null));
    view.enqueueModuleBuild(record.id, module, 'near'); advanceConstructionFrames(view);
    assert.deepEqual(masonry(), near);
    assert.ok(near.every(mesh => mesh.parent === entry.group && mesh.visible));
    assert.equal(view.stats.nearBuilds, before);
    assert.equal(view.stats.lodCacheHits, 1);
    assert.ok(view.lodCache.bytes <= view.lodCache.maxBytes);
    view.enqueueModuleBuild(record.id, module, 'coarse'); advanceConstructionFrames(view);
    assert.equal(view.stats.lodCacheHits, 2);
    terrainView.worldStore.revision++;
    view.enqueueModuleBuild(record.id, module, 'near'); advanceConstructionFrames(view);
    assert.notEqual(masonry()[0].geometry, near[0].geometry, 'terrain revision cannot resurrect stale geometry');
    assert.equal(view.stats.lodCacheHits, 2);
    view.enqueueModuleBuild(record.id, module, 'coarse'); advanceConstructionFrames(view);
    const edited = normalizeConstructionRecord({ ...record, revision: 2, seed: 77 });
    view.upsertRecord(edited, { decorationOnly: true });
    assert.equal(view.lodCache.entries.size, 0, 'authored edits invalidate detached products');
    view.removeRecord(record.id);
    assert.equal(view.lodCache.entries.size, 0);
    assert.equal(view.lodCache.bytes, 0);
    assert.equal(disposals, near.length, 'old cached geometry is released once');
  } finally { view.dispose(); }
});

test('module publication leaves unrelated statistics alone and retirement removes its contribution', () => {
  const store = new ConstructionStore();
  const view = new ConstructionView({ terrainView: createTerrainView(), store, compilerClient: null });
  try {
    const record = wallRecord();
    store.add(record);
    const plan = planConstruction(record);
    view.applyPlan(record, plan);
    advanceConstructionFrames(view);
    const entry = view.entries.get(record.id);
    assert.ok(entry.modules.size >= 3);
    view.setSelection(record.id);
    const module = plan.modules[0];
    const resident = entry.modules.get(module.id);
    let unrelatedReads = 0;
    for (const [id, other] of entry.modules) {
      if (id === module.id) continue;
      const stats = other.stats;
      Object.defineProperty(other, 'stats', { configurable: true,
        get() { unrelatedReads++; return stats; } });
    }
    view.enqueueModuleBuild(record.id, module, 'coarse');
    advanceConstructionFrames(view);
    assert.equal(unrelatedReads, 0, 'one publication must not recount every other module');
    assert.equal(resident.builtBand, 'coarse');
    assert.equal(entry.shellMesh.visible, false);
    assert.equal(resident.shellMesh.visible, false);
    for (const mesh of resident.meshes) {
      const slot = mesh.userData.constructionMaterialSlot;
      if (slot === CONSTRUCTION_MATERIAL_SLOT.STONE) assert.equal(mesh.material, entry.materials.stoneSelected);
      if (slot === CONSTRUCTION_MATERIAL_SLOT.MORTAR) assert.equal(mesh.material, entry.materials.mortar);
    }
    const checkTotals = () => {
      for (const key of MODULE_STAT_KEYS) {
        let expected = 0;
        for (const other of entry.modules.values()) expected += other.stats?.[key] ?? 0;
        assert.ok(Math.abs(view.stats[key] - expected) < 1e-6, `${key} matches resident contributions`);
      }
    };
    checkTotals();
    view.applyPlan(record, { ...plan, modules: plan.modules.slice(1) });
    assert.equal(entry.modules.has(module.id), false);
    checkTotals();
    view.removeRecord(record.id);
    for (const key of MODULE_STAT_KEYS) assert.ok(Math.abs(view.stats[key]) < 1e-6, `${key} clears on removal`);
  } finally {
    view.dispose();
  }
});
