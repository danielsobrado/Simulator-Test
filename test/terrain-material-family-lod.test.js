import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const stochasticSource = fs.readFileSync(
  new URL('../src/editor/materials/TerrainMaterialStochasticNodes.js', import.meta.url),
  'utf8',
);
const bakedSource = fs.readFileSync(
  new URL('../src/editor/materials/TerrainMaterialBakedNodes.js', import.meta.url),
  'utf8',
);
const terrainSource = fs.readFileSync(
  new URL('../src/editor/terrainMaterial.js', import.meta.url),
  'utf8',
);
const terrainViewSource = fs.readFileSync(
  new URL('../src/editor/InfiniteTerrainView.js', import.meta.url),
  'utf8',
);

test('stochastic terrain sampling uses triangular array-texture variants without hard cell seams', () => {
  assert.match(stochasticSource, /const upper = sum\.greaterThan\(1\);/);
  assert.match(stochasticSource, /\.depth\(layer\)\.rgb/);
  assert.equal((stochasticSource.match(/sampleVariant\(atlas,/g) ?? []).length, 3);
  assert.match(stochasticSource, /function sampleVariant\(atlas, baseUv, vertex, familyIndex, variantsPerFamily, scaleJitter\)/);
  assert.match(stochasticSource, /const scaleHash = hash2\(vertex, HASH_VECTOR_B, 71\.3\);/);
  assert.match(stochasticSource, /baseUv\.mul\(scale\)\.add\(vec2\(shiftX, shiftY\)\)/);
  assert.match(stochasticSource, /rotateQuarterTurns/);
  assert.match(stochasticSource, /mirrorHash\.greaterThan\(0\.5\)/);
  assert.match(stochasticSource, /weight0[\s\S]*weight1[\s\S]*weight2/);
  assert.doesNotMatch(stochasticSource, /scaleJitter,\s*(17|37)/);
});

test('terrain family projection uses baked shape only for texture projection, not lighting normals', () => {
  assert.match(stochasticSource, /families\.projection\.slopeStart/);
  assert.match(stochasticSource, /families\.projection\.slopeFull/);
  assert.match(stochasticSource, /abs\(farNormal\.r\)\.greaterThan\(abs\(farNormal\.g\)\)/);
  assert.match(stochasticSource, /terrainHeight\.mul\(families\.projection\.verticalScale\)/);
  assert.doesNotMatch(terrainSource, /material\.normalNode\s*=/);
});

test('micro detail fades before it undersamples while mip-filtered meso detail survives', () => {
  assert.match(stochasticSource, /families\.microFadeStartDistance/);
  assert.match(stochasticSource, /families\.microFadeEndDistance/);
  assert.match(stochasticSource, /const microVisibility = oneMinus\(smoothstep\(/);
  assert.match(stochasticSource, /\.mul\(visibility\)/);
});

test('material family detail vanishes at equal-weight boundaries before dominant family flips', () => {
  assert.match(
    stochasticSource,
    /const dominanceConfidence = clamp\(dominant\.dominance\.mul\(2\)\.sub\(1\), 0, 1\);/,
  );
  assert.match(
    stochasticSource,
    /const dominanceScale = pow\(dominanceConfidence, families\.dominantFadePower\);/,
  );
});

test('near and mid terrain consume the family atlas while far terrain remains baked color', () => {
  assert.match(bakedSource, /createTerrainMaterialFamilyMultiplier\(\{/);
  assert.match(bakedSource, /cameraDistance,/);
  assert.match(bakedSource, /midColor = midColor\.mul\(familyMultiplier\)\.mul\(macroMultiplier\);/);
  assert.match(bakedSource, /const nearFamily = mix\(vec3\(1\), familyMultiplier, materialBake\.families\.nearStrength\);/);
  assert.match(bakedSource, /samples\.farColor\.rgb/);
  assert.match(bakedSource, /cameraDistance\.lessThan\(farBlendEnd\)/);
});

test('terrain material acquires one shared atlas lease and ties it to material disposal', () => {
  assert.match(terrainSource, /acquireTerrainMaterialFamilyAtlas\(stylizedConfig\.materialBake\)/);
  assert.match(terrainSource, /familyAtlas,/);
  assert.match(terrainSource, /worldXZ,/);
  assert.match(terrainSource, /terrainHeight,/);
  assert.match(terrainSource, /attachTerrainMaterialFamilyAtlas\(material, familyAtlas\)/);
  assert.match(terrainSource, /familyAtlas\?\.release\(\);/);
});

test('terrain stochastic coordinates stay canonical across floating-origin rebases', () => {
  assert.match(
    terrainViewSource,
    /const render = this\.floatingOrigin\.toRender\([\s\S]*?slot\.descriptor\.centerWorldX,[\s\S]*?slot\.descriptor\.centerWorldZ,/,
  );
  assert.match(
    terrainViewSource,
    /slot\.chunkCenter\.value\.set\(slot\.descriptor\.centerWorldX, slot\.descriptor\.centerWorldZ\);/,
  );
});
