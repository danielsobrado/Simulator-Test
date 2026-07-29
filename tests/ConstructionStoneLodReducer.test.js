import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneLodProfile } from '../src/editor/construction/config/ConstructionStoneLodProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { reduceStoneAppearanceForLod } from '../src/editor/construction/compile/ConstructionStoneLodReducer.js';
import { createStoneAppearanceDescriptor } from '../src/editor/construction/masonry/StoneAppearanceDescriptor.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const lodProfile = constructionStoneLodProfile('soft-limestone-rubble');

function baseAppearance() {
  return createStoneAppearanceDescriptor({
    faceReliefProfile: constructionStoneReliefProfile('soft-limestone-rubble'),
    edgeWearProfile: constructionStoneEdgeWearProfile('soft-limestone-rubble'),
    seed: 3141,
    stableIndex: 21,
    category: 'field',
    width: 0.7,
    height: 0.36,
    depth: 0.8,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
  });
}

test('near reduction preserves full descriptor values', () => {
  const appearance = baseAppearance();
  const near = reduceStoneAppearanceForLod({
    appearance,
    lodProfile,
    lodBand: 'near',
  });
  assert.equal(near.face.front.edgeRecession, appearance.face.front.edgeRecession);
  assert.equal(near.face.front.tiltU, appearance.face.front.tiltU);
  assert.equal(near.face.front.saddle, appearance.face.front.saddle);
  assert.deepEqual(near.edges.front.cornerWidth, appearance.edges.front.cornerWidth);
  assert.equal(near.bevelRings, 2);
  assert.equal(near.edgeMidpoints, false);
});

test('coarse reduction preserves dominant tilt and corner', () => {
  const appearance = baseAppearance();
  const coarse = reduceStoneAppearanceForLod({
    appearance,
    lodProfile,
    lodBand: 'coarse',
  });
  assert.equal(Math.sign(coarse.face.front.tiltU), Math.sign(appearance.face.front.tiltU) || 0);
  assert.equal(coarse.dominant.widestCorner, appearance.dominant.widestCorner);
  const nearMax = Math.max(...appearance.edges.front.cornerWidth);
  const coarseMax = Math.max(...coarse.edges.front.cornerWidth);
  assert.equal(
    coarse.edges.front.cornerWidth.indexOf(coarseMax),
    appearance.edges.front.cornerWidth.indexOf(nearMax),
  );
});

test('coarse variation and recession are lower but non-zero', () => {
  const appearance = baseAppearance();
  const coarse = reduceStoneAppearanceForLod({
    appearance,
    lodProfile,
    lodBand: 'coarse',
  });
  const nearSpread = Math.max(...appearance.edges.front.cornerWidth)
    - Math.min(...appearance.edges.front.cornerWidth);
  const coarseSpread = Math.max(...coarse.edges.front.cornerWidth)
    - Math.min(...coarse.edges.front.cornerWidth);
  assert.ok(coarseSpread < nearSpread);
  assert.ok(coarseSpread > 0);
  assert.ok(coarse.face.front.edgeRecession > 0);
  assert.ok(coarse.face.front.edgeRecession < appearance.face.front.edgeRecession);
});

test('coarse removes saddle, flattening, and midpoints', () => {
  const appearance = baseAppearance();
  const coarse = reduceStoneAppearanceForLod({
    appearance,
    lodProfile,
    lodBand: 'coarse',
  });
  assert.equal(coarse.face.front.saddle, 0);
  assert.deepEqual(coarse.cornerFlattening, [0, 0, 0, 0]);
  assert.equal(coarse.edgeMidpoints, false);
  assert.equal(coarse.bevelRings, 1);
});

test('reduction is deterministic and source stays immutable', () => {
  const appearance = baseAppearance();
  const snapshot = structuredClone(appearance);
  const a = reduceStoneAppearanceForLod({ appearance, lodProfile, lodBand: 'coarse' });
  const b = reduceStoneAppearanceForLod({ appearance, lodProfile, lodBand: 'coarse' });
  assert.deepEqual(a, b);
  assert.deepEqual(appearance, snapshot);
});
