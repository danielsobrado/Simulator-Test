import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { diffuseColor, float, positionViewDirection, uniform, vec2, vec3 } from 'three/tsl';
import { evaluateShaderNode as evaluate } from './helpers/evaluateShaderNode.js';
import { foliageLight, foliageSkyFill, syncFoliageLight } from '../src/editor/stylized/forest/foliageLight.js';
import { foliageMaterialClass } from '../src/editor/stylized/forest/FoliageNodeMaterial.js';
import { cloneAuthoredNodeMaterial, applyUnderstoryPalette } from '../src/editor/stylized/AuthoredFoliageMaterial.js';
import { createDitheredMaterial } from '../src/editor/stylized/lod/StylizedDitheredMaterial.js';
import { filteredDetailSine } from '../src/editor/materials/TerrainMaterialMicroDetailNodes.js';
import { filterSpecularRoughness } from '../src/render/materials/specularAntialiasing.js';
import { wetTownSurface, TOWN_WET_FAMILIES } from '../src/render/materials/townWetness.js';
import { buildingWetnessUniform } from '../src/editor/weather/surfaceWetness.js';
import { meadowBladeWorldNormal } from '../src/editor/stylized/meadow/meadowBladeMaterial.js';

test('turning a meadow ribbon turns its shaded edge and tip with its vertices', () => {
  for (const side of [-1, 0, 1]) {
    for (const height of [0, 0.1, 0.5, 1]) {
      const local = evaluate(meadowBladeWorldNormal(vec2(0, 1), float(side), float(height)));
      for (const angle of [Math.PI / 2, -0.8, Math.PI]) {
        const s = Math.sin(angle), c = Math.cos(angle);
        const normal = evaluate(meadowBladeWorldNormal(vec2(s, c), float(side), float(height)));
        // createMeadowBladePosition rotates local x and z with this basis.
        const expected = [local[0] * c - local[2] * s, local[1], local[0] * s + local[2] * c];
        normal.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-6));
      }
    }
  }
});

test('canopy fill follows linear sky colour and goes dark without sky illumination', () => {
  const hemisphere = new THREE.HemisphereLight('#ffffff', '#222222', 1);
  hemisphere.color.setRGB(0.08, 0.2, 0.5);
  syncFoliageLight({ hemisphere });
  const fill = foliageSkyFill(vec3(1, 1, 1), 1);
  const rgb = evaluate(fill);
  assert.ok(rgb[2] > rgb[1] && rgb[1] > rgb[0]);
  hemisphere.color.multiplyScalar(0.25);
  syncFoliageLight({ hemisphere });
  evaluate(fill).forEach((c, i) => assert.equal(c, rgb[i] * 0.25));
  syncFoliageLight(null);
  assert.deepEqual(evaluate(fill), [0, 0, 0]);
});

test('leaf transmission uses shadowed direct radiance, and survives LOD copies and snow masks', () => {
  const Material = foliageMaterialClass(THREE.MeshLambertNodeMaterial);
  const source = new Material({ alphaTest: 0.42 });
  source.colorNode = vec3(0.3, 0.7, 0.2);
  source.foliageTransmissionNode = float(0.8);
  const clone = source.clone();
  assert.equal(clone.foliageTransmissionNode, source.foliageTransmissionNode);
  assert.equal(clone.alphaTest, 0.42);
  assert.equal(clone.customProgramCacheKey(), source.customProgramCacheKey());
  const snowy = createDitheredMaterial(source, { tinted: true, kind: 'leaf' });
  assert.notEqual(snowy.foliageTransmissionNode, source.foliageTransmissionNode);
  assert.notEqual(snowy.customProgramCacheKey(), source.customProgramCacheKey());

  foliageLight.strength.value = 0.12;
  const radiance = uniform(new THREE.Vector3(2, 1, 0.5));
  const terms = [];
  clone.setupLightingModel().direct({
    lightNode: { light: new THREE.DirectionalLight() }, lightDirection: vec3(0, 0, -1), lightColor: radiance,
    reflectedLight: { directDiffuse: { addAssign: n => terms.push(n) } },
  });
  assert.equal(terms.length, 2, 'retains ordinary diffuse and adds transmission');
  const values = new Map([[diffuseColor, [0.3, 0.7, 0.2, 1]], [positionViewDirection, [0, 0, 1]]]);
  const lit = evaluate(terms[1], { values });
  assert.ok(lit.every(v => v > 0));
  radiance.value.multiplyScalar(0.5);
  evaluate(terms[1], { values }).forEach((v, i) => assert.equal(v, lit[i] * 0.5));
  radiance.value.setScalar(0);
  assert.deepEqual(evaluate(terms[1], { values }), [0, 0, 0], 'full shadow cannot emit direct light');
});

test('authored foliage keeps its PBR channels and emission through lighting and LOD cloning', () => {
  const source = new THREE.MeshStandardNodeMaterial({ color: '#408020', roughness: 0.67, metalness: 0.12,
    map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture(), alphaTest: 0.38 });
  source.emissiveNode = vec3(0.1, 0.2, 0.3);
  const foliage = applyUnderstoryPalette(cloneAuthoredNodeMaterial(source, { lit: true }), {});
  const clone = foliage.clone();
  for (const key of ['map', 'normalMap', 'roughnessMap', 'roughness', 'metalness', 'alphaTest']) assert.equal(clone[key], source[key]);
  assert.ok(clone.isMeshStandardNodeMaterial);
  assert.equal(clone.emissiveNode, foliage.emissiveNode);
  assert.equal(clone.foliageTransmissionNode, foliage.foliageTransmissionNode);
});

test('rain changes exposed building surfaces, keeps undersides dry and never increases roughness', () => {
  buildingWetnessUniform.value.setScalar(0);
  for (const family of Object.values(TOWN_WET_FAMILIES)) {
    const dry = wetTownSurface(vec3(0.6, 0.5, 0.4), float(0.8), float(1), family);
    assert.deepEqual(evaluate(dry.color), [0.6, 0.5, 0.4]);
    assert.equal(evaluate(dry.roughness), 0.8);
  }
  buildingWetnessUniform.value.setScalar(1);
  for (const family of Object.values(TOWN_WET_FAMILIES)) {
    const top = wetTownSurface(vec3(0.6, 0.5, 0.4), float(0.8), float(1), family);
    const wall = wetTownSurface(vec3(0.6, 0.5, 0.4), float(0.8), float(0), family);
    const bottom = wetTownSurface(vec3(0.6, 0.5, 0.4), float(0.8), float(-1), family);
    assert.ok(evaluate(top.color)[0] < evaluate(wall.color)[0]);
    assert.deepEqual(evaluate(bottom.color), [0.6, 0.5, 0.4]);
    assert.equal(evaluate(bottom.roughness), 0.8);
    assert.ok(evaluate(top.roughness) < 0.8);
    assert.equal(evaluate(wetTownSurface(vec3(1), float(0.1), float(1), family).roughness), 0.1);
  }
  buildingWetnessUniform.value.setScalar(0);
});

test('fine detail fades before aliasing and specular filtering widens only varying normal detail', () => {
  const wave = filteredDetailSine(float(Math.PI / 2));
  const amplitude = fwidth => evaluate(wave, { derivatives: { fwidth } });
  assert.equal(amplitude(0.1), 1);
  assert.ok(amplitude(2.5) > 0 && amplitude(2.5) < amplitude(2));
  assert.equal(amplitude(Math.PI), 0);
  assert.equal(amplitude(20), 0);
  const normal = vec3(0, 0, 1);
  for (const roughness of [0.1, 0.3, 0.7, 1]) {
    const filtered = filterSpecularRoughness(float(roughness), normal);
    const flat = evaluate(filtered, { derivatives: { dFdx: [0, 0, 0], dFdy: [0, 0, 0] } });
    assert.ok(Math.abs(flat - roughness) < 1e-10);
    const varying = evaluate(filtered, { derivatives: { dFdx: [0.4, 0.2, 0], dFdy: [0.1, 0.3, 0] } });
    assert.ok(varying >= roughness && varying <= 1);
  }
});
