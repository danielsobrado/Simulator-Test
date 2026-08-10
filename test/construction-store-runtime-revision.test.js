import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONSTRUCTION_RECORD_VERSION,
  CUBIC_BEZIER_PATH_VERSION,
} from '../src/editor/construction/ConstructionSchema.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { DEFAULT_CONSTRUCTION_STYLE_KEY } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';

function wallRecord(revision) {
  return {
    version: CONSTRUCTION_RECORD_VERSION,
    id: 'runtime-revision-wall',
    revision,
    seed: 42,
    kind: 'wall',
    label: 'Runtime revision wall',
    style: {
      key: DEFAULT_CONSTRUCTION_STYLE_KEY,
      version: 1,
      materials: {},
    },
    dimensions: { height: 3.5, thickness: 0.8 },
    top: { style: 'flat', base: 3.5, profile: [] },
    path: {
      version: CUBIC_BEZIER_PATH_VERSION,
      type: 'cubicBezier',
      closed: false,
      anchors: [
        { id: 'anchor-a', position: [0, 0] },
        { id: 'anchor-b', position: [8, 0] },
      ],
      segments: [{
        id: 'segment-a-b',
        startAnchorId: 'anchor-a',
        endAnchorId: 'anchor-b',
        startHandle: [2, 0],
        endHandle: [-2, 0],
      }],
      features: [],
    },
    features: [],
  };
}

test('replacing a world rebases reused construction ids above their runtime revision', () => {
  const store = new ConstructionStore([wallRecord(8)]);
  try {
    store.replaceAll([wallRecord(2)]);
    assert.equal(store.get('runtime-revision-wall').revision, 9);

    store.replaceAll([wallRecord(1)]);
    assert.equal(store.get('runtime-revision-wall').revision, 10);
  } finally {
    store.clear();
  }
});

test('clearing and reusing a construction id preserves the runtime revision watermark', () => {
  const store = new ConstructionStore([wallRecord(4)]);
  try {
    store.clear();
    const restored = store.add(wallRecord(1));
    assert.equal(restored.revision, 5);
  } finally {
    store.clear();
  }
});

test('failed duplicate replacement does not advance runtime revision watermarks', () => {
  const store = new ConstructionStore([wallRecord(3)]);
  try {
    assert.throws(
      () => store.replaceAll([wallRecord(1), wallRecord(1)]),
      /duplicates/,
    );
    assert.equal(store.get('runtime-revision-wall').revision, 3);
    assert.equal(store.revisionWatermarks.get('runtime-revision-wall'), 3);
  } finally {
    store.clear();
  }
});
