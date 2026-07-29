import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
  releaseConstructionMaterials,
  applyConstructionMaterialPreset,
  presetTextureCacheSize,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import {
  getWorkshopMaterialPreset,
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

test('releaseConstructionMaterials drops the last user and disposes materials', () => {
  const document = materialDocument({ baseColor: '#b7793f', roughness: 0.91 });
  const first = createConstructionMaterials(wall(), document);
  const second = createConstructionMaterials(wall(), document);
  assert.equal(second, first);

  releaseConstructionMaterials(first);
  const stillShared = createConstructionMaterials(wall(), document);
  assert.equal(stillShared, first);
  releaseConstructionMaterials(stillShared);
  releaseConstructionMaterials(stillShared);

  const recreated = createConstructionMaterials(wall(), document);
  assert.notEqual(recreated, first);
  assert.notEqual(recreated.stone.uuid, first.stone.uuid);
});

test('LRU eviction does not dispose textures still held by live materials', () => {
  const previousImage = globalThis.Image;
  globalThis.Image = class FakeImage {
    addEventListener() {}
    // eslint-disable-next-line class-methods-use-this
    set src(_value) {}
  };

  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function paintedDocument(presetId) {
    return normalizeWorkshopMaterialDocument({
      materialLibrary: {
        presets: {
          [presetId]: {
            id: presetId,
            label: presetId,
            family: 'stone',
            baseColor: '#b7793f',
            tint: '#ffffff',
            roughness: 0.9,
            metalness: 0,
            normalStrength: 0.4,
            heightStrength: 0.12,
            weathering: 0.2,
            mapping: 'projected',
            repeat: 1,
            rotation: 0,
            alignment: 'world',
            sources: { albedo: `${presetId}-albedo` },
          },
        },
        sources: {
          [`${presetId}-albedo`]: {
            kind: 'albedo',
            name: `${presetId}.png`,
            dataUrl: pixel,
          },
        },
      },
      materialAreaOverrides: { [`library:${presetId}`]: presetId },
    });
  }

  function paintedWall(presetId, seed = 17) {
    return normalizeConstructionRecord({
      ...wall(),
      seed,
      id: `construction-${presetId}`,
      style: {
        key: 'soft-limestone-rubble',
        version: 1,
        materials: { stone: presetId },
      },
    });
  }

  try {
    const liveDocument = paintedDocument('live-stone');
    const live = createConstructionMaterials(paintedWall('live-stone'), liveDocument);
    const kept = live.stone.map;
    assert.ok(kept, 'live wall should carry a shared albedo map');

    let disposed = 0;
    const originalDispose = kept.dispose.bind(kept);
    kept.dispose = (...args) => {
      disposed += 1;
      return originalDispose(...args);
    };

    // Flood the cache with unretained textures (users === 0). Eviction may run,
    // but the retained live map must stay alive.
    for (let index = 0; index < 80; index += 1) {
      const id = `fill-stone-${index}`;
      const document = paintedDocument(id);
      applyConstructionMaterialPreset(
        live.stone.clone(),
        getWorkshopMaterialPreset(document, id),
        document,
      );
    }

    assert.equal(disposed, 0, 'live albedo was disposed while still referenced');
    assert.equal(live.stone.map, kept);
    assert.ok(presetTextureCacheSize() <= 80);

    releaseConstructionMaterials(live);
  } finally {
    globalThis.Image = previousImage;
  }
});
