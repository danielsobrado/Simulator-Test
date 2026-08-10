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

test('a failed chunk worker is replaced without rejecting healthy worker requests', async () => {
  const originalWorker = globalThis.Worker;
  FakeWorker.instances = [];
  globalThis.Worker = FakeWorker;

  const client = new WorldChunkWorkerClient({
    chunkSize: 16,
    generator: new ProceduralWorldGenerator(),
    workerCount: 2,
  });

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
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});
