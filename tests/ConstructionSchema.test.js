import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CONSTRUCTION_TOP_POINTS,
  constructionPathSegmentIds,
  normalizeConstructionRecord,
} from '../src/editor/construction/ConstructionSchema.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

function path() {
  return createCubicBezierPathFromStroke([
    [0, 0],
    [10, 4],
    [25, 0],
    [36, 3],
  ], { simplifyTolerance: 0.01 });
}

/** A record shaped the way saves looked before top/materials/opening fields. */
function legacyRecord(overrides = {}) {
  return {
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 7,
    kind: 'wall',
    label: 'Curved wall 1',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 1 },
    path: path(),
    features: [],
    ...overrides,
  };
}

test('legacy records load with derivable defaults for the new fields', () => {
  const record = normalizeConstructionRecord(legacyRecord());
  assert.deepEqual(record.top, {
    style: 'flat',
    base: 4,
    profile: [],
  });
  assert.deepEqual(record.style.materials, { stone: null, mortar: null, roof: null });
  assert.equal(record.version, 1, 'the record version stays 1 for a purely additive change');
});

test('normalization is idempotent, so a save round trip is exact', () => {
  const once = normalizeConstructionRecord(legacyRecord());
  const twice = normalizeConstructionRecord(structuredClone(once));
  assert.deepEqual(twice, once);
});

test('top base defaults to the wall height but can be raised independently', () => {
  const record = normalizeConstructionRecord(legacyRecord({
    dimensions: { height: 6, thickness: 1 },
    top: { style: 'crenellated', base: 2.5 },
  }));
  assert.equal(record.top.style, 'crenellated');
  assert.equal(record.top.base, 2.5);
});

test('top profile points are anchored to real segments and bounded', () => {
  const built = path();
  const segmentId = built.segments[0].id;
  const record = normalizeConstructionRecord(legacyRecord({
    path: built,
    top: { style: 'flat', profile: [{ segmentId, arcFraction: 0.5, height: 6 }] },
  }));
  assert.equal(record.top.profile.length, 1);
  assert.equal(record.top.profile[0].height, 6);

  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      top: { profile: [{ segmentId: 'segment-nope', arcFraction: 0.5, height: 6 }] },
    })),
    /missing segment/,
  );
  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      top: { profile: [{ segmentId, arcFraction: 1.5, height: 6 }] },
    })),
    /arc fraction/,
  );
  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      top: {
        profile: Array.from({ length: MAX_CONSTRUCTION_TOP_POINTS + 1 }, () => ({
          segmentId,
          arcFraction: 0.5,
          height: 6,
        })),
      },
    })),
    /at most/,
  );
});

test('unknown top styles and unknown masonry styles are rejected', () => {
  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({ top: { style: 'melted' } })),
    /top style melted/,
  );
  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({ style: { key: 'space-concrete', version: 1 } })),
    /Unknown construction style/,
  );
});

test('soft-limestone-rubble is accepted and typos are rejected', () => {
  const record = normalizeConstructionRecord(legacyRecord({
    style: {
      key: 'soft-limestone-rubble',
      version: 1,
      materials: { stone: 'granite-masonry', mortar: null, roof: null },
    },
  }));
  assert.equal(record.style.key, 'soft-limestone-rubble');
  assert.equal(record.version, 1);
  assert.equal(record.style.materials.stone, 'granite-masonry');

  const again = normalizeConstructionRecord(structuredClone(record));
  assert.deepEqual(again.style, record.style);
  assert.deepEqual(again.dimensions, record.dimensions);
  assert.deepEqual(again.top, record.top);
  assert.equal(again.version, 1);

  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      style: { key: 'soft-limeston-rubble', version: 1 },
    })),
    /Unknown construction style soft-limeston-rubble/,
  );
});

test('opening fields default and validate', () => {
  const built = path();
  const segmentId = built.segments[0].id;
  const record = normalizeConstructionRecord(legacyRecord({
    path: built,
    features: [{ id: 'opening-a', kind: 'arch', segmentId, arcFraction: 0.4 }],
  }));
  const [opening] = record.features;
  assert.equal(opening.sill, 0);
  assert.equal(opening.profile, 'round');
  assert.equal(opening.dressed, true);
  assert.equal(opening.group, null);

  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      path: built,
      features: [{ id: 'opening-a', kind: 'window', segmentId, arcFraction: 0.4, profile: 'ogee' }],
    })),
    /unsupported profile ogee/,
  );
});

test('materials accept preset ids only, so image data cannot enter a record', () => {
  const record = normalizeConstructionRecord(legacyRecord({
    style: { key: 'ashlar', version: 1, materials: { stone: 'granite-masonry' } },
  }));
  assert.equal(record.style.materials.stone, 'granite-masonry');
  assert.equal(record.style.materials.mortar, null);

  assert.throws(
    () => normalizeConstructionRecord(legacyRecord({
      style: { key: 'ashlar', version: 1, materials: { stone: 'data:image/png;base64,AAAA' } },
    })),
    /material/,
  );
});

test('segment ids resolve for both path types', () => {
  const built = path();
  assert.deepEqual(
    [...constructionPathSegmentIds(built)],
    built.segments.map(({ id }) => id),
  );
  const polyline = {
    type: 'polyline',
    closed: false,
    points: [
      { id: 'point-a', position: [0, 0] },
      { id: 'point-b', position: [4, 0] },
    ],
  };
  assert.deepEqual([...constructionPathSegmentIds(polyline)], ['segment-point-a-point-b']);
});
