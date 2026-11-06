import assert from 'node:assert/strict';
import test from 'node:test';
import { InstancedBufferAttribute, Scene, Mesh, PlaneGeometry, MeshBasicMaterial } from 'three/webgpu';
import Attributes from 'three/src/renderers/common/Attributes.js';
import { BudgetedAttributeInitialization } from '../src/render/preparation/BudgetedAttributeInitialization.js';
import { StreamedDrawPreparation, INITIAL_UPLOAD_BYTES_PER_FRAME } from '../src/render/preparation/StreamedDrawPreparation.js';

function fixture(t) {
  const previous = globalThis.GPUBufferUsage;
  globalThis.GPUBufferUsage = { VERTEX: 32, COPY_SRC: 4, COPY_DST: 8 };
  t.after(() => { if (previous === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage = previous; });
  const data = new Map(), writes = [], buffers = [];
  const backend = { isWebGPUBackend: true,
    get(attribute) { if (!data.has(attribute)) data.set(attribute, {}); return data.get(attribute); },
    createAttribute(attribute) { assert.ok(this.get(attribute).buffer, 'Three must adopt the preallocated buffer'); },
    destroyAttribute(attribute) { this.get(attribute).buffer.destroy(); data.delete(attribute); },
    device: {
      createBuffer({ size, mappedAtCreation }) {
        assert.notEqual(mappedAtCreation, true, 'initialization must not copy the entire source at allocation');
        const buffer = { data: new Float32Array(size / 4), destroyed: false, destroy() { this.destroyed = true; } };
        buffers.push(buffer); return buffer;
      },
      queue: { writeBuffer(buffer, offset, array, start, count) {
        writes.push(count * 4); buffer.data.set(array.subarray(start, start + count), offset / 4);
      } },
    },
  };
  const renderer = { backend, _attributes: new Attributes(backend, { createAttribute() {}, destroyAttribute() {} }) };
  const initializer = new BudgetedAttributeInitialization(renderer);
  t.after(() => { initializer.cancel(); renderer._attributes.dispose(); });
  const attributes = [4, 2, 4, 4].map((width, i) =>
    new InstancedBufferAttribute(new Float32Array(65536 * width).fill(i + 0.25), width));
  return { renderer, initializer, attributes, writes, buffers };
}

test('a 3.5 MiB page initializes in bounded uploads with exact final bytes', t => {
  const { initializer, attributes, renderer, writes } = fixture(t);
  let ready = false, frames = 0;
  while (!ready) {
    const first = writes.length;
    ({ ready } = initializer.advance(attributes, INITIAL_UPLOAD_BYTES_PER_FRAME));
    assert.ok(writes.slice(first).reduce((n, bytes) => n + bytes, 0) <= INITIAL_UPLOAD_BYTES_PER_FRAME);
    assert.ok(++frames < 10);
  }
  assert.equal(frames, 5);
  for (const attribute of attributes) {
    assert.deepEqual(renderer.backend.get(attribute).buffer.data, attribute.array);
    assert.equal(renderer._attributes.get(attribute).version, attribute.version);
    assert.equal(attribute.updateRanges.length, 0);
  }
  initializer.release(attributes);
});

test('source changes during initialization restart affected attributes and preserve the newest values', t => {
  const { initializer, attributes, renderer } = fixture(t);
  initializer.advance(attributes, INITIAL_UPLOAD_BYTES_PER_FRAME);
  attributes[0].array[0] = 17;
  attributes[0].needsUpdate = true;
  let ready = false;
  for (let frame = 0; frame < 10 && !ready; frame++) {
    ({ ready } = initializer.advance(attributes, INITIAL_UPLOAD_BYTES_PER_FRAME));
  }
  assert.equal(ready, true);
  for (const attribute of attributes) assert.deepEqual(renderer.backend.get(attribute).buffer.data, attribute.array);
});

test('initialization respects an exhausted deadline and releases undrawn buffers on cancellation', t => {
  const { initializer, attributes, renderer, buffers } = fixture(t);
  assert.equal(initializer.advance(attributes, 1024, () => true).bytes, 0);
  assert.equal(buffers.length, 0);
  initializer.advance(attributes, 1024);
  assert.equal(buffers.length, 1);
  initializer.cancel(attributes);
  assert.equal(buffers[0].destroyed, true);
  assert.equal(renderer._attributes.has(attributes[0]), false);
});

test('draw preparation keeps a large page pending until initialization completes, using one draw', t => {
  const { renderer, attributes, writes } = fixture(t);
  const scene = new Scene(), geometry = new PlaneGeometry(), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); scene.add(mesh);
  let renders = 0;
  const preparation = new StreamedDrawPreparation({ scene, renderer, settings: { enabled: true, meshesPerFrame: 2 },
    render: () => { renders++; for (const attribute of attributes) assert.deepEqual(renderer.backend.get(attribute).buffer.data, attribute.array); } });
  t.after(() => { preparation.dispose(); geometry.dispose(); material.dispose(); });
  preparation.register(mesh, { uploadBytes: 3670016, uploadAttributes: attributes });
  for (let frame = 0; frame < 5; frame++) {
    const first = writes.length;
    preparation.flush(null);
    assert.ok(writes.slice(first).reduce((n, bytes) => n + bytes, 0) <= INITIAL_UPLOAD_BYTES_PER_FRAME);
    assert.equal(preparation.isMaterialReady(mesh, material), frame === 4);
    assert.equal(renders, frame === 4 ? 1 : 0);
  }
  assert.equal(preparation.pending.size, 0);
});

test('allocation errors retain the existing preparation fallback and do not strand hidden meshes', t => {
  const { renderer, attributes } = fixture(t);
  renderer.backend.device.createBuffer = () => { throw new Error('allocation failed'); };
  const scene = new Scene(), geometry = new PlaneGeometry(), material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material); scene.add(mesh);
  const preparation = new StreamedDrawPreparation({ scene, renderer, settings: { enabled: true, meshesPerFrame: 1 }, render() {} });
  t.after(() => { preparation.dispose(); geometry.dispose(); material.dispose(); });
  preparation.register(mesh, { uploadBytes: 3670016, uploadAttributes: attributes });
  t.mock.method(console, 'warn', () => {});
  preparation.flush(null);
  assert.equal(preparation.settings.enabled, false);
  assert.equal(preparation.pending.size, 0);
  assert.equal(preparation.isMaterialReady(mesh, material), true);
});
