import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import yaml from 'js-yaml';
import { validateEditorConfig } from '../src/config/validateEditorConfig.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSET_PATHS = Object.freeze([
  'public/assets/grass-scene.glb',
  'public/assets/rocks/rock.glb',
  'public/assets/rocks/obj_nat_rock_01.glb',
  'public/assets/rocks/a_simple_rock.glb',
  'public/assets/rocks/ruined-fence/stone-01.glb',
  'public/assets/rocks/forest-pack/rock-02.glb',
  'public/assets/trees/stylized-oak.glb',
  'public/assets/trees/forest-pack/tree-wide-01.glb',
  'public/assets/trees/tree-scene/tree-02.glb',
  'public/assets/ground/stylized-grass/clump-01.glb',
  'public/assets/ground/aquatic/weed-01.glb',
  'public/assets/ground/aquatic/lotus-04.glb',
  'public/assets/animals/crow-flight.glb',
  'public/assets/animals/seagull-flight.glb',
  'public/assets/bushes/stylized_bush.glb',
  'public/assets/bushes/small_bush.glb',
  'public/assets/bushes/bush2.glb',
  'public/assets/bushes/bush.glb',
  'public/assets/bushes/bamboo_bush.glb',
  'public/assets/textures/bark/bark_color.png',
  'public/assets/textures/bark/bark_AO.png',
  'public/assets/textures/bark/bark_height.png',
  'public/assets/textures/flower/flowers.png',
  'public/assets/textures/flower/flowersRGB.png',
  'public/assets/textures/flower/flowersGradient.png',
  'public/assets/textures/flower3/flowers.png',
  'public/assets/textures/flower3/flowersRGB.png',
  'public/assets/textures/flower3/flowersGradient.png',
]);

async function loadConfig() {
  const text = await readFile(path.join(ROOT, 'editor.config.yaml'), 'utf8');
  return validateEditorConfig(yaml.load(text));
}

async function createNodeGlbLoader(THREE) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader({
    load(_url, onLoad) {
      queueMicrotask(() => onLoad(new THREE.Texture()));
    },
  });
  return loader;
}

test('stylized environment config validates all enabled layers', async () => {
  const config = await loadConfig();
  const surface = config.stylizedSurface;
  assert.equal(surface.enabled, true);
  assert.equal(surface.rocks.enabled, true);
  assert.equal(surface.flowers.enabled, true);
  assert.equal(surface.trees.enabled, true);
  assert.equal(surface.water.enabled, true);
  assert.equal(surface.wildlife.enabled, true);
  assert.equal(surface.wildlife.distant.enabled, true);
  assert.equal(surface.wildlife.authored.enabled, false);
  assert.ok(surface.wildlife.distant.maxBirds <= 10);
  assert.equal(surface.sky.enabled, true);
  assert.ok(surface.grass.bladesPerCell > 0);
  assert.ok(surface.translucency.strength > 0);
  assert.ok(surface.path.blendCells > 0);
  assert.equal(surface.water.tileId, 0);
  assert.ok(Array.isArray(surface.flowers.tileIds) && surface.flowers.tileIds.length > 0);
});

test('stylized source assets are present with valid container signatures', async () => {
  for (const relativePath of ASSET_PATHS) {
    const data = await readFile(path.join(ROOT, relativePath));
    if (relativePath.endsWith('.glb')) {
      assert.equal(data.subarray(0, 4).toString('ascii'), 'glTF', relativePath);
      assert.equal(data.readUInt32LE(4), 2, relativePath);
    } else {
      assert.deepEqual(
        [...data.subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
        relativePath,
      );
    }
  }
});

test('stylized render path remains WebGPU/TSL and avoids GPU readbacks', async () => {
  const directory = path.join(ROOT, 'src/editor/stylized');
  const fileNames = (await readdir(directory)).filter((fileName) => fileName.endsWith('.js'));
  const source = (await Promise.all(fileNames.map((fileName) => readFile(
    path.join(directory, fileName),
    'utf8',
  )))).join('\n');

  assert.match(source, /three\/webgpu/);
  assert.match(source, /three\/tsl/);
  assert.match(source, /InstancedMesh|InstancedBufferGeometry/);
  assert.match(source, /createStylizedWaterMaterial|StylizedWaterSlot/);
  assert.match(source, /StylizedSceneAssetCache/);
  assert.match(source, /buildFromScene/);
  assert.match(source, /scatterMath/);
  assert.match(source, /translucency/);
  assert.doesNotMatch(source, /mapAsync\s*\(/);
  assert.doesNotMatch(source, /readRenderTargetPixels/);
  assert.doesNotMatch(source, /getBufferSubData/);
});

test('pine prototypes bake upright through world matrices', async () => {
  globalThis.self = globalThis;
  globalThis.Image = class Image {
    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  };
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

  const { readFileSync } = await import('node:fs');
  const THREE = await import('three');
  const {
    attachRootCollar,
    extractPrototypeParts,
    findPrototypeRoots,
  } = await import('../src/editor/stylized/StylizedTreePrototypes.js');
  const config = await loadConfig();

  const loader = await createNodeGlbLoader(THREE);
  const buffer = readFileSync(path.join(ROOT, 'public/assets/grass-scene.glb'));
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      '',
      resolve,
      reject,
    );
  });
  gltf.scene.updateMatrixWorld(true);

  const roots = gltf.scene.children.flatMap((child) => findPrototypeRoots(
    child,
    config.stylizedSurface,
  ));
  const upright = roots
    .map((root) => extractPrototypeParts(root, config.stylizedSurface))
    .filter(Boolean);
  assert.ok(upright.length >= 3, `expected upright pines, got ${upright.length}`);
  for (const parts of upright) {
    const min = new THREE.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    const max = new THREE.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    for (const part of parts) {
      min.min(part.geometry.boundingBox.min);
      max.max(part.geometry.boundingBox.max);
    }
    const size = max.clone().sub(min);
    assert.ok(size.y >= size.x && size.y >= size.z, size.toArray());
    const trunk = parts.filter((part) => part.kind === 'trunk');
    assert.ok(trunk.length > 0, 'prototype must include a trunk');
    const trunkBase = Math.min(...trunk.map((part) => part.geometry.boundingBox.min.y));
    assert.ok(
      Math.abs(trunkBase) < 0.05,
      `trunk base should sit near y=0, got ${trunkBase}`,
    );
    assert.ok(size.y < 20, `world bake should keep demo scale, got height ${size.y}`);
    assert.equal(
      attachRootCollar(parts),
      true,
      'quantized authored attributes must merge with the procedural root collar',
    );
  }
});

test('authored rocks and bushes bake upright at scenery scale', async () => {
  globalThis.self = globalThis;
  globalThis.Image = class Image {
    set src(_value) {
      queueMicrotask(() => this.onload?.());
    }
  };
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });

  const { readFileSync } = await import('node:fs');
  const THREE = await import('three');
  const {
    extractAuthoredMeshPrototypes,
  } = await import('../src/editor/stylized/StylizedPrototypeBake.js');
  const config = await loadConfig();
  const loader = await createNodeGlbLoader(THREE);

  for (const [kind, variants] of [
    ['rock', config.stylizedSurface.assets.rockVariants],
    ['bush', config.stylizedSurface.assets.bushVariants],
  ]) {
    for (const definition of variants) {
      const relativePath = definition.scene.replace(/^\/+/, 'public/');
      const buffer = readFileSync(path.join(ROOT, relativePath));
      const gltf = await new Promise((resolve, reject) => {
        loader.parse(
          buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
          '',
          resolve,
          reject,
        );
      });
      const prototypes = extractAuthoredMeshPrototypes(gltf.scene, {
        scale: definition.scale,
        rootNames: definition.rootNames,
      });
      assert.ok(prototypes.length > 0, `${definition.scene} should contain ${kind} meshes`);
      for (const prototype of prototypes) {
        const size = prototype.geometry.boundingBox.getSize(new THREE.Vector3());
        assert.ok(
          Math.abs(prototype.geometry.boundingBox.min.y) < 1e-4,
          `${definition.scene} must sit on y=0`,
        );
        assert.ok(
          size.y > 0.2 && size.y < 3,
          `${definition.scene} has unexpected ${kind} height ${size.y}`,
        );
      }
    }
  }
});

test('upstream MIT attribution is retained', async () => {
  const notice = await readFile(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  assert.match(notice, /Christian Ortiz \(Cortiz\)/);
  assert.match(notice, /MIT License/);
  assert.match(notice, /Copyright \(c\) 2026/);
});
