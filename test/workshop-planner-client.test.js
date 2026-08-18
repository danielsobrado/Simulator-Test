import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorkshopPlannerClient } from '../src/editor/workshop/ProceduralWorkshopPlannerClient.js';

function emptyRecipe() {
  return { composition: { primitives: [] } };
}

function fakeWorker() {
  const listeners = new Map();
  const posted = [];
  let terminated = false;
  return {
    posted,
    listeners,
    get terminated() {
      return terminated;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(message) {
      posted.push(message);
    },
    terminate() {
      terminated = true;
    },
  };
}

test('workshop planner fallback reports validation failures asynchronously', async () => {
  const client = new ProceduralWorkshopPlannerClient();
  let result;

  assert.doesNotThrow(() => {
    result = client.plan(emptyRecipe(), ['missing']);
  });
  await assert.rejects(result, /Unknown dirty composition primitive/i);
  client.dispose();
});

test('workshop planner accepts an injected worker without relying on the global Worker API', async () => {
  const worker = fakeWorker();
  const client = new ProceduralWorkshopPlannerClient({ workerFactory: () => worker });
  const result = client.plan(emptyRecipe());

  assert.deepEqual(worker.posted, [{
    revision: 1,
    recipe: emptyRecipe(),
    dirtyIds: [],
  }]);
  const plan = { revisionKey: 'test-plan' };
  worker.listeners.get('message')({ data: { revision: 1, plan } });
  assert.equal(await result, plan);

  client.dispose();
  assert.equal(worker.terminated, true);
});
