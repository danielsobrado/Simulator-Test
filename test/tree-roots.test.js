import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { attachTreeRoots } from '../src/editor/stylized/StylizedTreePrototypes.js';
import { createTreeRootGeometry, measureStem } from '../src/editor/stylized/forest/treeRoots.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';
import { rootProfileForSpecies } from '../src/editor/stylized/StylizedTreeView.js';

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

test('a wide-footed stem keeps its roots inside its crown', () => {
  // The savanna oak: an authored flare at the foot once measured as the stem and
  // threw roots four times wider than its canopy.
  const flared = new THREE.CylinderGeometry(0.3, 1.6, 6, 12, 24);
  flared.translate(0, 3, 0);
  const crown = new THREE.SphereGeometry(2.5, 8, 6);
  crown.translate(0, 5, 0);
  const parts = [{ kind: 'trunk', geometry: flared }, { kind: 'leaf', geometry: crown }];
  assert.equal(attachTreeRoots(parts, 'oak'), true);
  parts[0].geometry.computeBoundingBox();
  const box = parts[0].geometry.boundingBox;
  assert.ok(box.max.x - box.min.x < 5, `roots span ${box.max.x - box.min.x} m under a 5 m crown`);
});

test('the foot swells into the roots and the bole above it does not', () => {
  const geometry = trunk(0.3);
  const parts = [{ kind: 'trunk', geometry }, { kind: 'leaf', geometry: new THREE.SphereGeometry(3) }];
  attachTreeRoots(parts, 'tree-1', 'conifer');
  const position = parts[0].geometry.getAttribute('position');
  let foot = 0;
  let bole = 0;
  for (let index = 0; index < position.count; index += 1) {
    const radius = Math.hypot(position.getX(index) - 2, position.getZ(index) + 1);
    if (Math.abs(position.getY(index)) < 1e-4 && radius < 0.6) foot = Math.max(foot, radius);
    if (Math.abs(position.getY(index) - 5) < 0.3) bole = Math.max(bole, radius);
  }
  assert.ok(foot > 0.33, `foot radius ${foot}`);
  assert.ok(Math.abs(bole - 0.3) < 0.01, `bole radius ${bole}`);
});

test('a trunk that already has authored root spurs keeps them without adding duplicate procedural root fins', () => {
  const geometry = trunk(0.35).toNonIndexed();
  const spurs = createTreeRootGeometry(geometry, 'authored-buttress');
  const posA = geometry.getAttribute('position');
  const posB = spurs.toNonIndexed().getAttribute('position');
  const merged = new Float32Array(posA.array.length + posB.array.length);
  merged.set(posA.array, 0);
  merged.set(posB.array, posA.array.length);
  const authored = new THREE.BufferGeometry();
  authored.setAttribute('position', new THREE.Float32BufferAttribute(merged, 3));
  const vertexCountBefore = authored.getAttribute('position').count;
  const stem = measureStem(authored);
  assert.equal(stem.hasAuthoredRoots, true);
  const parts = [{ kind: 'trunk', geometry: authored }, { kind: 'leaf', geometry: new THREE.SphereGeometry(3) }];
  assert.equal(attachTreeRoots(parts, 'authored-buttress'), true);
  assert.equal(parts[0].geometry.getAttribute('position').count, vertexCountBefore);
  assert.ok(parts[0].bole.radius > 0.25 && parts[0].bole.radius < 0.45);
});

test('species pick their root profile', () => {
  assert.equal(rootProfileForSpecies(['conifer_narrow', 'conifer_wide']), 'conifer');
  assert.equal(rootProfileForSpecies('wetland_sparse'), 'buttress');
  assert.equal(rootProfileForSpecies(['broadleaf_round', 'tropical_tall']), 'broadleaf');
  assert.equal(rootProfileForSpecies(undefined), 'broadleaf');
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
