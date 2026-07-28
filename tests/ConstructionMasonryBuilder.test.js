import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildModuleMasonry,
  createMortarDescriptor,
  resolveStoneShape,
} from '../src/editor/construction/compile/ConstructionMasonryBuilder.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import {
  packCurvedWall,
} from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import { CONSTRUCTION_MATERIAL_SLOT } from '../src/editor/construction/render/ConstructionMaterialSlots.js';
import {
  createConstructionMaterials,
  disposeConstructionMaterials,
} from '../src/editor/construction/render/ConstructionMaterials.js';
import { coarsePlacements } from '../src/editor/construction/render/ConstructionLod.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';
import { buildMortarCoreGeometry } from '../src/editor/construction/compile/ConstructionMortarCoreBuilder.js';

const STYLE = constructionStyle('coursed-rubble');

function wallRecord(length = 12) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 7,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  });
}

function packStraight(length = 12) {
  const record = wallRecord(length);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STYLE,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
  });
  return { record, arcTable, placements: packed.stones };
}

function materialsFor(record) {
  return createConstructionMaterials(record);
}

test.afterEach(() => {
  disposeConstructionMaterials();
});

test('a normal module returns mortar then stone meshes', () => {
  const { record, arcTable, placements } = packStraight();
  const materials = materialsFor(record);
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
  });
  assert.equal(built.meshes.length, 2);
  assert.equal(
    built.meshes[0].userData.constructionMaterialSlot,
    CONSTRUCTION_MATERIAL_SLOT.MORTAR,
  );
  assert.equal(
    built.meshes[1].userData.constructionMaterialSlot,
    CONSTRUCTION_MATERIAL_SLOT.STONE,
  );
  for (const mesh of built.meshes) mesh.geometry.dispose();
});

test('mortar and stone use different materials', () => {
  const { record, arcTable, placements } = packStraight();
  const materials = materialsFor(record);
  const built = buildModuleMasonry(placements, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
  });
  assert.equal(built.meshes[0].material, materials.mortar);
  assert.equal(built.meshes[1].material, materials.stone);
  for (const mesh of built.meshes) mesh.geometry.dispose();
});

test('mortar is recessed behind the stone on both faces', () => {
  // Controlled non-jittered shape: irregularity 0 via dry recipe override is
  // hard; instead compare bounding boxes on a straight wall where faces align
  // with world Z after yaw≈0.
  const { record, arcTable, placements } = packStraight(4);
  const materials = materialsFor(record);
  const built = buildModuleMasonry(placements.slice(0, 12), {
    record: {
      ...record,
      style: { ...record.style, key: 'ashlar' },
      seed: 1,
    },
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
    lodBand: 'coarse',
  });
  const [mortarMesh, stoneMesh] = built.meshes;
  const mortarBox = mortarMesh.geometry.boundingBox;
  const stoneBox = stoneMesh.geometry.boundingBox;
  assert.ok(mortarBox.max.z < stoneBox.max.z + 1e-6);
  assert.ok(mortarBox.min.z > stoneBox.min.z - 1e-6);
  for (const mesh of built.meshes) mesh.geometry.dispose();
});

test('no placements means no meshes', () => {
  const record = wallRecord();
  const materials = materialsFor(record);
  const built = buildModuleMasonry([], {
    record,
    materials,
    arcTable: createCurveArcTable(sampleCubicBezierPath(record.path)),
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
  });
  assert.deepEqual(built.meshes, []);
  assert.equal(built.stats.stones, 0);
  assert.equal(built.stats.mortarPrisms, 0);
  assert.equal(built.stats.stoneTriangles, 0);
  assert.equal(built.stats.mortarTriangles, 0);
});

test('backing count follows placement count', () => {
  const { record, arcTable, placements } = packStraight();
  const subset = placements.slice(0, 40);
  assert.ok(subset.length === 40, 'need a packed module with at least 40 stones');
  const materials = materialsFor(record);
  const built = buildModuleMasonry(subset, {
    record,
    materials,
    arcTable,
    moduleOrigin: { x: 0, z: 0 },
    groundHeightAt: () => 0,
  });
  assert.equal(built.stats.mortarPrisms, 40);
  assert.equal(built.stats.stones, 40);
  for (const mesh of built.meshes) mesh.geometry.dispose();
});

function faceHeight(corners) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of corners) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return maxY - minY;
}

test('coarse placements remain covered by matching backing', () => {
  const { placements } = packStraight();
  const coarse = coarsePlacements(placements);
  assert.ok(coarse.length > 0);
  assert.ok(coarse.length < placements.length);

  const descriptors = [];
  for (const placement of coarse) {
    const stoneShape = resolveStoneShape({
      placement,
      params: {
        width: placement.width,
        height: placement.height,
        depth: placement.depth,
        position: [placement.s, placement.y, 0],
        rotation: [0, 0, placement.roll ?? 0],
      },
      shaped: {
        width: placement.width,
        height: placement.height,
        depth: placement.depth,
        position: [placement.s, placement.y, 0],
        rotation: [0, 0, placement.roll ?? 0],
        bevelRatio: 0.06,
        skew: [0, 0],
        protrusion: 0,
      },
      detail: 1,
    });
    const descriptor = createMortarDescriptor({
      placement,
      stoneShape,
      config: CONSTRUCTION_MORTAR_CONFIG,
    });
    assert.ok(descriptor, 'every coarse stone gets backing');
    // Stretched coarse stones keep a taller face ring; backing must cover it.
    assert.ok(
      faceHeight(descriptor.corners) + 1e-6 >= faceHeight(stoneShape.corners),
      'backing must be at least as tall as the resolved stone face',
    );
    descriptors.push(descriptor);
  }
  assert.equal(descriptors.length, coarse.length);

  const geometry = buildMortarCoreGeometry(descriptors);
  assert.equal(geometry.userData.mortarPrisms, coarse.length);
  geometry.dispose();
});
