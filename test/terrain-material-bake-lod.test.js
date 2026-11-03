import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * These assertions read source text, so they read a canonical view of it:
 * whitespace runs collapse to one space, then whitespace around brackets,
 * commas, semicolons and member access is dropped. Any indentation, re-wrapping
 * or formatter run produces the same string, so a reformat can never break a
 * test - and the patterns still read like the code they assert on (operator
 * spacing such as ` = ` and `: ` is preserved).
 */
function canonical(path) {
  return fs.readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/\s+/g, ' ')
    .replace(/\s*([()[\]{},;])\s*/g, '$1')
    .replace(/\s*\.\s*/g, '.');
}

const terrainSource = canonical('../src/editor/terrainMaterial.js');
const bakedSource = canonical('../src/editor/materials/TerrainMaterialBakedNodes.js');
const surfaceSource = canonical('../src/editor/stylized/StylizedSurfaceView.js');

test('terrain keeps the procedural material as fallback while delegating baked LOD selection', () => {
  assert.match(terrainSource, /const proceduralColor = groundColor\.mul\(heightShade\);/);
  assert.match(terrainSource, /const bakedSurface = createTerrainMaterialBakedSurface\(\{/);
  assert.match(terrainSource, /gpuState: materialBakeGpu/);
  // The material consumes every output of the baked surface: colour, roughness
  // and the computed lighting normal.
  assert.match(terrainSource, /antialiasSpecularRoughness\(surface\.roughness,\s*bakedSurface\.normal\)/);
  assert.match(terrainSource, /material\.roughnessNode = filteredRoughness;/);
  assert.match(terrainSource, /material\.normalNode = footprints\.relief\(bakedSurface\.normal\);/);
  assert.doesNotMatch(terrainSource, /material\.normalNode = vec3\(/);
});

test('baked terrain normal is a computed surface gradient gated on bake readiness', () => {
  // Supersedes `docs/perf-qa.md` "Terrain normal and forest-floor/dirt layering
  // (2026-07-26)", which flagged assigning `normalNode` while it was a literal
  // local +Z (wrong space). 318ac383/457b5179 re-introduced the assignment as a
  // *computed* surface-gradient normal derived from the same heightfield that
  // displaces the geometry, decoded from the baked far-normal texture.
  assert.match(
    bakedSource,
    /const surfaceNormal = createTerrainSurfaceNormal\(\{encodedNormal: samples\.farNormal,/,
  );
  assert.match(
    bakedSource,
    /const normalVisibility = oneMinus\(smoothstep\(families\.normalFadeStartDistance,families\.normalFadeEndDistance,cameraDistance,\)\);/,
  );
  assert.match(
    bakedSource,
    /detailStrength: normalVisibility\.mul\(families\.normalStrength\),/,
  );
  // Readiness gate: use the geometry directly. The completed material normal
  // would recurse when this output also feeds snow color and roughness.
  assert.match(
    bakedSource,
    /const readyNormal = select\(gpuState\.ready\.greaterThan\(0\.5\),surfaceNormal,[\s\S]*?normalViewGeometry\.mul\(faceDirection\),\);/,
  );
  assert.doesNotMatch(bakedSource, /surfaceNormal,normalView,/);
  assert.match(bakedSource, /normal: readyNormal,/);
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

test('new and stale baked terrain crossfade against live procedural shading only while needed', () => {
  assert.match(bakedSource, /gpuState\.stale\.greaterThan\(0\.5\)/);
  assert.match(bakedSource, /mix\(bakedColor,proceduralColor,render\.staleProceduralBlend\)/);
  assert.match(bakedSource, /gpuState\.blend\.greaterThan\(PUBLISHED_BLEND_THRESHOLD\)/);
  assert.match(bakedSource, /mix\(proceduralColor,readyColor,gpuState\.blend\)/);
});

test('stylized surface uploads CPU bakes after the bake runtime update', () => {
  const runtimeIndex = surfaceSource.indexOf('this.materialBakeRuntime?.update(this.shouldYieldWork);');
  const gpuIndex = surfaceSource.indexOf('this.materialBakeGpuBridge?.update(');
  assert.ok(runtimeIndex >= 0);
  assert.ok(gpuIndex > runtimeIndex);
  assert.match(surfaceSource, /config: this\.config\.materialBake/);
});
