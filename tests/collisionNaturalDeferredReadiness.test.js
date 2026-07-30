import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { NaturalCollisionProvider } from '../src/editor/collision/providers/NaturalCollisionProvider.js';
import {
  createTreeCollisionSource,
} from '../src/editor/collision/providers/TreeCollisionSource.js';
import { TreeCollisionProvider } from '../src/editor/collision/providers/TreeCollisionProvider.js';

const RESIDENCY_CONFIG = Object.freeze({
  residentRadius: 0,
  unloadRadius: 1,
  prefetchSeconds: 0.5,
  buildsPerFrame: 1,
  buildBudgetMs: 10,
});

function attribute(points) {
  return {
    count: points.length,
    getX: (index) => points[index][0],
    getY: (index) => points[index][1],
    getZ: (index) => points[index][2],
  };
}

function trunkPrototype() {
  const points = [[0, 0, 0], [0, 8, 0]];
  for (const y of [1, 2]) {
    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * Math.PI * 2;
      points.push([Math.cos(angle) * 0.4, y, Math.sin(angle) * 0.4]);
    }
  }
  return [{
    kind: 'trunk',
    geometry: {
      getAttribute: (name) => (name === 'position' ? attribute(points) : null),
    },
  }];
}

function treePlacement() {
  return Object.freeze({
    stableId: 'tree:0:0:1',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 4,
    z: -6,
    height: 2,
    scale: 1,
    rotationY: 0,
    prototypeIndex: 0,
    speciesId: 'broadleaf_round',
    ageClass: 'mature',
  });
}

function createHarness() {
  let rockHaloReady = false;
  let sourceRevision = 0;
  const placements = Object.freeze([treePlacement()]);
  const manifestStore = {
    editStore: { revision: 0 },
    pathClearance: { signature: 'paths:1' },
    forestField: { signature: 'forest:1' },
    speciesRegistry: { signature: 'species:1' },
    get: () => null,
    build: () => (rockHaloReady ? placements : null),
    context: () => (
      rockHaloReady ? { signature: `context:${sourceRevision}` } : null
    ),
  };
  const treeView = {
    prototypes: [trunkPrototype()],
    prototypeIndicesByAsset: new Map([['oak-pack', Object.freeze([0])]]),
    prototypeSignature: 'prototype:1',
    revisionTracker: { revision: sourceRevision },
    manifestStore,
    objectMap: { revision: 0 },
    biomeAssetPalette: { revision: 0 },
    resolvePalettePrototypeIndex: (placement) => placement.prototypeIndex,
  };
  const treeSource = createTreeCollisionSource({
    treeView,
    config: { minimumTrunkRadius: 0.16, prototypeOverrides: {} },
  });
  const loggedErrors = [];
  const logger = { error: (...args) => loggedErrors.push(args) };
  const treeProvider = new TreeCollisionProvider({ source: treeSource, logger });
  const provider = new NaturalCollisionProvider({
    components: [{
      id: 'trees',
      counterName: 'Tree',
      provider: treeProvider,
    }],
    logger,
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const residency = new CollisionResidency({
    world,
    config: RESIDENCY_CONFIG,
    buildOwnerChunk: provider.buildOwnerChunk.bind(provider),
    onOwnerChunkCommitted: provider.commitOwnerChunk.bind(provider),
    onOwnerChunkUnloaded: provider.unloadOwnerChunk.bind(provider),
    logger,
    providerId: provider.descriptor.id,
  });
  return {
    loggedErrors,
    provider,
    residency,
    setRockHaloReady: (ready) => {
      rockHaloReady = ready;
      sourceRevision += 1;
      treeView.revisionTracker.revision = sourceRevision;
    },
    world,
  };
}

test('cold tree rock halo defers collision commit and succeeds when preparation completes', () => {
  const harness = createHarness();
  const focus = { x: 1, z: -1 };

  harness.residency.update({ focus });
  const deferred = harness.residency.flush();

  assert.deepEqual(deferred, { attempted: 1, built: 0, remaining: 1 });
  assert.equal(harness.world.isOwnerChunkReady(0, 0), false);
  assert.equal(harness.provider.getStatus().loadedChunks, 0);
  assert.equal(harness.residency.getStatus().deferredRetries, 0);
  assert.equal(harness.residency.getStatus().lastBuildError, null);
  assert.equal(harness.loggedErrors.length, 0);

  harness.setRockHaloReady(true);
  harness.residency.update({ focus });
  const completed = harness.residency.flush();

  assert.deepEqual(harness.loggedErrors, []);
  assert.deepEqual(completed, { attempted: 1, built: 1, remaining: 0 });
  assert.equal(harness.world.isOwnerChunkReady(0, 0), true);
  assert.equal(harness.provider.getStatus().loadedChunks, 1);
  assert.equal(harness.provider.getStatus().colliderCount, 1);
  assert.equal(harness.residency.getStatus().ready, true);
});

test('deferred halo refresh retains committed tree colliders until replacement is ready', () => {
  const harness = createHarness();
  const focus = { x: 1, z: -1 };
  harness.setRockHaloReady(true);
  harness.residency.update({ focus });
  assert.equal(harness.residency.flush().built, 1);
  const committedRevision = harness.world.revision;

  harness.setRockHaloReady(false);
  const deferred = harness.provider.refresh(harness.world);

  assert.deepEqual(deferred, { attempted: 1, rebuilt: 0, remaining: 1 });
  assert.equal(harness.world.isOwnerChunkReady(0, 0), true);
  assert.equal(harness.provider.getStatus().colliderCount, 1);
  assert.equal(harness.provider.getStatus().deferredRetries, 0);
  assert.equal(harness.provider.getStatus().lastError, null);
  assert.equal(harness.world.revision, committedRevision);
  assert.deepEqual(harness.loggedErrors, []);

  harness.setRockHaloReady(true);
  const completed = harness.provider.refresh(harness.world);

  assert.deepEqual(completed, { attempted: 1, rebuilt: 1, remaining: 0 });
  assert.equal(harness.provider.getStatus().colliderCount, 1);
  assert.ok(harness.world.revision > committedRevision);
  assert.deepEqual(harness.loggedErrors, []);
});
