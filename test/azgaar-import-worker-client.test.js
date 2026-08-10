import assert from 'node:assert/strict';
import test from 'node:test';

import { AzgaarImportWorkerClient } from '../src/editor/import/AzgaarImportWorkerClient.js';

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

test('worker failure rejects the active import and disables the failed worker', async () => {
  const restoreWorker = installFakeWorker();
  const client = new AzgaarImportWorkerClient();

  try {
    const request = client.convert({ source: true }, { config: true });
    const worker = FakeWorker.instances[0];
    worker.emit('error', { message: 'import worker failed', preventDefault() {} });

    await assert.rejects(request, /import worker failed/);
    assert.equal(worker.terminated, true);
    assert.equal(client.worker, null);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('synchronous worker dispatch failure does not leak a pending import', async () => {
  const restoreWorker = installFakeWorker();
  const client = new AzgaarImportWorkerClient();

  try {
    client.worker.postMessage = () => { throw new Error('clone failed'); };
    await assert.rejects(client.convert({}, {}), /clone failed/);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('invalid worker responses reject instead of resolving an unusable world', async () => {
  const restoreWorker = installFakeWorker();
  const client = new AzgaarImportWorkerClient();

  try {
    const request = client.convert({}, {});
    FakeWorker.instances[0].emit('message', { data: { id: 1, world: null } });
    await assert.rejects(request, /invalid world document/);
    assert.equal(client.pending.size, 0);
  } finally {
    client.dispose();
    restoreWorker();
  }
});

test('disposed importer rejects new work instead of falling back to the main thread', async () => {
  const restoreWorker = installFakeWorker();
  const client = new AzgaarImportWorkerClient();

  try {
    client.dispose();
    await assert.rejects(client.convert({}, {}), /disposed/);
  } finally {
    client.dispose();
    restoreWorker();
  }
});
