import assert from 'node:assert/strict';
import test from 'node:test';

import { ConstructionCompilerClient } from '../src/editor/construction/compile/ConstructionCompilerClient.js';

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function createClient() {
  const worker = new FakeWorker();
  const client = new ConstructionCompilerClient({ workerFactory: () => worker });
  return { client, worker };
}

test('an older construction revision cannot supersede a newer pending compile', async () => {
  const { client, worker } = createClient();
  try {
    const newer = client.compile({ id: 'wall-1', revision: 2 });
    await assert.rejects(
      client.compile({ id: 'wall-1', revision: 1 }),
      (error) => error?.name === 'AbortError',
    );

    assert.equal(client.revisions.get('wall-1'), 2);
    assert.equal(client.pending.size, 1);

    worker.emit('message', { data: { requestId: 1, plan: { revision: 2 } } });
    assert.deepEqual(await newer, { revision: 2 });
  } finally {
    client.dispose();
  }
});

test('synchronous construction worker dispatch failure clears pending state', async () => {
  const { client, worker } = createClient();
  try {
    worker.postMessage = () => { throw new Error('clone failed'); };
    await assert.rejects(client.compile({ id: 'wall-1', revision: 1 }), /clone failed/);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
  }
});

test('construction worker failure disables the worker and rejects active compiles', async () => {
  const { client, worker } = createClient();
  try {
    const request = client.compile({ id: 'wall-1', revision: 1 });
    worker.emit('error', { message: 'compiler failed', preventDefault() {} });

    await assert.rejects(request, /compiler failed/);
    assert.equal(worker.terminated, true);
    assert.equal(client.worker, null);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
  }
});

test('construction worker response deserialization failure rejects active compiles', async () => {
  const { client, worker } = createClient();
  try {
    const request = client.compile({ id: 'wall-1', revision: 1 });
    worker.emit('messageerror', { preventDefault() {} });

    await assert.rejects(request, /could not be deserialized/);
    assert.equal(worker.terminated, true);
    assert.equal(client.worker, null);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
  }
});

test('invalid construction worker plans are rejected', async () => {
  const { client, worker } = createClient();
  try {
    const request = client.compile({ id: 'wall-1', revision: 1 });
    worker.emit('message', { data: { requestId: 1, plan: null } });
    await assert.rejects(request, /invalid plan/);
  } finally {
    client.dispose();
  }
});

test('disposed construction compiler rejects new work', async () => {
  const { client } = createClient();
  client.dispose();
  await assert.rejects(
    client.compile({ id: 'wall-1', revision: 1 }),
    (error) => error?.name === 'AbortError' && /disposed/.test(error.message),
  );
});

test('main-thread construction fallback rejects work disposed before compilation starts', async () => {
  const client = new ConstructionCompilerClient({ workerFactory: () => null });
  const request = client.compile({ id: 'wall-1', revision: 0 });
  client.dispose();

  await assert.rejects(
    request,
    (error) => error?.name === 'AbortError' && /disposed/.test(error.message),
  );
});
