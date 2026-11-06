import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { float, normalWorld, vec3, uniform } from 'three/tsl';
import { foliageMaterialClass, leafTransmissionResponse, foliageSurfaceHighlight } from '../src/editor/stylized/forest/FoliageNodeMaterial.js';
import { resolveTreeFoliageSettings, resolveTreeBarkSettings } from '../src/editor/stylized/forest/treeSurfaceSettings.js';
import { canopyVisibilityNode, configureTreeFoliageSurface } from '../src/editor/stylized/forest/TreeFoliageSurface.js';
import { surfaceWetnessUniform } from '../src/editor/weather/surfaceWetness.js';
import { resolveBarkWeathering } from '../src/editor/stylized/barkWeathering.js';
import { wetSurfaceRoughness } from '../src/editor/stylized/forest/TreeWetSurface.js';
import { createStylizedLeafMaterial, createAuthoredTrunkMaterial } from '../src/editor/stylized/StylizedTreeMaterials.js';
import { createProceduralBarkTextures } from '../src/editor/stylized/forest/ProceduralBarkTextures.js';
import { createDitheredMaterial } from '../src/editor/stylized/lod/StylizedDitheredMaterial.js';
import { createCpuTreeImpostorMaterial } from '../src/editor/stylized/impostor/TreeImpostorMaterial.js';
import { bakeCanopyVisibility } from '../src/editor/stylized/forest/CanopyVisibility.js';
import { createTreeProxyPrototype } from '../src/editor/stylized/lod/StylizedProxyGeometry.js';
import { evaluateShaderNode as evaluate } from './helpers/evaluateShaderNode.js';
import { buildShader, shaderTestRenderer } from './helpers/buildShader.js';

const config = yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8')).stylizedSurface;
const foliage = resolveTreeFoliageSettings(config.trees);

test('two-sided transmission respects optical thickness, orientation, and canopy visibility', () => {
  const response = (thickness, visibility = 1, light = [0, 0, -1]) => evaluate(leafTransmissionResponse(
    vec3(0, 0, 1), vec3(...light), vec3(0, 0, 1), float(thickness), float(visibility),
  ));
  assert.ok(response(0.1) > response(0.8) * 2);
  assert.equal(response(0.2, 0), 0);
  assert.equal(response(0.2, 1, [0, 0, 1]), 0, 'front lighting is handled by reflection');
  assert.ok(response(0.2, 0.5) < response(0.2));
  assert.ok(evaluate(canopyVisibilityNode(float(0), foliage)) > 0.3, 'crowns retain a readable interior');
});

test('water film preserves dry roughness and gives exposed wet faces a restrained highlight', () => {
  const bark = resolveTreeBarkSettings(config.trees);
  for (const dry of [0.2, 0.5, 0.9]) {
    assert.equal(evaluate(wetSurfaceRoughness(float(dry), float(0), bark)), dry);
    const wet = evaluate(wetSurfaceRoughness(float(dry), float(1), bark));
    assert.ok(wet <= dry && wet >= Math.min(dry, bark.wetRoughness));
  }
  const highlight = wet => evaluate(foliageSurfaceHighlight(vec3(0, 0, 1), vec3(0, 0, 1), vec3(0, 0, 1), float(wet)));
  assert.equal(highlight(0), 0);
  assert.ok(highlight(1) > 0 && highlight(1) < 0.2);
  const material = new (foliageMaterialClass(THREE.MeshLambertNodeMaterial))();
  configureTreeFoliageSurface(material, { settings: foliage });
  const before = surfaceWetnessUniform.value;
  try {
    surfaceWetnessUniform.value = 1;
    const top = evaluate(material.foliageWetnessNode, { values: new Map([[normalWorld, [0, 1, 0]]]) });
    const back = evaluate(material.foliageWetnessNode, { values: new Map([[normalWorld, [0, -1, 0]]]) });
    assert.equal(top, back, 'camera-facing normal flips must not change rainfall exposure');
  } finally { surfaceWetnessUniform.value = before; }
});

function geometry() {
  const geometry = new THREE.CylinderGeometry(0.5, 0.8, 10, 8, 4);
  for (const [name, values] of Object.entries({ instanceDither: [1, 0.5, 1], instanceMorphology: [1, 1, 1],
    instanceRootPlane: [0, 0, 1], instanceLeafTint: [1, 1, 1, 0.7] })) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), values.length));
  }
  return geometry;
}

test('new foliage nodes survive LOD clones and compile on an instanced needle crown', () => {
  const geo = geometry();
  bakeCanopyVisibility([{ kind: 'leaf', geometry: geo }]);
  const material = createStylizedLeafMaterial({ config, time: uniform(0), bounds: { minY: -5, maxY: 5 },
    canopyBounds: { min: [-1, -5, -1], max: [1, 5, 1] }, hasCanopyVisibility: true, species: 'conifer' });
  const clone = createDitheredMaterial(material, { tinted: true, kind: 'leaf' });
  assert.equal(clone.foliageThicknessNode, material.foliageThicknessNode);
  assert.ok(clone.foliageSnowNode && clone.foliageWetnessNode && clone.foliageNeedleDirectionNode);
  const shader = buildShader(new THREE.InstancedMesh(geo, clone, 1));
  assert.match(shader.fragmentShader, /exp\(/);
  assert.doesNotMatch(shader.fragmentShader, /viewportDepth|viewportOpaque/);
  assert.match(shader.vertexShader, /normalLocal = normalize/);
  buildShader(new THREE.InstancedMesh(geo, clone, 1), shaderTestRenderer({ forceWebGL: true }));
});

test('near procedural bark compiles bounded parallax, packed normals, and PBR wet response', () => {
  const material = createAuthoredTrunkMaterial({ source: new THREE.MeshLambertMaterial(), config,
    barkTextures: createProceduralBarkTextures({ profile: 'birch', resolution: 16 }),
    barkWeathering: resolveBarkWeathering(config, { snow: { snowLine: 700, snowFade: 100, snowColor: '#ffffff' } }) });
  assert.ok(material.isMeshStandardNodeMaterial);
  assert.ok(material.treeSurfaceShadowNode);
  const shader = buildShader(new THREE.InstancedMesh(geometry(), createDitheredMaterial(material, { kind: 'trunk' }), 1));
  assert.match(shader.fragmentShader, /textureSampleGrad/);
  assert.match(shader.fragmentShader, /for \(/);
  assert.match(shader.fragmentShader, /break;/);
  assert.doesNotMatch(shader.vertexShader, /dpdx|dpdy/);
  const glsl = buildShader(new THREE.InstancedMesh(geometry(), material, 1), shaderTestRenderer({ forceWebGL: true }));
  assert.match(glsl.fragmentShader, /textureGrad/);
  assert.doesNotMatch(glsl.vertexShader, /dFdx|dFdy/);
});

test('height-mapped authored bark shares displaced UVs while retaining each texture transform', () => {
  const maps = Array.from({ length: 4 }, () => new THREE.DataTexture(new Uint8Array([180, 128, 255, 255]), 1, 1));
  const source = new THREE.MeshStandardMaterial({ map: maps[0], bumpMap: maps[1], normalMap: maps[2], roughnessMap: maps[3], roughness: 0.73 });
  maps.forEach((map, i) => { map.repeat.set(i + 1, i + 2); map.offset.set(0.1 * i, 0.05 * i); map.updateMatrix(); });
  const matrices = maps.map(map => map.matrix.toArray());
  const material = createAuthoredTrunkMaterial({ source, config });
  assert.ok(material.contextNode && material.treeSurfaceShadowNode);
  for (const name of ['map', 'bumpMap', 'normalMap', 'roughnessMap']) assert.equal(material[name], source[name]);
  assert.equal(source.contextNode, undefined);
  const clone = createDitheredMaterial(material, { kind: 'trunk' });
  assert.equal(clone.contextNode, material.contextNode);
  for (const forceWebGL of [false, true]) buildShader(new THREE.InstancedMesh(geometry(), clone, 1), shaderTestRenderer({ forceWebGL }));
  assert.deepEqual(maps.map(map => map.matrix.toArray()), matrices);
  maps[2].channel = 1;
  assert.equal(createAuthoredTrunkMaterial({ source, config }).treeSurfaceShadowNode, null, 'incompatible UV sets retain ordinary bump mapping');
});

test('invalid quality limits and species traits fail before compiling materials', () => {
  assert.throws(() => resolveTreeBarkSettings({ barkSurface: { parallax: { steps: 100 } } }), /parallax/);
  assert.throws(() => resolveTreeBarkSettings({ barkSurface: { parallax: { near: 20, far: 10 } } }), /parallax/);
  assert.throws(() => resolveTreeFoliageSettings({ foliageLighting: { thickness: -1 } }), /thickness/);
  const needles = resolveTreeFoliageSettings(config.trees, 'conifer_narrow');
  assert.ok(needles.thickness > foliage.thickness && needles.needleSpecular > foliage.needleSpecular);
});

test('impostors use the same foliage traits and a bark-only wet response', () => {
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  const atlas = { width: 4, height: 10, centerY: 5, columns: 1, rows: 1, tileSize: 16,
    lowElevationDegrees: 12, highElevationDegrees: 58, foliageLighting: true, barkLighting: true,
    foliageSurface: foliage, barkSurface: resolveTreeBarkSettings(config.trees), albedo: texture, normal: texture };
  const { material } = createCpuTreeImpostorMaterial(atlas);
  assert.equal(material.foliageAbsorptionNode.value, foliage.absorption);
  assert.ok(material.isMeshStandardNodeMaterial && material.roughnessNode);
  const geo = new THREE.PlaneGeometry();
  for (const [name, values] of Object.entries({ instanceTransform: [0, 5, 0, 1], instanceImpostorParams: [0, 1, 0.5, 0], instanceImpostorAppearance: [1, 1, 1, 1] })) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), 4));
  }
  buildShader(new THREE.InstancedMesh(geo, material, 1));
  buildShader(new THREE.InstancedMesh(geo, material, 1), shaderTestRenderer({ forceWebGL: true }));
});

test('loading proxies retain species lighting and compile without parallax', () => {
  const source = new THREE.MeshLambertNodeMaterial();
  source.userData.treeFoliageSurface = resolveTreeFoliageSettings(config.trees, 'conifer');
  const proxy = createTreeProxyPrototype([
    { kind: 'leaf', geometry: new THREE.ConeGeometry(2, 5), material: source },
    { kind: 'trunk', geometry: new THREE.CylinderGeometry(0.2, 0.3, 5) },
  ], config);
  for (const part of proxy.proxyParts) {
    const geo = part.geometry;
    for (const [name, values] of Object.entries({ instanceDither: [1, 0.5, 1], instanceMorphology: [1, 1, 1], instanceRootPlane: [0, 0, 1] })) {
      geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), values.length));
    }
    assert.equal(part.material.treeSurfaceShadowNode, null);
    if (part.kind === 'leaf') assert.equal(part.material.userData.treeFoliageSurface.thickness, source.userData.treeFoliageSurface.thickness);
    for (const forceWebGL of [false, true]) buildShader(new THREE.InstancedMesh(geo, part.material, 1), shaderTestRenderer({ forceWebGL }));
  }
});
