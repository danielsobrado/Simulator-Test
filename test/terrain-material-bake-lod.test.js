import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const terrainSource = fs.readFileSync(
  new URL('../src/editor/terrainMaterial.js', import.meta.url),
  'utf8',
);
const bakedSource = fs.readFileSync(
  new URL('../src/editor/materials/TerrainMaterialBakedNodes.js', import.meta.url),
  'utf8',
);
const surfaceSource = fs.readFileSync(
  new URL('../src/editor/stylized/StylizedSurfaceView.js', import.meta.url),
  'utf8',
);

test('terrain keeps the procedural material as fallback while delegating baked LOD selection', () => {
  assert.match(terrainSource, /const proceduralColor = groundColor\.mul\(heightShade\);/);
  assert.match(terrainSource, /createTerrainMaterialBakedColor\(\{/);
  assert.match(terrainSource, /gpuState: materialBakeGpu/);
  assert.doesNotMatch(terrainSource, /material\.normalNode\s*=/);
});

test('baked terrain color uses ready-gated near, mid and far conditional nodes', () => {
  assert.match(bakedSource, /gpuState\.ready\.greaterThan\(0\.5\)/);
  assert.match(bakedSource, /cameraDistance\.lessThan\(render\.nearDistance\)/);
  assert.match(bakedSource, /cameraDistance\.lessThan\(render\.farDistance\)/);
  assert.match(bakedSource, /samples\.farColor\.rgb/);
  assert.match(bakedSource, /normalizedWeights\(samples\.materialWeights\)/);
  assert.match(bakedSource, /samples\.wetnessShoreline\.r/);
  assert.match(bakedSource, /samples\.canopyWater\.r/);
  assert.doesNotMatch(bakedSource, /stylizedFbm|stylizedDirtMask|stylizedPathWearMask/);
});

test('stale baked terrain partially favors live procedural shading until refresh completes', () => {
  assert.match(bakedSource, /gpuState\.stale\.greaterThan\(0\.5\)/);
  assert.match(
    bakedSource,
    /mix\(bakedColor, proceduralColor, render\.staleProceduralBlend\)/,
  );
});

test('stylized surface uploads CPU bakes after the bake runtime update', () => {
  const runtimeIndex = surfaceSource.indexOf('this.materialBakeRuntime?.update();');
  const gpuIndex = surfaceSource.indexOf('this.materialBakeGpuBridge?.update();');
  assert.ok(runtimeIndex >= 0);
  assert.ok(gpuIndex > runtimeIndex);
});
