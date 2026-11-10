import assert from 'node:assert/strict';
import test from 'node:test';
import { InteriorNumericBuffer, INTERIOR_BUFFER_PAGE_ELEMENTS } from '../src/editor/world/settlements/view/interior/InteriorNumericBuffer.js';
import { drainJob } from '../src/editor/world/settlements/SettlementArrayJobs.js';

test('interior appends retain prior pages and yield bounded copies with exact float32 values', () => {
  const buffer = new InteriorNumericBuffer(Float32Array, 7);
  const expected = [];
  for (let index = 0; index < 25; index++) {
    const values = [index / 7, -index / 11, index === 0 ? -0 : index / 13];
    buffer.push(...values); expected.push(...values);
  }
  const first = buffer.pages[0].array;
  buffer.push(1, 2); expected.push(1, 2);
  assert.equal(buffer.pages[0].array, first, 'growth never copies a previous page');
  const copied = [], job = buffer.toArrayJob(bytes => copied.push(bytes));
  let step;
  do {
    const before = copied.length;
    step = job.next();
    assert.ok(copied.length - before <= 1, 'at most one page copied per scheduling step');
  } while (!step.done);
  const floats = new Float32Array(expected);
  assert.deepEqual(new Uint32Array(step.value.buffer), new Uint32Array(floats.buffer));
  assert.ok(copied.every(bytes => bytes <= 7 * 4));
  assert.equal(copied.reduce((sum, bytes) => sum + bytes, 0), floats.byteLength);
  assert.equal(buffer.pages.length, 0, 'source pages released after finalization');
  assert.equal(buffer.current, null);
  assert.throws(() => buffer.push(1), /finalized/);
});

test('production interior pages cap copies at 48 KiB and preserve uint32 indices', () => {
  const floats = new InteriorNumericBuffer();
  for (let index = 0; index < INTERIOR_BUFFER_PAGE_ELEMENTS + 1; index++) floats.push(index / 9);
  const job = floats.toArrayJob();
  assert.equal(job.next().value, 48 * 1024);
  assert.equal(job.next().value, 4);
  assert.equal(job.next().value.length, INTERIOR_BUFFER_PAGE_ELEMENTS + 1);
  const indices = new InteriorNumericBuffer(Uint32Array, 3);
  indices.push(65534, 65535, 65536); indices.push(262137, 262138, 262139);
  assert.deepEqual(drainJob(indices.toArrayJob()), new Uint32Array([65534, 65535, 65536, 262137, 262138, 262139]));
  assert.deepEqual(drainJob(new InteriorNumericBuffer().toArrayJob()), new Float32Array());
});
