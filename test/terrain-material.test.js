import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/editor/terrainMaterial.js', import.meta.url),
  'utf8',
);

test('forest-floor tint excludes exposed dirt and path tread', () => {
  assert.match(
    source,
    /const forestFloorTint = forestFloor[\s\S]*?\.mul\(oneMinus\(dirt\)\);/,
  );
  assert.match(
    source,
    /colorNode\(forestFloorConfig\.groundCoreColor[\s\S]*?forestFloorTint,/,
  );
});

test('terrain uses PBR response while preserving its transformed base normal', () => {
  assert.match(source, /new THREE\.MeshStandardNodeMaterial/);
  assert.match(source, /material\.roughnessNode\s*=\s*bakedSurface\.roughness/);
  assert.doesNotMatch(source, /material\.normalNode\s*=/);
  assert.match(source, /PlaneGeometry's local \+Z[\s\S]*?world \+Y/);
});

test('terrain color does not overlay the editor cell grid in player view', () => {
  assert.doesNotMatch(source, /\bCELL_GRID_COLOR\b/);
  assert.doesNotMatch(source, /\bcellGrid\b/);
  assert.doesNotMatch(source, /\bgridLine\s*\(/);
});
