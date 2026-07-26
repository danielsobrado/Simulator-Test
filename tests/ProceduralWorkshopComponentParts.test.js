import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';

function recipe(overrides = {}) {
  return {
    archetype: 'manor',
    style: 'limestone',
    topStyle: 'slate',
    finish: 'ochre',
    shape: 'stepped',
    towerSide: 'left',
    width: 8,
    depth: 2.5,
    height: 5.5,
    roofScale: 1.15,
    roofOverhang: 0.45,
    seed: 1848,
    detail: 2,
    weathering: 0.35,
    windows: true,
    ivy: true,
    remesh: true,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

function boundsForParts(parts, predicate = () => true) {
  const root = new THREE.Group();
  for (const part of parts.filter(predicate)) {
    const mesh = new THREE.Mesh(part.geometry, part.material);
    part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
    root.add(mesh);
  }
  return new THREE.Box3().setFromObject(root);
}

function slotBounds(parts, slot) {
  return boundsForParts(parts, (part) => part.material.userData.workshopSlot === slot);
}

test('workshop preview exposes semantic components with structure ownership', () => {
  const parts = createProceduralWorkshopComponentParts(recipe(), { preserveComponents: true });
  try {
    const components = new Map(parts.components.map((component) => [component.id, component]));
    assert.ok(components.has('structure-main'));
    assert.ok([...components.values()].some((component) => component.kind === 'roof'));
    assert.ok([...components.values()].some((component) => component.kind === 'door'));
    assert.ok([...components.values()].some((component) => component.kind === 'window'));
    assert.ok([...components.values()].some((component) => (
      component.label.toLowerCase().includes('climbing ivy')
    )));
    assert.ok(parts.every((part) => part.component?.id));
    assert.equal(parts.stats.components, components.size);
    assert.ok(parts.materialRegions.length > 0);
    assert.equal(parts.stats.materialRegions, parts.materialRegions.length);
    assert.ok(parts.every((part) => part.materialRegion?.id));
    assert.ok(parts.semantics);

    for (const component of components.values()) {
      if (component.kind === 'structure') {
        assert.equal(component.parentId, null);
      } else {
        assert.equal(components.get(component.parentId)?.kind, 'structure');
      }
    }
    const opening = [...components.values()].find((component) => (
      component.kind === 'door' || component.kind === 'window'
    ));
    assert.equal(opening.transformPolicy, 'opening2d');
    assert.equal(opening.editPolicy.handle, 'facade-opening');
    assert.equal(opening.editPolicy.defaultSpace, 'parent');
  } finally {
    disposeModelParts(parts);
  }
});

test('joined manor windows generate one shared semantic assembly', () => {
  const parts = createProceduralWorkshopComponentParts(recipe({
    towerSide: 'none',
    ivy: false,
    openingAttachments: {
      'window-1': {
        sourceId: 'window-1',
        hostId: 'structure-main',
        position: [-0.45, 2.45],
        scale: [1, 1],
      },
      'window-2': {
        sourceId: 'window-2',
        hostId: 'structure-main',
        position: [0.45, 2.45],
        scale: [1, 1],
      },
    },
    openingAssemblies: {
      'assembly-window-1': {
        kind: 'window',
        hostId: 'structure-main',
        memberIds: ['window-1', 'window-2'],
      },
    },
  }), { preserveComponents: true });
  try {
    const assembly = parts.components.find(({ id }) => id === 'assembly-window-1');
    assert.ok(assembly);
    assert.equal(assembly.kind, 'window');
    assert.equal(assembly.parentId, 'structure-main');
    assert.equal(assembly.assemblyId, 'assembly-window-1');
    assert.deepEqual(assembly.memberIds, ['window-1', 'window-2']);
    assert.ok(assembly.attachmentSize[0] > 1.6);
    assert.equal(parts.components.some(({ id }) => id === 'window-1'), false);
    assert.equal(parts.components.some(({ id }) => id === 'window-2'), false);
  } finally {
    disposeModelParts(parts);
  }
});

test('joined tower windows follow their round host as one assembly', () => {
  const parts = createProceduralWorkshopComponentParts(recipe({
    ivy: false,
    openingAttachments: {
      'window-1': {
        sourceId: 'window-1',
        hostId: 'structure-left',
        position: [-0.35, 2.2],
        scale: [1, 1],
      },
      'window-6': {
        sourceId: 'window-6',
        hostId: 'structure-left',
        position: [0.35, 2.2],
        scale: [1, 1],
      },
    },
    openingAssemblies: {
      'assembly-window-1': {
        kind: 'window',
        hostId: 'structure-left',
        memberIds: ['window-1', 'window-6'],
      },
    },
  }), { preserveComponents: true });
  try {
    const assembly = parts.components.find(({ id }) => id === 'assembly-window-1');
    assert.ok(assembly);
    assert.equal(assembly.parentId, 'structure-left');
    assert.deepEqual(assembly.memberIds, ['window-1', 'window-6']);
    const assemblyBounds = boundsForParts(parts, ({ component }) => (
      component?.id === 'assembly-window-1'
    ));
    const size = assemblyBounds.getSize(new THREE.Vector3());
    assert.ok(size.x > 0.5);
    assert.ok(size.z > 0.1);
  } finally {
    disposeModelParts(parts);
  }
});

test('moving or scaling a wall structure carries its roof and attached details', () => {
  const base = createProceduralWorkshopComponentParts(recipe({
    towerSide: 'none',
    ivy: false,
  }));
  const edited = createProceduralWorkshopComponentParts(recipe({
    towerSide: 'none',
    ivy: false,
    componentTransforms: {
      'structure-main': {
        position: [1.25, 0, -0.75],
        rotation: [0, Math.PI / 10, 0],
        scale: [1.5, 1.2, 1.35],
      },
    },
  }));
  try {
    const baseRoof = slotBounds(base, 'roof');
    const editedRoof = slotBounds(edited, 'roof');
    const baseRoofSize = baseRoof.getSize(new THREE.Vector3());
    const editedRoofSize = editedRoof.getSize(new THREE.Vector3());
    const baseRoofCenter = baseRoof.getCenter(new THREE.Vector3());
    const editedRoofCenter = editedRoof.getCenter(new THREE.Vector3());

    assert.ok(editedRoofSize.x > baseRoofSize.x);
    assert.ok(editedRoofSize.z > baseRoofSize.z);
    assert.ok(editedRoofCenter.distanceTo(baseRoofCenter) > 0.5);
    assert.ok(edited.every((part) => !part.component));
    assert.ok(edited.length <= 7);
  } finally {
    disposeModelParts(base);
    disposeModelParts(edited);
  }
});

test('component transforms are applied before draw-call remeshing', () => {
  const base = createProceduralWorkshopComponentParts(recipe());
  const edited = createProceduralWorkshopComponentParts(recipe({
    componentTransforms: {
      'structure-main': {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1.5, 1.2, 1.35],
      },
    },
  }));
  try {
    const baseSize = boundsForParts(base).getSize(new THREE.Vector3());
    const editedSize = boundsForParts(edited).getSize(new THREE.Vector3());
    assert.ok(editedSize.x > baseSize.x);
    assert.ok(editedSize.z > baseSize.z);
    assert.ok(edited.every((part) => !part.component));
    assert.ok(edited.length <= 7);
  } finally {
    disposeModelParts(base);
    disposeModelParts(edited);
  }
});

test('preview component pivots preserve stored door edits across regeneration', () => {
  const parts = createProceduralWorkshopComponentParts(recipe({
    componentTransforms: {
      'door-1': {
        position: [0.75, 0.2, 0],
        rotation: [0, Math.PI / 6, 0],
        scale: [1.25, 1.4, 1],
      },
    },
  }), { preserveComponents: true });
  try {
    const door = parts.components.find((component) => component.id === 'door-1');
    assert.ok(door);
    assert.equal(door.parentId, 'structure-main');
    assert.deepEqual(door.transform.position, [0.75, 0.2, 0]);
    assert.deepEqual(door.transform.scale, [1.25, 1.4, 1]);
    assert.equal(door.pivot.length, 3);
  } finally {
    disposeModelParts(parts);
  }
});

test('castle wall arches are editable children of the wall structure', () => {
  const parts = createProceduralWorkshopComponentParts(recipe({
    archetype: 'wall',
    shape: 'stepped',
    towerSide: 'none',
    topStyle: 'battlements',
    width: 10,
    depth: 2,
    height: 5,
    ivy: false,
  }), { preserveComponents: true });
  try {
    const arches = parts.components.filter((component) => component.kind === 'opening');
    assert.ok(arches.length >= 2);
    assert.ok(arches.every((component) => component.parentId === 'structure-main'));
  } finally {
    disposeModelParts(parts);
  }
});
