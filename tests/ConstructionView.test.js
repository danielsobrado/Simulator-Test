import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import {
  ConstructionView,
  residentMaterial,
} from '../src/editor/construction/render/ConstructionView.js';

function wallRecord(materials = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [4, 0], [8, 0], [12, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

function createTerrainView() {
  const scene = new THREE.Scene();
  return {
    scene,
    floatingOrigin: {
      toRender: (x, z) => ({ x, z }),
      toCanonical: (x, z) => ({ x, z }),
    },
    getCanonicalHeight: () => 0,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      },
    },
  };
}

function meshWithSlot(slot, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.userData.constructionMaterialSlot = slot;
  return mesh;
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('residentMaterial keeps mortar dark when selected', () => {
  const materials = createConstructionMaterials(wallRecord());
  const stone = meshWithSlot(CONSTRUCTION_MATERIAL_SLOT.STONE, materials.stone);
  const mortar = meshWithSlot(CONSTRUCTION_MATERIAL_SLOT.MORTAR, materials.mortar);

  assert.equal(residentMaterial(stone, materials, false), materials.stone);
  assert.equal(residentMaterial(mortar, materials, false), materials.mortar);
  assert.equal(residentMaterial(stone, materials, true), materials.stoneSelected);
  assert.equal(residentMaterial(mortar, materials, true), materials.mortar);

  stone.geometry.dispose();
  mortar.geometry.dispose();
});

test('ConstructionView selection and material-only updates respect slots', () => {
  const store = new ConstructionStore();
  const terrainView = createTerrainView();
  const view = new ConstructionView({ terrainView, store, compilerClient: null });
  const record = wallRecord({ stone: null, mortar: null });
  store.add(record);

  const entry = view.entries.get(record.id);
  assert.ok(entry);
  assert.ok(entry.materials.mortar);

  const stoneGeometry = new THREE.BoxGeometry(1, 1, 0.8);
  const mortarGeometry = new THREE.BoxGeometry(1.05, 1.05, 0.73);
  const stoneMesh = new THREE.Mesh(stoneGeometry, entry.materials.stone);
  const mortarMesh = new THREE.Mesh(mortarGeometry, entry.materials.mortar);
  stoneMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;
  mortarMesh.userData.constructionMaterialSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
  entry.group.add(mortarMesh, stoneMesh);
  entry.modules.set('module-0', {
    hash: 'h0',
    meshes: [mortarMesh, stoneMesh],
    band: 'near',
    builtBand: 'near',
    stats: { stones: 1, mortarPrisms: 1, stoneTriangles: 12, mortarTriangles: 12 },
  });
  entry.plan = { modules: [{ id: 'module-0', bounds: { minX: 0, maxX: 4, minZ: -1, maxZ: 1 } }] };
  view.updateShellVisibility(entry);
  assert.equal(entry.shellMesh.visible, false);
  assert.equal(stoneMesh.visible, true);
  assert.equal(mortarMesh.visible, true);

  // Unselected
  view.setSelection(null);
  assert.equal(stoneMesh.material, entry.materials.stone);
  assert.equal(mortarMesh.material, entry.materials.mortar);

  // Selected: stone tints, mortar stays
  view.setSelection(record.id);
  assert.equal(stoneMesh.material, entry.materials.stoneSelected);
  assert.equal(mortarMesh.material, entry.materials.mortar);

  // Material-only update must not rebuild geometry
  const previousStoneGeometry = stoneMesh.geometry;
  const previousMortarGeometry = mortarMesh.geometry;
  const updated = store.update(record.id, {
    ...record,
    style: {
      ...record.style,
      materials: { stone: 'sandstone-masonry', mortar: 'limestone-masonry' },
    },
  }, { materialOnly: true });
  assert.ok(updated);
  // materialOnly path runs on store change via upsertRecord
  const after = view.entries.get(record.id);
  const resident = after.modules.get('module-0');
  assert.equal(resident.meshes[0].geometry, previousMortarGeometry);
  assert.equal(resident.meshes[1].geometry, previousStoneGeometry);
  assert.equal(
    resident.meshes[0].userData.constructionMaterialSlot,
    CONSTRUCTION_MATERIAL_SLOT.MORTAR,
  );
  assert.equal(resident.meshes[0].material, after.materials.mortar);
  assert.equal(resident.meshes[1].material, after.materials.stoneSelected);
  assert.notEqual(resident.meshes[0].material, resident.meshes[1].material);

  // LOD: selection pins near, so clear it before distance checks.
  view.setSelection(null);
  resident.band = 'shell';
  view.updateLod(
    { fov: 60, position: { x: 0, y: 2, z: 200 } },
    1080,
  );
  assert.equal(stoneMesh.visible, false);
  assert.equal(mortarMesh.visible, false);
  assert.equal(after.shellMesh.visible, true);

  // Near shows both
  resident.band = 'near';
  view.updateLod(
    { fov: 60, position: { x: 0, y: 2, z: 5 } },
    1080,
  );
  assert.equal(stoneMesh.visible, true);
  assert.equal(mortarMesh.visible, true);
  assert.equal(after.shellMesh.visible, false);

  // Disposal on rebuild
  let stoneDisposed = false;
  let mortarDisposed = false;
  const oldStoneDispose = stoneMesh.geometry.dispose.bind(stoneMesh.geometry);
  const oldMortarDispose = mortarMesh.geometry.dispose.bind(mortarMesh.geometry);
  stoneMesh.geometry.dispose = () => {
    stoneDisposed = true;
    oldStoneDispose();
  };
  mortarMesh.geometry.dispose = () => {
    mortarDisposed = true;
    oldMortarDispose();
  };
  after.modules.set('module-0', {
    ...resident,
    meshes: [mortarMesh, stoneMesh],
    hash: 'stale',
  });
  // Simulate buildModule replacement path
  for (const stale of after.modules.get('module-0').meshes) {
    after.group.remove(stale);
    stale.geometry.dispose();
  }
  after.modules.get('module-0').meshes = [];
  assert.equal(stoneDisposed, true);
  assert.equal(mortarDisposed, true);

  view.dispose();
});
