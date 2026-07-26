import assert from 'node:assert/strict';
import test from 'node:test';
import {
  markAttributeRangeUpdated,
  markAttributeSubrangeUpdated,
} from '../src/editor/stylized/attributeUpload.js';

/**
 * Minimal stand-in for `THREE.BufferAttribute`'s update-range bookkeeping.
 * Three.js clears the ranges itself once the backend has uploaded them, which is
 * the state this test drives: `upload()` is the frame where the mesh was drawn,
 * and skipping it is the frame where it was frustum culled.
 */
function createAttribute(itemSize) {
  return {
    itemSize,
    array: new Float32Array(itemSize * 64),
    updateRanges: [],
    needsUpdate: false,
    addUpdateRange(start, count) {
      this.updateRanges.push({ start, count });
    },
    clearUpdateRanges() {
      this.updateRanges.length = 0;
    },
    upload() {
      const uploaded = [...this.updateRanges];
      this.clearUpdateRanges();
      this.needsUpdate = false;
      return uploaded;
    },
  };
}

function covers(ranges, index, itemSize) {
  const start = index * itemSize;
  return ranges.some((range) => range.start <= start && start + itemSize <= range.start + range.count);
}

test('a subrange covers exactly the marked instances', () => {
  const attribute = createAttribute(16);
  markAttributeSubrangeUpdated(attribute, 2, 4);
  assert.deepEqual(attribute.updateRanges, [{ start: 32, count: 48 }]);
  assert.equal(attribute.needsUpdate, true);
});

test('nothing is queued when no instance changed', () => {
  const attribute = createAttribute(1);
  assert.equal(markAttributeSubrangeUpdated(attribute, Infinity, -1), 0);
  assert.deepEqual(attribute.updateRanges, []);
});

test('a range that has not been uploaded yet survives the next mark', () => {
  // The mesh was frustum culled on the frame that dirtied instances 40-42, so
  // three.js never uploaded them and never cleared the range. Replacing it would
  // strand those instances on stale matrices forever, because `writeInstances`
  // skips values it has already written to the CPU array.
  const attribute = createAttribute(16);
  markAttributeSubrangeUpdated(attribute, 40, 42);
  markAttributeSubrangeUpdated(attribute, 1, 3);
  const uploaded = attribute.upload();
  assert.ok(covers(uploaded, 41, 16), 'the culled frame\'s instances must still upload');
  assert.ok(covers(uploaded, 2, 16), 'the current frame\'s instances must still upload');
});

test('an uploaded range is not re-sent by the next mark', () => {
  const attribute = createAttribute(1);
  markAttributeSubrangeUpdated(attribute, 40, 42);
  attribute.upload();
  markAttributeSubrangeUpdated(attribute, 1, 3);
  assert.deepEqual(attribute.updateRanges, [{ start: 1, count: 3 }]);
});

test('two far-apart chunks stay two small ranges, not the span between them', () => {
  const attribute = createAttribute(16);
  markAttributeSubrangeUpdated(attribute, 0, 1);
  markAttributeSubrangeUpdated(attribute, 60, 61);
  assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 32 }, { start: 960, count: 32 }]);
});

test('a mesh left undrawn for many rebuilds keeps a bounded range list', () => {
  const attribute = createAttribute(1);
  for (let mark = 0; mark < 24; mark += 1) {
    markAttributeSubrangeUpdated(attribute, mark * 2, mark * 2);
  }
  assert.ok(attribute.updateRanges.length <= 8, 'ranges must not grow without bound');
  const uploaded = attribute.upload();
  for (let mark = 0; mark < 24; mark += 1) {
    assert.ok(covers(uploaded, mark * 2, 1), `instance ${mark * 2} must still upload`);
  }
});

test('the full-prefix marker queues every used element', () => {
  const attribute = createAttribute(4);
  markAttributeRangeUpdated(attribute, 5);
  assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 20 }]);
});
