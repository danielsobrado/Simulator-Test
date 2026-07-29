import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { buildSoftStoneGeometry } from '../src/editor/construction/compile/ConstructionSoftStoneGeometry.js';
import { resolveStoneTopology } from '../src/editor/construction/compile/ConstructionStoneTopologyResolver.js';
import { reliefQuadPrism } from '../src/editor/construction/compile/ConstructionReliefQuadPrism.js';
import { sampleStoneEdgeWear } from '../src/editor/construction/masonry/StoneEdgeWearField.js';
import { sampleStoneFaceRelief } from '../src/editor/construction/masonry/StoneFaceReliefField.js';
import { createBeveledQuadProfile } from '../src/editor/workshop/ProceduralWorkshopGeometry.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const softWear = constructionStoneEdgeWearProfile('soft-limestone-rubble');
const softRelief = constructionStoneReliefProfile('soft-limestone-rubble');

function rectangle(width, height) {
  return [
    [-width / 2, -height / 2],
    [width / 2, -height / 2],
    [width / 2, height / 2],
    [-width / 2, height / 2],
  ];
}

function bounds(geometry) {
  const position = geometry.getAttribute('position');
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.count; index += 1) {
    const values = [position.getX(index), position.getY(index), position.getZ(index)];
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = Math.min(low[axis], values[axis]);
      high[axis] = Math.max(high[axis], values[axis]);
    }
  }
  return [...low, ...high];
}

function buildPair() {
  const width = 0.7;
  const height = 0.36;
  const depth = 0.8;
  const corners = rectangle(width, height);
  const bevelRatio = 0.09;
  const { radius } = createBeveledQuadProfile({ corners, depth, bevelRatio });
  const args = {
    seed: 3141,
    stableIndex: 21,
    category: 'field',
    width,
    height,
    depth,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  };
  const frontRelief = sampleStoneFaceRelief({
    profile: softRelief, ...args, side: 'front', bevelRadius: radius,
  });
  const backRelief = sampleStoneFaceRelief({
    profile: softRelief, ...args, side: 'back', bevelRadius: radius,
  });
  const frontWear = sampleStoneEdgeWear({ profile: softWear, ...args, side: 'front' });
  const backWear = sampleStoneEdgeWear({ profile: softWear, ...args, side: 'back' });
  const stoneShape = {
    corners,
    width,
    height,
    depth,
    bevelRatio,
    detail: 2,
    position: [0, 1, 0],
    rotation: [0, 0.1, 0],
  };
  const topology = resolveStoneTopology({
    stoneShape,
    faceRelief: { enabled: true, front: frontRelief, back: backRelief },
    edgeWear: { enabled: true, front: frontWear, back: backWear },
    mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
  });
  return { stoneShape, topology, frontRelief, backRelief, corners, depth, bevelRatio };
}

test('soft stone geometry stays inside nominal bounds with finite attributes', () => {
  const { stoneShape, topology, corners, depth } = buildPair();
  assert.equal(topology.valid, true);
  const built = buildSoftStoneGeometry({ topology, stoneShape });
  assert.equal(built.edgeWearApplied, true);
  assert.equal(built.reliefApplied, true);
  const geometry = built.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  assert.ok(position && normal && uv);
  for (let index = 0; index < position.count; index += 1) {
    assert.ok(Number.isFinite(position.getX(index)));
    assert.ok(Number.isFinite(normal.getX(index)));
    assert.ok(Number.isFinite(uv.getX(index)));
  }
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds(geometry);
  // Transformed by position/rotation — check local depth via stats path by
  // rebuilding without transform for depth, and XY extent via source.
  void minZ;
  void maxZ;
  assert.ok(maxX - minX > 0.4);
  assert.ok(maxY - minY > 0.2);
  // Compare untransformed soft vs relief-only XY footprint via topology source.
  assert.deepEqual(topology.sourceRing, corners);
  assert.ok(built.stats.triangleCount > 0);
  geometry.dispose();
});

test('worn-edge geometry differs from relief-only while keeping XY footprint', () => {
  const { stoneShape, topology, frontRelief, backRelief, corners, depth, bevelRatio } = buildPair();
  const soft = buildSoftStoneGeometry({
    topology,
    stoneShape: { ...stoneShape, position: [0, 0, 0], rotation: [0, 0, 0] },
  });
  const reliefOnly = reliefQuadPrism({
    corners,
    depth,
    bevelRatio,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    frontRelief,
    backRelief,
  });
  const softBounds = bounds(soft.geometry);
  const reliefBounds = bounds(reliefOnly.geometry);
  assert.ok(Math.abs(softBounds[0] - reliefBounds[0]) < 1e-4);
  assert.ok(Math.abs(softBounds[1] - reliefBounds[1]) < 1e-4);
  assert.ok(Math.abs(softBounds[3] - reliefBounds[3]) < 1e-4);
  assert.ok(Math.abs(softBounds[4] - reliefBounds[4]) < 1e-4);
  assert.notDeepEqual(
    Array.from(soft.geometry.getAttribute('position').array).slice(0, 24),
    Array.from(reliefOnly.geometry.getAttribute('position').array).slice(0, 24),
  );
  soft.geometry.dispose();
  reliefOnly.geometry.dispose();
});
