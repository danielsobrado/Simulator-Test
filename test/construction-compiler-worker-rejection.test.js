import assert from 'node:assert/strict';
import test from 'node:test';

import { constructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { ConstructionCompilerClient } from '../src/editor/construction/compile/ConstructionCompilerClient.js';

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emitMessage(data) {
    this.listeners.get('message')?.({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

test('worker collision publication failure rejects the compile promise', async () => {
  const worker = new FakeWorker();
  const client = new ConstructionCompilerClient({ workerFactory: () => worker });
  const record = { id: 'worker-wall', revision: 1 };
  constructionCollisionSource.clear();
  constructionCollisionSource.setActive(record);

  try {
    const compilePromise = client.compile(record);
    const [{ requestId }] = worker.messages;
    const invalidPlan = {
      collision: {
        version: 1,
        constructionId: record.id,
        constructionRevision: record.revision,
        bounds: {
          minX: 0,
          minZ: 0,
          maxX: Number.POSITIVE_INFINITY,
          maxZ: 1,
        },
        boxes: [],
      },
    };

    assert.doesNotThrow(() => worker.emitMessage({ requestId, plan: invalidPlan }));
    await assert.rejects(compilePromise, /bounds maxX must be finite/);
  } finally {
    client.dispose();
    constructionCollisionSource.clear();
  }
});
