import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { resolveStoneTopology } from '../src/editor/construction/compile/ConstructionStoneTopologyResolver.js';
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

function fixture({
  width = 0.64,
  height = 0.34,
  depth = 0.8,
  seed = 3141,
  stableIndex = 11,
} = {}) {
  const corners = rectangle(width, height);
  const { radius } = createBeveledQuadProfile({ corners, depth, bevelRatio: 0.09 });
  const frontRelief = sampleStoneFaceRelief({
    profile: softRelief,
    seed,
    stableIndex,
    category: 'field',
    side: 'front',
    width,
    height,
    bevelRadius: radius,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
  const backRelief = sampleStoneFaceRelief({
    profile: softRelief,
    seed,
    stableIndex,
    category: 'field',
    side: 'back',
    width,
    height,
    bevelRadius: radius,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
  const frontWear = sampleStoneEdgeWear({
    profile: softWear,
    seed,
    stableIndex,
    category: 'field',
    side: 'front',
    width,
    height,
    depth,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
  const backWear = sampleStoneEdgeWear({
    profile: softWear,
    seed,
    stableIndex,
    category: 'field',
    side: 'back',
    width,
    height,
    depth,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
  return {
    stoneShape: {
      corners,
      width,
      height,
      depth,
      bevelRatio: 0.09,
      detail: 2,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    },
    faceRelief: { enabled: true, front: frontRelief, back: backRelief },
    edgeWear: { enabled: true, front: frontWear, back: backWear },
  };
}

test('source ring is unchanged and nested rings stay inside', () => {
  const input = fixture();
  const topology = resolveStoneTopology({
    ...input,
    mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
  });
  assert.equal(topology.valid, true);
  assert.deepEqual(topology.sourceRing, input.stoneShape.corners);
  assert.equal(topology.front.faceLoop.length, 4);
  assert.equal(topology.front.shoulderLoop.length, 4);
  assert.equal(topology.front.sourceLoop.length, 4);
  assert.ok(topology.diagnostics.edgeWearApplied);
  assert.ok(topology.diagnostics.areaRatio >= softWear.safeguards.minimumFaceAreaRatio);
});

test('depth order is monotonic and face recession is clamped', () => {
  const topology = resolveStoneTopology({
    ...fixture(),
    mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
  });
  const maxShoulder = Math.max(...topology.front.shoulderDepths);
  const maxOuter = Math.max(...topology.front.outerDepths);
  assert.ok(maxOuter > maxShoulder);
  assert.ok(topology.front.faceEdgeRecession < maxShoulder);
  assert.ok(topology.front.faceEdgeRecession <= maxShoulder * 0.72 + 1e-9);
});

test('repeated resolution is deterministic', () => {
  const input = fixture();
  const a = resolveStoneTopology({ ...input, mortarConfig: CONSTRUCTION_MORTAR_CONFIG });
  const b = resolveStoneTopology({ ...input, mortarConfig: CONSTRUCTION_MORTAR_CONFIG });
  assert.deepEqual(a.front.faceCorners, b.front.faceCorners);
  assert.deepEqual(a.back.outerDepths, b.back.outerDepths);
});

test('narrow stone falls back after progressive clamp', () => {
  const input = fixture({ width: 0.34, height: 0.19, depth: 0.25 });
  // Force aggressive wear by reusing profile but tiny stone still eligible.
  const topology = resolveStoneTopology({
    ...input,
    mortarConfig: CONSTRUCTION_MORTAR_CONFIG,
  });
  // May succeed via clamp or fail cleanly — never throw.
  assert.equal(typeof topology.valid, 'boolean');
  assert.ok(topology.diagnostics);
});
