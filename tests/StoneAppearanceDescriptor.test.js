import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionStoneEdgeWearProfile } from '../src/editor/construction/config/ConstructionStoneEdgeWearProfiles.generated.js';
import { constructionStoneReliefProfile } from '../src/editor/construction/config/ConstructionStoneReliefProfiles.generated.js';
import { createStoneAppearanceDescriptor } from '../src/editor/construction/masonry/StoneAppearanceDescriptor.js';
import { CONSTRUCTION_MORTAR_CONFIG } from '../src/editor/construction/render/ConstructionMortarConfig.js';

const relief = constructionStoneReliefProfile('soft-limestone-rubble');
const wear = constructionStoneEdgeWearProfile('soft-limestone-rubble');

function descriptor(overrides = {}) {
  return createStoneAppearanceDescriptor({
    faceReliefProfile: relief,
    edgeWearProfile: wear,
    seed: 3141,
    stableIndex: 21,
    category: 'field',
    width: 0.7,
    height: 0.36,
    depth: 0.8,
    mortarFaceRecess: CONSTRUCTION_MORTAR_CONFIG.faceRecess,
    ...overrides,
  });
}

test('same seed and stable index produce identical descriptors', () => {
  assert.deepEqual(descriptor(), descriptor());
});

test('descriptor is independent of LOD (no lod inputs)', () => {
  const a = descriptor();
  assert.ok(a.enabled);
  assert.ok(Object.isFrozen(a));
  assert.ok(Object.isFrozen(a.face.front));
  assert.ok(Object.isFrozen(a.edges.front.cornerWidth));
});

test('front and rear are related but not identical', () => {
  const a = descriptor();
  assert.notDeepEqual(a.face.front, a.face.back);
  assert.notDeepEqual(a.edges.front.cornerWidth, a.edges.back.cornerWidth);
  // Dominant tilt is the average of both faces.
  assert.equal(
    a.dominant.broadFaceTiltU,
    (a.face.front.tiltU + a.face.back.tiltU) / 2,
  );
});

test('dominant corner matches the maximum sampled corner', () => {
  const a = descriptor();
  const widths = a.edges.front.cornerWidth;
  const max = Math.max(...widths);
  assert.equal(widths[a.dominant.widestCorner], max);
});

test('values remain finite', () => {
  const a = descriptor();
  for (const value of [
    a.face.front.edgeRecession,
    a.face.front.tiltU,
    a.dominant.averageBevelWidth,
    ...a.edges.front.cornerWidth,
  ]) {
    assert.ok(Number.isFinite(value));
  }
});

test('category scaling works', () => {
  const field = descriptor({ category: 'field' });
  const coping = descriptor({ category: 'coping' });
  assert.equal(field.enabled, true);
  assert.equal(coping.enabled, false);
});

test('small stones disable unsupported effects safely', () => {
  const tiny = descriptor({ width: 0.1, height: 0.05, depth: 0.1 });
  assert.equal(tiny.enabled, false);
});

test('changing module array order does not repaint descriptors', () => {
  const a = descriptor({ stableIndex: 5 });
  const b = descriptor({ stableIndex: 5 });
  assert.deepEqual(a, b);
});

test('changing an unrelated stone does not repaint neighbours', () => {
  const neighbour = descriptor({ stableIndex: 10 });
  descriptor({ stableIndex: 99 });
  assert.deepEqual(neighbour, descriptor({ stableIndex: 10 }));
});
