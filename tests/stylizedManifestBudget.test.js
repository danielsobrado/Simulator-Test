import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';
import { StylizedGrassSlot } from '../src/editor/stylized/StylizedGrassSlot.js';
import { StylizedRockView } from '../src/editor/stylized/StylizedRockView.js';
import {
  shouldScheduleTreeLodRebuild,
  StylizedTreeView,
} from '../src/editor/stylized/StylizedTreeView.js';
import { TreeManifestStore } from '../src/editor/stylized/TreeManifestStore.js';

test('rock blocker preparation advances by one cold manifest per frame', () => {
  const manifests = new Map();
  const view = Object.create(StylizedRockView.prototype);
  view.blockerRequests = new Set();
  view.manifestBuildsThisFrame = 0;
  view.manifestBuildBudgetMs = 100;
  view.manifestFrameStartedAt = performance.now();
  view.cachedManifestForChunk = (chunkX, chunkZ) => (
    manifests.get(`${chunkX}:${chunkZ}`) ?? null
  );
  view.manifestForChunk = (chunkX, chunkZ) => {
    const placements = [{ chunkX, chunkZ }];
    manifests.set(`${chunkX}:${chunkZ}`, placements);
    return placements;
  };

  for (let frame = 0; frame < 8; frame += 1) {
    assert.equal(view.getPreparedBlockersForChunk(4, 7, 1), null);
    assert.equal(manifests.size, frame + 1);
    view.manifestBuildsThisFrame = 0;
    view.manifestFrameStartedAt = performance.now();
  }

  const blockers = view.getPreparedBlockersForChunk(4, 7, 1);
  assert.equal(manifests.size, 9);
  assert.equal(blockers.length, 9);
  assert.equal(view.blockerRequests.size, 9);
});

test('tree manifest jobs remain queued while their blocker halo is preparing', () => {
  const store = Object.create(TreeManifestStore.prototype);
  store.queue = new StylizedBuildQueue({ buildsPerFrame: 1, budgetMs: 100 });
  store.pendingKeys = new Set(['2:3']);
  store.activeKeys = new Set(['2:3']);
  let attempts = 0;
  let notifications = 0;
  store.build = () => {
    attempts += 1;
    return attempts === 1 ? null : [];
  };
  store.onBuilt = () => {
    notifications += 1;
  };
  store.queue.enqueue({
    key: '2:3',
    chunkX: 2,
    chunkZ: 3,
    rockSource: {},
    priority: 0,
  });

  assert.deepEqual(store.flush(), { built: 1, remaining: 1 });
  assert.equal(store.pendingKeys.has('2:3'), true);
  assert.equal(notifications, 0);

  assert.deepEqual(store.flush(), { built: 1, remaining: 0 });
  assert.equal(store.pendingKeys.has('2:3'), false);
  assert.equal(notifications, 1);
});

test('prewarmed grass slots pin their reusable resources', () => {
  const slot = Object.create(StylizedGrassSlot.prototype);
  slot.resourcesPinned = false;
  let allocations = 0;
  slot.ensureResources = () => {
    allocations += 1;
  };

  slot.pinResources();

  assert.equal(allocations, 1);
  assert.equal(slot.resourcesPinned, true);
});

test('tree LOD rebuilds batch manifest arrivals while preserving final updates', () => {
  const common = {
    planChanged: true,
    manifestsBuilt: true,
    queueRemaining: 20,
    lastRebuildAt: 100,
    minimumIntervalMs: 33,
  };
  assert.equal(shouldScheduleTreeLodRebuild({ ...common, timestamp: 120 }), false);
  assert.equal(shouldScheduleTreeLodRebuild({ ...common, timestamp: 133 }), true);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 101,
    queueRemaining: 0,
  }), true);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 101,
    manifestsBuilt: false,
    queueRemaining: 0,
  }), false);
  assert.equal(shouldScheduleTreeLodRebuild({
    ...common,
    timestamp: 200,
    planChanged: false,
    manifestsBuilt: false,
  }), false);
  assert.equal(typeof StylizedTreeView, 'function');
});
