import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { float, positionWorld, vec3, vec4, texture } from 'three/tsl';
import { foliageMaterialClass } from '../src/editor/stylized/forest/FoliageNodeMaterial.js';
import { applyCloudShadow } from '../src/editor/stylized/CloudShadow.js';
import { gradeTownMaterial } from '../src/render/materials/townGrade.js';
import { createTownKitMaterial } from '../src/editor/towns/TownKitMaterial.js';
import { KIT_DATA_ATTRIBUTE } from '../src/editor/towns/TownKitGeometry.js';
import { createTerrainOrientedMicroDetail } from '../src/editor/materials/TerrainMaterialMicroDetailNodes.js';
import { StylizedGodRaysPostProcess } from '../src/editor/stylized/StylizedGodRaysPostProcess.js';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';
import { setPipelineOutput } from '../src/editor/stylized/pipelineOutput.js';
import { DEFAULT_CINEMATIC_FINISH, createFinishUniforms } from '../src/editor/stylized/cinematicFinish.js';

import { buildShader as build, shaderTestRenderer as renderer } from './helpers/buildShader.js';

test('foliage lighting generates with material shadows and cloud attenuation', () => {
  const device = renderer();
  device.shadowMap.enabled = true;
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  const material = new (foliageMaterialClass(THREE.MeshLambertNodeMaterial))();
  material.foliageTransmissionNode = float(0.8);
  applyCloudShadow(material, { cloudShadows: { enabled: true }, cloudScale: 1, cloudSpeed: 0.1, cloudWorldScale: 0.01 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  mesh.receiveShadow = true;
  const shader = build(mesh, device, sun);
  assert.match(shader.fragmentShader, /textureSampleCompare/);
});

test('wet workshop and instanced town materials generate with filtered normal detail', () => {
  const normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const workshop = new THREE.MeshStandardNodeMaterial({ normalMap });
  gradeTownMaterial(workshop, 'stone');
  const workshopShader = build(new THREE.Mesh(new THREE.PlaneGeometry(), workshop)).fragmentShader;
  assert.match(workshopShader, /dpdx/);
  // This nearest-filtered fixture has one sampled data texture (the normal).
  // The BRDF lookup uses a sampler. Physical shading and AA share one textureLoad.
  assert.equal(workshopShader.match(/\btextureLoad\(/g)?.length, 1);

  const array = () => new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1);
  const atlas = { albedo: array(), normal: array(), albedoLayer: () => 0,
    rows: [{ index: 0, name: 'M_stone', albedoLayer: 0, normalLayer: 0,
      roughness: 0.8, metalness: 0, color: [1, 1, 1], emissive: 0 }] };
  const material = createTownKitMaterial(atlas, { key: 'qa', swaps: {}, tints: {}, wear: 0.2, snow: 0 });
  const geometry = new THREE.PlaneGeometry();
  geometry.setAttribute(KIT_DATA_ATTRIBUTE, new THREE.Float32BufferAttribute(new Float32Array(16), 4));
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  mesh.setColorAt(0, new THREE.Color(0.95, 0.95, 0.95));
  assert.match(build(mesh).fragmentShader, /dpdx/);
});

test('terrain microdetail derivatives stay in the fragment stage', () => {
  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = vec3(0.5).add(createTerrainOrientedMicroDetail({
    planarMeters: positionWorld.xz, scaleMeters: 0.1, strength: 0.1, visibility: float(1),
  }));
  const shader = build(new THREE.Mesh(new THREE.PlaneGeometry(), material));
  assert.match(shader.fragmentShader, /fwidth/);
  assert.doesNotMatch(shader.vertexShader, /fwidth|dpdx|dpdy/);
});

test('cinematic composition generates with AO enabled and disabled; QA can select either', () => {
  const device = renderer();
  const effect = new StylizedGodRaysPostProcess({ renderer: device, scene: new THREE.Scene(),
    config: { enabled: true, technique: 'cinematic', volumetric: { contactOcclusion: { enabled: true } } },
    sunDirection: new THREE.Vector3(0, 1, 0),
  });
  for (const enabled of [true, false]) {
    effect.setSettings({ contactOcclusionEnabled: enabled });
    const output = effect.ensureCinematicPipeline(new THREE.PerspectiveCamera()).outputNode;
    const material = new THREE.NodeMaterial();
    material.fragmentNode = output;
    build(new THREE.Mesh(new THREE.PlaneGeometry(), material), device);
    assert.equal(parseQaParams(`?qa=chunk-cross&contactOcclusion=${enabled ? 1 : 0}`).contactOcclusion, enabled);
  }
  assert.equal(parseQaParams('?qa=chunk-cross').contactOcclusion, null);
  effect.dispose();
});

test('rebuilding a finished pipeline releases its bloom and FXAA targets exactly once', () => {
  for (const antialias of [true, false]) {
    const beauty = new THREE.Texture();
    let beautyDisposed = 0, bloomDisposed = 0, filterDisposed = 0;
    beauty.addEventListener('dispose', () => beautyDisposed++);
    const { pipeline, bloom } = setPipelineOutput(new THREE.RenderPipeline(renderer()), vec4(0.5, 0.5, 0.5, 1), {
      fxaa: antialias, finish: { beauty: texture(beauty), settings: DEFAULT_CINEMATIC_FINISH,
        uniforms: createFinishUniforms(DEFAULT_CINEMATIC_FINISH) },
    });
    const disposeBloom = bloom.dispose.bind(bloom);
    bloom.dispose = () => { bloomDisposed++; disposeBloom(); };
    if (antialias) pipeline.outputNode.textureNode.renderTarget.addEventListener('dispose', () => filterDisposed++);
    pipeline.dispose(); pipeline.dispose();
    assert.equal(bloomDisposed, 1);
    assert.equal(filterDisposed, antialias ? 1 : 0);
    assert.equal(beautyDisposed, 0, 'scene-pass textures remain owned by the scene pass');
  }
});
