import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { uniform, vec3, float } from 'three/tsl';
import { createStylizedLeafMaterial, createAuthoredTrunkMaterial, createStylizedTrunkMaterial } from '../src/editor/stylized/StylizedTreeMaterials.js';
import { createDitheredMaterial } from '../src/editor/stylized/lod/StylizedDitheredMaterial.js';
import { createTreeImpostorBakeMaterial, createBakeGeometry } from '../src/editor/stylized/impostor/TreeImpostorBaker.js';
import { createProceduralBarkTextures } from '../src/editor/stylized/forest/ProceduralBarkTextures.js';
import { resolveBarkWeathering } from '../src/editor/stylized/barkWeathering.js';
import { buildShader } from './helpers/buildShader.js';
import { evaluateShaderNode } from './helpers/evaluateShaderNode.js';

const config = yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8')).stylizedSurface;
const map = () => new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
const leaf = source => createStylizedLeafMaterial({ source, config, time: uniform(0),
  bounds: { minY: 2, maxY: 10 }, preserveSourceColor: true, canopyGrade: false, vertexColor: true });

function geometry() {
  const geometry = new THREE.CylinderGeometry(.5, .8, 10, 10, 8);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(.8), 3));
  for (const [name, values] of Object.entries({ instanceDither: [1, .5, 1], instanceMorphology: [1, 1, 1],
    instanceRootPlane: [0, 0, 1], instanceLeafTint: [1, 1, 1, 0] })) {
    geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), values.length));
  }
  return geometry;
}

test('authored leaf and trunk surface channels survive tree grading and LOD copies', () => {
  const source = new THREE.MeshPhysicalMaterial({ map: map(), normalMap: map(), roughnessMap: map(),
    aoMap: map(), roughness: .73, metalness: .04, alphaTest: .38, vertexColors: true, specularIntensity: .4 });
  source.normalScale.set(.35, .6); source.normalMap.repeat.set(3, 4);
  for (const material of [leaf(source), createAuthoredTrunkMaterial({ source, sourceMap: source.map, vertexColor: true })]) {
    const clone = createDitheredMaterial(material);
    for (const candidate of [material, clone]) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'roughness', 'metalness', 'specularIntensity']) {
        assert.equal(candidate[key], source[key], key);
      }
      assert.deepEqual(candidate.normalScale.toArray(), [.35, .6]);
      assert.equal(candidate.vertexColors, false, 'explicit colour graph must not receive COLOR_0 twice');
      assert.ok(candidate.isMeshPhysicalNodeMaterial);
    }
    assert.deepEqual(source.normalMap.repeat.toArray(), [3, 4]);
    buildShader(new THREE.InstancedMesh(geometry(), clone, 1));
  }
  assert.equal(source.vertexColors, true);
});

test('painted leaf colour and authored alpha are applied once', () => {
  const source = new THREE.MeshStandardMaterial({ map: map(), alphaMap: map(), opacity: .8 });
  const material = leaf(source), values = new Map();
  for (const node of [material.colorNode, material.opacityNode]) node.traverse(child => {
    if (child.isTextureNode) values.set(child, child.value === source.alphaMap ? [1, .5, 1, 1] : [.4, .6, .2, .9]);
    if (child.getAttributeName?.() === 'color') values.set(child, [.5, .75, 1]);
  });
  const result = evaluateShaderNode(material.colorNode, { values });
  result.forEach((value, i) => assert.ok(Math.abs(value - [.2, .45, .2][i] * config.trees.brightness) < 1e-6));
  assert.ok(Math.abs(evaluateShaderNode(material.opacityNode, { values }) - .9 * .5 * .8) < 1e-6);
});

test('primary spruce bark has relief, weathering, grading and fill in the compiled material', () => {
  const material = createStylizedTrunkMaterial({ textures: { color: map(), ao: map(), height: map() }, config,
    barkWeathering: resolveBarkWeathering(config), sway: { config, time: uniform(1), topY: 10 } });
  assert.ok(material.normalNode && material.emissiveNode && material.positionNode);
  assert.equal(material.userData.barkLighting, true);
  const shader = buildShader(new THREE.InstancedMesh(geometry(), createDitheredMaterial(material, { kind: 'trunk' }), 1));
  assert.match(shader.fragmentShader, /dpdx/);
  assert.doesNotMatch(shader.vertexShader, /dpdx|dpdy/);
});

test('procedural bark samples undeformed positions even on translated, swaying instances', () => {
  const material = createAuthoredTrunkMaterial({ source: {}, barkTextures: createProceduralBarkTextures({ profile: 'birch', resolution: 16 }),
    sway: { config, time: uniform(1), topY: 10 } });
  const mesh = new THREE.InstancedMesh(geometry(), material, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(100, 20, -30));
  const shader = buildShader(mesh);
  const assignments = [...shader.vertexShader.matchAll(/varyings\.(\w+) = position;/g)].map(m => m[1]).filter(n => n !== 'positionLocal');
  assert.ok(assignments.some(name => shader.fragmentShader.includes(`${name}.yz`)), 'projection must interpolate the original position attribute');
  assert.doesNotMatch(shader.fragmentShader, /texture(?:Sample|Load)\([^;]*positionLocal\./);
});

test('normal baking evaluates surface detail and uses the live crown cutout', () => {
  const sourceMap = map(), normalMap = map();
  const source = new THREE.MeshStandardNodeMaterial({ normalMap, alphaTest: .4 });
  source.colorNode = vec3(.2, .5, .1); source.opacityNode = float(.3);
  const part = { kind: 'leaf', sourceMap, material: source };
  const bake = createTreeImpostorBakeMaterial(part, true);
  assert.equal(evaluateShaderNode(bake.maskNode.aNode), .3, 'normal and albedo passes use the same thinned alpha');
  const shader = buildShader(new THREE.Mesh(createBakeGeometry(geometry()), bake));
  assert.match(shader.fragmentShader, /textureLoad|textureSample/);
  assert.match(shader.fragmentShader, /dpdx/, 'normal mapping must run despite the unlit bake output');
  source.normalNode = vec3(0, 1, 0);
  const custom = createTreeImpostorBakeMaterial(part, true);
  assert.deepEqual(evaluateShaderNode(custom.setupNormal()), [0, 1, 0]);
});
