import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILTIN_WORKSHOP_MATERIAL_PRESETS,
  normalizeWorkshopMaterialDocument,
  resolveWorkshopMaterialRegion,
  serializeWorkshopMaterialDocument,
} from '../src/editor/workshop/ProceduralWorkshopMaterialConfig.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function customPreset() {
  return {
    id: 'custom-wet-stone',
    label: 'Wet stone',
    family: 'walls',
    baseColor: '#55606a',
    tint: '#ffffff',
    roughness: 0.35,
    metalness: 0,
    normalStrength: 1.4,
    heightStrength: 0.4,
    weathering: 0.8,
    mapping: 'projected',
    repeat: 2,
    rotation: 90,
    alignment: 'world',
    sources: { normal: 'normal-stone' },
  };
}

test('full-PBR material documents are canonical and prune unused content', () => {
  const document = normalizeWorkshopMaterialDocument({
    materialLibrary: {
      sources: {
        'normal-unused': { kind: 'normal', name: 'Unused', dataUrl: PNG_DATA_URL },
        'normal-stone': { kind: 'normal', name: 'Stone normal', dataUrl: PNG_DATA_URL },
      },
      presets: {
        'custom-unused': { ...customPreset(), id: 'custom-unused', sources: {} },
        'custom-wet-stone': customPreset(),
      },
    },
    materialDefaults: { walls: 'granite-masonry' },
    materialAreaOverrides: { 'volume-3:facade:north': 'custom-wet-stone' },
    materialFavorites: ['custom-wet-stone', 'granite-masonry'],
  });
  const serialized = serializeWorkshopMaterialDocument(document);
  assert.deepEqual(Object.keys(serialized.materialLibrary.presets), ['custom-wet-stone']);
  assert.deepEqual(Object.keys(serialized.materialLibrary.sources), ['normal-stone']);
  assert.equal(serialized.materialLibrary.sources['normal-stone'].colorSpace, 'linear');
  assert.equal(BUILTIN_WORKSHOP_MATERIAL_PRESETS['granite-masonry'].roughness, 0.9);
});

test('area overrides resolve after semantic family defaults and reset to inheritance', () => {
  const document = normalizeWorkshopMaterialDocument({
    materialDefaults: { walls: 'limestone-masonry' },
    materialAreaOverrides: { 'volume-3:facade:north': 'ochre-plaster' },
  });
  const north = resolveWorkshopMaterialRegion(document, {
    id: 'volume-3:facade:north',
    family: 'walls',
    label: 'North façade',
  });
  const south = resolveWorkshopMaterialRegion(document, {
    id: 'volume-3:facade:south',
    family: 'walls',
    label: 'South façade',
  });
  assert.equal(north.presetId, 'ochre-plaster');
  assert.equal(north.inherited, false);
  assert.equal(south.presetId, 'limestone-masonry');
  assert.equal(south.inherited, true);
});
