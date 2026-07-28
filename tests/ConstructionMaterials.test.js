import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  applyConstructionMaterialPreset,
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  BUILTIN_WORKSHOP_MATERIAL_PRESETS,
  normalizeWorkshopMaterialDocument,
} from '../src/editor/workshop/ProceduralWorkshopMaterialConfig.js';

function wall(materials = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 4,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1, materials },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [5, 0], [10, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('createConstructionMaterials includes a mortar slot', () => {
  const materials = createConstructionMaterials(wall());
  assert.ok(materials.mortar);
  assert.equal(materials.mortar.userData.constructionSlot, 'mortar');
  assert.ok(materials.mortar.color.equals(new THREE.Color('#77766b')));
  assert.equal(materials.mortar.roughness, 1);
});

test('dry-stone mortar reads darker than coursed rubble', () => {
  const rubble = createConstructionMaterials(wall());
  const dry = createConstructionMaterials(normalizeConstructionRecord({
    ...wall(),
    id: 'construction-dry',
    style: { key: 'dry-stone', version: 1, materials: {} },
  }));
  assert.ok(dry.mortar.color.getHex() < rubble.mortar.color.getHex());
});

test('painting a builtin preset changes the stone colour and roughness', () => {
  const plain = createConstructionMaterials(wall());
  const painted = createConstructionMaterials(wall({ stone: 'sandstone-masonry' }));
  const preset = BUILTIN_WORKSHOP_MATERIAL_PRESETS['sandstone-masonry'];
  const expected = new THREE.Color(preset.baseColor).multiply(new THREE.Color(preset.tint));

  assert.ok(plain.stone.color.equals(new THREE.Color('#ffffff')));
  assert.ok(
    painted.stone.color.equals(expected),
    'palette paint must tint the live wall, not only persist an id',
  );
  assert.equal(painted.stone.roughness, preset.roughness);
  assert.equal(painted.stone.userData.workshopPresetId, 'sandstone-masonry');
  assert.notEqual(plain.stone.uuid, painted.stone.uuid);
});

test('applyConstructionMaterialPreset multiplies base colour by tint', () => {
  const base = new THREE.MeshStandardNodeMaterial({ color: '#ffffff', roughness: 1 });
  const preset = BUILTIN_WORKSHOP_MATERIAL_PRESETS['limestone-masonry'];
  const applied = applyConstructionMaterialPreset(base, preset);
  const expected = new THREE.Color(preset.baseColor).multiply(new THREE.Color(preset.tint));
  assert.ok(applied.color.equals(expected));
  assert.equal(applied.roughness, preset.roughness);
  base.dispose();
  applied.dispose();
});

test('createConstructionMaterials resolves custom presets from the material document', () => {
  const document = normalizeWorkshopMaterialDocument({
    materialLibrary: {
      presets: {
        'custom-ochre': {
          id: 'custom-ochre',
          label: 'Custom ochre',
          family: 'stone',
          baseColor: '#b7793f',
          tint: '#ffe0ad',
          roughness: 0.91,
          metalness: 0,
          normalStrength: 0.4,
          heightStrength: 0.12,
          weathering: 0.2,
          mapping: 'projected',
          repeat: 1,
          rotation: 0,
          alignment: 'world',
          sources: {},
        },
      },
      sources: {},
    },
    materialAreaOverrides: { 'library:custom-ochre': 'custom-ochre' },
  });
  const materials = createConstructionMaterials(wall({ stone: 'custom-ochre' }), document);
  const expected = new THREE.Color('#b7793f').multiply(new THREE.Color('#ffe0ad'));
  assert.ok(materials.stone.color.equals(expected));
  assert.equal(materials.stone.roughness, 0.91);
  assert.equal(materials.stone.userData.workshopPresetId, 'custom-ochre');
});
