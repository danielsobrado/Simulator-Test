import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import {
  createProceduralObjectLodParts,
} from '../src/editor/workshop/ProceduralAssetManager.js';
import { createProceduralAssetRecord } from '../src/editor/workshop/ProceduralAssetStore.js';
import {
  createProceduralWorkshopComponentParts,
} from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';

function record(archetype, overrides = {}) {
  return createProceduralAssetRecord({
    label: `LOD ${archetype}`,
    recipe: {
      archetype,
      style: 'granite',
      topStyle: 'slate',
      width: 8,
      depth: 3,
      height: 6,
      detail: 3,
      seed: 0x51a7,
      windows: true,
      ivy: true,
      remesh: true,
      ...overrides,
    },
  });
}

/** The shell tier may legitimately *be* the coarse tier, so dedupe before disposal. */
function disposeLod(near, lod) {
  disposeModelParts([
    ...near,
    ...new Set([...(lod?.coarse ?? []), ...(lod?.shell ?? [])]),
  ]);
}

function bounds(parts, slots) {
  const box = new THREE.Box3().makeEmpty();
  for (const part of parts) {
    if (!slots.includes(part.material?.userData?.workshopSlot)) continue;
    part.geometry.computeBoundingBox();
    if (part.geometry.boundingBox) {
      box.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrix));
    }
  }
  return box;
}

test('workshop LODs preserve the envelope and materially reduce geometry', () => {
  const source = record('gatehouse');
  const near = createProceduralWorkshopComponentParts(source.recipe);
  const lod = createProceduralObjectLodParts(source, near);
  try {
    assert.ok(lod);
    assert.ok(lod.statistics.envelopeDelta <= lod.statistics.envelopeTolerance);
    assert.ok(lod.statistics.coarseRatio < 0.5);
    assert.ok(lod.statistics.shellRatio <= lod.statistics.coarseRatio);
    assert.ok(lod.statistics.shellTriangles > 0);
  } finally {
    disposeLod(near, lod);
  }
});

test('the shell tier never shrinks the building footprint', () => {
  // Regression: the shell was taken verbatim from the coarse tier's structural
  // families, but that core is inset by construction — a tower's mortar cylinder
  // sits at `radius - depth * 0.46`. Towers therefore deflated by 2.16 m, about
  // 22% of their width, the moment the shell band engaged, and nothing checked
  // it because only the coarse tier was validated.
  for (const archetype of ['wall', 'tower', 'gatehouse', 'square-tower', 'manor']) {
    const source = record(archetype);
    const near = createProceduralWorkshopComponentParts(source.recipe);
    const lod = createProceduralObjectLodParts(source, near);
    try {
      assert.ok(lod, `${archetype} should produce LOD tiers`);
      const masonry = ['stone', 'mortar'];
      const target = bounds(near, masonry);
      const actual = bounds(lod.shell, masonry);
      const delta = Math.max(
        Math.abs(target.min.x - actual.min.x),
        Math.abs(target.min.z - actual.min.z),
        Math.abs(target.max.x - actual.max.x),
        Math.abs(target.max.z - actual.max.z),
      );
      assert.ok(
        delta <= lod.statistics.envelopeTolerance,
        `${archetype} shell footprint drifted ${delta} m (tolerance ${lod.statistics.envelopeTolerance})`,
      );
    } finally {
      disposeLod(near, lod);
    }
  }
});

test('a faithful shell drops individual stones; an unfaithful one falls back to coarse', () => {
  // A tower's core can be expanded to its masonry envelope, so it gets a real
  // shell. A gatehouse's cannot — its flanking towers are `stone` while the core
  // is only the central wall — so it keeps the coarse tier for that band rather
  // than shipping a deflated silhouette.
  const towerSource = record('tower');
  const towerNear = createProceduralWorkshopComponentParts(towerSource.recipe);
  const towerLod = createProceduralObjectLodParts(towerSource, towerNear);
  try {
    assert.notEqual(towerLod.shell, towerLod.coarse);
    const slots = new Set(towerLod.shell.map(({ material }) => material.userData.workshopSlot));
    assert.ok(slots.has('mortar'));
    assert.equal(slots.has('stone'), false);
    assert.equal(slots.has('foliage'), false);
    assert.ok(towerLod.statistics.shellRatio < towerLod.statistics.coarseRatio);
  } finally {
    disposeLod(towerNear, towerLod);
  }

  const gateSource = record('gatehouse');
  const gateNear = createProceduralWorkshopComponentParts(gateSource.recipe);
  const gateLod = createProceduralObjectLodParts(gateSource, gateNear);
  try {
    assert.equal(gateLod.shell, gateLod.coarse, 'gatehouse shell should fall back to coarse');
  } finally {
    disposeLod(gateNear, gateLod);
  }
});

test('shell geometry never aliases coarse geometry when it is built separately', () => {
  // The shell is derived by filtering coarse parts and then transforming them,
  // so it must clone first or the transform would also move the coarse tier.
  const source = record('tower');
  const near = createProceduralWorkshopComponentParts(source.recipe);
  const lod = createProceduralObjectLodParts(source, near);
  try {
    const coarseGeometries = new Set(lod.coarse.map(({ geometry }) => geometry));
    const aliased = lod.shell.filter(({ geometry }) => coarseGeometries.has(geometry));
    assert.equal(aliased.length, 0);
  } finally {
    disposeLod(near, lod);
  }
});

test('workshop materials are node materials compatible with dithered LOD transitions', () => {
  const source = record('gatehouse');
  const parts = createProceduralWorkshopComponentParts(source.recipe);
  try {
    assert.ok(parts.every(({ material }) => material.isNodeMaterial === true));
    assert.ok(parts.every(({ material }) => 'opacityNode' in material));
    assert.ok(parts.every(({ material }) => material.clone().isNodeMaterial === true));
  } finally {
    disposeModelParts(parts);
  }
});
