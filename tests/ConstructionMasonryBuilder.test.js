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
  const coarse = coarsePlacements(placements, { styleKey: 'coursed-rubble' });
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
    // Stretched + amplified coarse stones keep a taller face ring; backing must
    // cover the resolved stone when mortarCorners were merged/stretched too.
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

function faceWidth(corners) {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const [x] of corners) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  return maxX - minX;
}

function shapeStub(corners, overrides = {}) {
  return {
    corners,
    depth: 0.7,
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    category: 'field',
    ...overrides,
  };
}

test('authoritative mortarCorners win over shrunken stone corners', () => {
  const mortarCorners = [
    [-0.5, -0.25],
    [0.5, -0.25],
    [0.5, 0.25],
    [-0.5, 0.25],
  ];
  const tinyStone = [
    [-0.2, -0.1],
    [0.2, -0.1],
    [0.2, 0.1],
    [-0.2, 0.1],
  ];
  const descriptor = createMortarDescriptor({
    placement: { category: 'field', mortarCorners },
    stoneShape: shapeStub(tinyStone),
    config: CONSTRUCTION_MORTAR_CONFIG,
  });
  const width = faceWidth(descriptor.corners);
  // Cell footprint (1 m) plus 2 * safetyOverlap, not legacy field overlap.
  assert.ok(Math.abs(width - (1 + CONSTRUCTION_MORTAR_CONFIG.safetyOverlap * 2)) < 1e-9);
  assert.ok(width < 1.05);
});

test('legacy category overlap applies without mortarCorners', () => {
  const corners = [
    [-0.5, -0.25],
    [0.5, -0.25],
    [0.5, 0.25],
    [-0.5, 0.25],
  ];
  const descriptor = createMortarDescriptor({
    placement: { category: 'field' },
    stoneShape: shapeStub(corners),
    config: CONSTRUCTION_MORTAR_CONFIG,
  });
  const width = faceWidth(descriptor.corners);
  assert.ok(Math.abs(width - 1.048) < 1e-9);
});

test('wall-end mortar does not grow past the solved endpoint', () => {
  const { placements } = packStraight(12);
  const field = placements.filter((stone) => stone.category === 'field');
  const end = field.reduce((best, stone) => (
    (stone.s + stone.packedWidth / 2) > (best.s + best.packedWidth / 2) ? stone : best
  ));
  assert.ok(end.mortarCorners);
  const descriptor = createMortarDescriptor({
    placement: end,
    stoneShape: shapeStub(end.corners.map(([x, y]) => [x * 0.5, y * 0.5]), {
      depth: end.depth,
    }),
    config: CONSTRUCTION_MORTAR_CONFIG,
  });
  const mortarMax = Math.max(...descriptor.corners.map(([x]) => end.s + x));
  const solvedMax = Math.max(...end.mortarCorners.map(([x]) => end.s + x));
  assert.ok(
    mortarMax <= solvedMax + CONSTRUCTION_MORTAR_CONFIG.safetyOverlap + 1e-6,
  );
});

test('opening-edge mortar stays on the surviving interval', () => {
  const record = wallRecord(24);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: STYLE });
  const arch = {
    id: 'door',
    kind: 'door',
    profile: 'round',
    s: 12,
    width: 2.4,
    sill: 0,
    height: 2.6,
    dressed: true,
    group: null,
  };
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: STYLE,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
    openings: [arch],
  });
  const jambLeft = arch.s - arch.width / 2;
  const jambRight = arch.s + arch.width / 2;
  const field = packed.stones.filter((stone) => stone.category === 'field');
  for (const stone of field) {
    if (!stone.mortarCorners) continue;
    const descriptor = createMortarDescriptor({
      placement: stone,
      stoneShape: shapeStub(stone.corners, { depth: stone.depth }),
      config: CONSTRUCTION_MORTAR_CONFIG,
    });
    const xs = descriptor.corners.map(([x]) => stone.s + x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    // Backing may touch the jamb (+ safety) but must not cross the void.
    if (maxX < jambLeft + 0.05) {
      assert.ok(maxX <= jambLeft + CONSTRUCTION_MORTAR_CONFIG.safetyOverlap + 1e-4);
    }
    if (minX > jambRight - 0.05) {
      assert.ok(minX >= jambRight - CONSTRUCTION_MORTAR_CONFIG.safetyOverlap - 1e-4);
    }
  }
});

test('wide soft-limestone joints still cover adjacent backing', () => {
  const soft = constructionStyle('soft-limestone-rubble');
  const record = normalizeConstructionRecord({
    ...wallRecord(12),
    style: { key: 'soft-limestone-rubble', version: 1 },
    seed: 3141,
  });
  const arcTable = createCurveArcTable(sampleCubicBezierPath(record.path));
  const profile = createWallTopProfile(record, arcTable, { style: soft });
  const packed = packCurvedWall({
    arcTable,
    arcRange: [0, arcTable.totalLength],
    style: soft,
    thickness: record.dimensions.thickness,
    seed: record.seed,
    seedOffset: 0,
    topHeightAt: profile.heightAt,
    ruinFactorAt: profile.ruinFactorAt,
  });
  const field = packed.stones
    .filter((stone) => stone.category === 'field' && stone.courseIndex === 1)
    .sort((a, b) => a.s - b.s);
  assert.ok(field.length >= 2);
  for (let index = 1; index < field.length; index += 1) {
    const left = field[index - 1];
    const right = field[index];
    if (Math.abs((left.s + left.packedWidth / 2) - (right.s - right.packedWidth / 2)) > 1e-5) {
      continue;
    }
    const leftDesc = createMortarDescriptor({
      placement: left,
      stoneShape: shapeStub(left.corners, { depth: left.depth }),
    });
    const rightDesc = createMortarDescriptor({
      placement: right,
      stoneShape: shapeStub(right.corners, { depth: right.depth }),
    });
    const leftMax = Math.max(...leftDesc.corners.map(([x]) => left.s + x));
    const rightMin = Math.min(...rightDesc.corners.map(([x]) => right.s + x));
    // Safety expansion on both sides should overlap or meet, never leave a gap.
    assert.ok(leftMax + 1e-6 >= rightMin);
  }
});
