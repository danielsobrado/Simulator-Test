import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import {
  normalizeWorkshopMaterialDocument,
} from '../src/editor/workshop/ProceduralWorkshopMaterialConfig.js';

function wall() {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-cache',
    revision: 1,
    seed: 17,
    kind: 'wall',
    style: {
      key: 'soft-limestone-rubble',
      version: 1,
      materials: { stone: 'custom-stone' },
    },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([[0, 0], [5, 0], [10, 0]], {
      simplifyTolerance: 0.01,
    }),
    features: [],
  });
}

function materialDocument({ baseColor, roughness }) {
  return normalizeWorkshopMaterialDocument({
    materialLibrary: {
      presets: {
        'custom-stone': {
          id: 'custom-stone',
          label: 'Custom stone',
          family: 'stone',
          baseColor,
          tint: '#ffffff',
          roughness,
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
    materialAreaOverrides: { 'library:custom-stone': 'custom-stone' },
  });
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('unchanged custom material documents still share cached materials', () => {
  const document = materialDocument({ baseColor: '#b7793f', roughness: 0.91 });
  const first = createConstructionMaterials(wall(), document);
  const second = createConstructionMaterials(wall(), document);

  assert.equal(second, first);
  assert.equal(second.stone, first.stone);
});

test('editing a custom preset with the same id invalidates the material cache', () => {
  const firstDocument = materialDocument({ baseColor: '#b7793f', roughness: 0.91 });
  const secondDocument = materialDocument({ baseColor: '#8094a0', roughness: 0.67 });

  const first = createConstructionMaterials(wall(), firstDocument);
  const second = createConstructionMaterials(wall(), secondDocument);

  assert.notEqual(second, first);
  assert.notEqual(second.stone.uuid, first.stone.uuid);
  assert.ok(first.stone.color.equals(new THREE.Color('#b7793f')));
  assert.ok(second.stone.color.equals(new THREE.Color('#8094a0')));
  assert.equal(first.stone.roughness, 0.91);
  assert.equal(second.stone.roughness, 0.67);
});
