import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorldChunkWorkerClient } from '../src/editor/world/WorldChunkWorkerClient.js';

class FakeWorker {
  static instances = [];

  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
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

function installFakeWorker() {
  const originalWorker = globalThis.Worker;
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker;
  return () => {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  };
}

function createClient() {
  return new WorldChunkWorkerClient({
    chunkSize: 16,
    generator: new ProceduralWorldGenerator(),
    workerCount: 2,
  });
}

test('a failed chunk worker is replaced without rejecting healthy worker requests', async () => {
  const restoreWorker = installFakeWorker();
  const client = createClient();

  try {
    const failedRequest = client.request(0, 0);
    const healthyRequest = client.request(1, 0);
    assert.equal(FakeWorker.instances.length, 2);

    FakeWorker.instances[0].emit('error', {
      message: 'worker boom',
      preventDefault() {},
    });

    await assert.rejects(failedRequest, /worker boom/);
    assert.equal(FakeWorker.instances[0].terminated, true);
    assert.equal(FakeWorker.instances.length, 3, 'failed worker should be replaced in-place');
    assert.equal(client.workerCount, 2);

    FakeWorker.instances[1].emit('message', {
      data: { id: 2, page: { chunkX: 1, chunkZ: 0 } },
    });
    const healthyPage = await healthyRequest;
    assert.equal(healthyPage.chunkX, 1);

    const replacementRequest = client.request(2, 0);
    const replacement = FakeWorker.instances[2];
    assert.equal(replacement.messages.at(-1).id, 3);
    replacement.emit('message', {
      data: { id: 3, page: { chunkX: 2, chunkZ: 0 } },
    });
    const replacementPage = await replacementRequest;
    assert.equal(replacementPage.chunkX, 2);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('a stale error from a terminated worker cannot kill its replacement', () => {
  const restoreWorker = installFakeWorker();
  const client = createClient();

  try {
    const original = FakeWorker.instances[0];
    original.emit('error', { message: 'first failure', preventDefault() {} });

    const replacement = FakeWorker.instances[2];
    assert.equal(client.workers[0], replacement);
    assert.equal(replacement.terminated, false);

    original.emit('error', { message: 'stale failure', preventDefault() {} });

    assert.equal(client.workers[0], replacement);
    assert.equal(replacement.terminated, false);
    assert.equal(FakeWorker.instances.length, 3);
    assert.equal(client.workerRestartCounts[0], 1);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('a synchronous postMessage failure releases the worker slot', async () => {
  const restoreWorker = installFakeWorker();
  const client = createClient();

  try {
    const worker = FakeWorker.instances[0];
    worker.postMessage = () => { throw new Error('clone failed'); };

    await assert.rejects(client.request(0, 0), /clone failed/);
    assert.equal(client.pending.size, 0);
    assert.equal(client.inFlight[0], 0);

    worker.postMessage = FakeWorker.prototype.postMessage.bind(worker);
    const recoveredRequest = client.request(1, 0);
    assert.equal(worker.messages.at(-1).id, 2);
    worker.emit('message', {
      data: { id: 2, page: { chunkX: 1, chunkZ: 0 } },
    });
    assert.equal((await recoveredRequest).chunkX, 1);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('a permanently failing worker slot is disabled without taking down healthy workers', () => {
  const restoreWorker = installFakeWorker();
  const originalConsoleError = console.error;
  console.error = () => {};
  const client = createClient();

  try {
    FakeWorker.instances[0].emit('error', { message: 'boom 1', preventDefault() {} });
    FakeWorker.instances[2].emit('error', { message: 'boom 2', preventDefault() {} });
    FakeWorker.instances[3].emit('error', { message: 'boom 3', preventDefault() {} });

    assert.equal(FakeWorker.instances.length, 4, 'restart attempts must be bounded');
    assert.equal(client.workerCount, 1);
    assert.equal(client.workers[0], null);
    assert.equal(client.workers[1], FakeWorker.instances[1]);
  } finally {
    client.dispose();
    console.error = originalConsoleError;
    restoreWorker();
  }
});
