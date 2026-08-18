import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_WORKSHOP_MATERIAL_SOURCE_DATA_URL_LENGTH,
  MAX_WORKSHOP_MATERIAL_TOTAL_SOURCE_LENGTH,
  normalizeWorkshopMaterialDocument,
} from '../src/editor/workshop/ProceduralWorkshopMaterialConfig.js';

function pngDataUrl(extraBytes = 0) {
  const header = Buffer.alloc(24);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(1, 16);
  header.writeUInt32BE(1, 20);
  const bytes = extraBytes > 0
    ? Buffer.concat([header, Buffer.alloc(extraBytes)])
    : header;
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function documentWithSources(sources, presetSources) {
  return {
    materialLibrary: {
      sources,
      presets: {
        'custom-test': {
          label: 'Custom test',
          family: 'walls',
          sources: presetSources,
        },
      },
    },
    materialAreaOverrides: {
      'wall-1:walls': 'custom-test',
    },
  };
}

test('workshop material sources derive the expected texture color space', () => {
  const dataUrl = pngDataUrl();
  const normalized = normalizeWorkshopMaterialDocument(documentWithSources({
    'normal-source': { kind: 'normal', name: 'Normal', dataUrl },
  }, {
    normal: 'normal-source',
  }));

  assert.equal(normalized.materialLibrary.sources['normal-source'].colorSpace, 'linear');
  assert.equal(
    normalized.materialLibrary.sources['normal-source'].dataUrl,
    dataUrl,
  );
});

test('workshop material sources reject a single oversized persisted image', () => {
  const dataUrl = pngDataUrl(610_000);
  assert.ok(dataUrl.length > MAX_WORKSHOP_MATERIAL_SOURCE_DATA_URL_LENGTH);

  assert.throws(() => normalizeWorkshopMaterialDocument(documentWithSources({
    'normal-source': { kind: 'normal', name: 'Normal', dataUrl },
  }, {
    normal: 'normal-source',
  })), /bounded local/i);
});

test('workshop material sources enforce the aggregate object budget', () => {
  const dataUrl = pngDataUrl(450_100);
  assert.ok(dataUrl.length < MAX_WORKSHOP_MATERIAL_SOURCE_DATA_URL_LENGTH);
  assert.ok(dataUrl.length * 4 > MAX_WORKSHOP_MATERIAL_TOTAL_SOURCE_LENGTH);

  assert.throws(() => normalizeWorkshopMaterialDocument(documentWithSources({
    'albedo-source': { kind: 'albedo', name: 'Albedo', dataUrl },
    'normal-source': { kind: 'normal', name: 'Normal', dataUrl },
    'orm-source': { kind: 'orm', name: 'ORM', dataUrl },
    'height-source': { kind: 'height', name: 'Height', dataUrl },
  }, {
    albedo: 'albedo-source',
    normal: 'normal-source',
    orm: 'orm-source',
    height: 'height-source',
  })), /too large for one workshop object/i);
});
