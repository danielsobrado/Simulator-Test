import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import yaml from 'js-yaml';
import { OBJECT_MODEL_NAMES, createObjectModelParts } from '../src/editor/ObjectModelLibrary.js';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { TILE_BY_KEY } from '../src/editor/tileCatalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TILE_SIZE = 2;

async function loadObjectCatalog() {
  const parsed = yaml.load(await readFile(path.join(ROOT, 'config', 'objects.yaml'), 'utf8'));
  return createObjectCatalog(parsed.objects, TILE_BY_KEY);
}

function measure(parts) {
  const bounds = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (const part of parts) {
    const position = part.geometry.attributes.position;
    for (let index = 0; index < position.count; index += 1) {
      bounds.expandByPoint(vertex.fromBufferAttribute(position, index).applyMatrix4(part.matrix));
    }
  }
  return bounds;
}

test('every catalogued object builds a textured procedural model', async () => {
  const catalog = await loadObjectCatalog();
  assert.ok(catalog.length >= 20, 'the catalog should offer a broad set of objects');

  for (const definition of catalog) {
    const parts = createObjectModelParts(definition, TILE_SIZE);
    assert.ok(parts.length > 0, `${definition.key} produced no parts`);

    for (const part of parts) {
      assert.ok(part.geometry.isBufferGeometry, `${definition.key} part needs geometry`);
      assert.ok(part.matrix.isMatrix4, `${definition.key} part needs a placement matrix`);
      assert.ok(part.geometry.attributes.uv, `${definition.key} part needs UVs to texture`);
      assert.ok(part.geometry.attributes.normal, `${definition.key} part needs normals`);

      const material = part.material;
      assert.ok(material.map, `${definition.key} part is missing its colour map`);
      assert.ok(material.normalMap, `${definition.key} part is missing its normal map`);
      assert.ok(material.roughnessMap, `${definition.key} part is missing its roughness map`);
      assert.equal(material.userData.sharedSurface, true);
      assert.equal(material.map.userData.sharedSurface, true);
    }
  }
});

test('models stay within the footprint they reserve and sit on the ground', async () => {
  const catalog = await loadObjectCatalog();

  for (const definition of catalog) {
    const bounds = measure(createObjectModelParts(definition, TILE_SIZE));
    const size = bounds.getSize(new THREE.Vector3());

    assert.ok(
      size.x <= definition.footprint.width * TILE_SIZE + 1e-6,
      `${definition.key} is ${size.x.toFixed(2)} wide but reserves ${definition.footprint.width} tiles`,
    );
    assert.ok(
      size.z <= definition.footprint.depth * TILE_SIZE + 1e-6,
      `${definition.key} is ${size.z.toFixed(2)} deep but reserves ${definition.footprint.depth} tiles`,
    );
    assert.ok(size.y > 0, `${definition.key} has no height`);
    // Ground-hugging props may nestle slightly into the terrain, nothing more.
    assert.ok(bounds.min.y > -0.3, `${definition.key} floats below its ground pivot`);
  }
});

test('surface textures and materials are reused across the whole catalog', async () => {
  const catalog = await loadObjectCatalog();
  const materials = new Set();
  const textures = new Set();
  let partCount = 0;

  for (const definition of catalog) {
    for (const part of createObjectModelParts(definition, TILE_SIZE)) {
      partCount += 1;
      materials.add(part.material);
      textures.add(part.material.map);
    }
  }

  assert.ok(partCount > materials.size, 'materials should be shared between parts');
  assert.ok(textures.size <= materials.size, 'each surface kind needs only one colour map');
});

test('disposing a model releases its geometry but keeps shared surfaces alive', () => {
  const parts = createObjectModelParts({ model: 'cottage' }, TILE_SIZE);
  let geometryDisposals = 0;
  let sharedDisposals = 0;

  for (const part of parts) {
    part.geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    part.material.addEventListener('dispose', () => { sharedDisposals += 1; });
    part.material.map.addEventListener('dispose', () => { sharedDisposals += 1; });
  }

  disposeModelParts(parts);

  assert.ok(geometryDisposals > 0, 'per-model geometry should be released');
  assert.equal(sharedDisposals, 0, 'shared materials and textures must survive');
});

test('unknown models fail closed', () => {
  assert.throws(
    () => createObjectModelParts({ model: 'pyramid' }, TILE_SIZE),
    /Unknown procedural object model/,
  );
  assert.ok(OBJECT_MODEL_NAMES.includes('cottage'));
});
