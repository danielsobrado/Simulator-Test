import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { attachTreeRoots } from '../src/editor/stylized/StylizedTreePrototypes.js';
import { createTreeRootGeometry, measureStem } from '../src/editor/stylized/forest/treeRoots.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';

function trunk(radius = 0.3) {
  const geometry = new THREE.CylinderGeometry(radius, radius, 10, 12, 20);
  geometry.translate(2, 5, -1);
  return geometry;
}

test('a stem is measured from the trunk itself, off-axis and at any size', () => {
  const stem = measureStem(trunk(0.3));
  assert.ok(Math.abs(stem.x - 2) < 0.05);
  assert.ok(Math.abs(stem.z + 1) < 0.05);
  assert.ok(Math.abs(stem.radius - 0.3) < 0.02);
  assert.equal(measureStem(new THREE.BoxGeometry(1, 0.01, 1)), null);
});

test('roots spread from the stem and end at the ground, the same for a seed', () => {
  const source = trunk();
  const roots = createTreeRootGeometry(source, 'tree-1');
  const position = roots.getAttribute('position');
  assert.ok(position.array.every(Number.isFinite));
  roots.computeBoundingBox();
  assert.ok(roots.boundingBox.min.y < 0.05);
  assert.ok(roots.boundingBox.max.x - 2 > 0.3 * 2, 'roots reach past the stem');
  assert.deepEqual(position.array, createTreeRootGeometry(source, 'tree-1').getAttribute('position').array);
  assert.notDeepEqual(position.array, createTreeRootGeometry(source, 'tree-2').getAttribute('position').array);
});

test('roots merge into an indexed or a de-indexed trunk and keep its attributes', () => {
  for (const geometry of [trunk(), trunk().toNonIndexed()]) {
    const before = geometry.getAttribute('position').count;
    const parts = [{ kind: 'trunk', geometry }, { kind: 'leaf', geometry: new THREE.BufferGeometry() }];
    assert.equal(attachTreeRoots(parts, 'tree-1'), true);
    assert.ok(parts[0].geometry.getAttribute('position').count > before);
    assert.ok(parts[0].geometry.getAttribute('uv'));
  }
  assert.equal(attachTreeRoots([{ kind: 'leaf', geometry: trunk() }], 'tree-1'), false);
});

test('broadleaf crowns take distinct forms, conifers keep their own, and a tree keeps its form', () => {
  const registry = new ForestSpeciesRegistry();
  const habitat = {
    profileKey: 'temperate_deciduous_forest', patchEdge: 0.1, patchCoverage: 0.9, patchId: 'grove', slope: 0.1, waterWeight: 1,
  };
  const widths = new Set();
  for (let index = 0; index < 60; index += 1) {
    const candidate = { stableId: `tree:${index}`, scale: 1, ageClass: 'mature', speciesId: 'broadleaf_round' };
    const placed = registry.select(candidate, habitat);
    assert.equal(placed.crownScale, registry.select(candidate, habitat).crownScale);
    widths.add(Math.round(placed.crownScale * 4));
  }
  assert.ok(widths.size >= 3, `only ${widths.size} crown widths`);
});
