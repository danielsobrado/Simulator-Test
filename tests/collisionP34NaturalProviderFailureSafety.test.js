import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLISION_RETRY_BASE_MS } from '../src/editor/collision/CollisionLimits.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { NaturalCollisionProvider } from '../src/editor/collision/providers/NaturalCollisionProvider.js';

const QUIET_LOGGER = Object.freeze({ error() {} });

function createWorld() {
  return new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
}

function createComponent() {
  let epoch = 1;
  let failEpoch = false;
  let failBuild = false;
  const provider = {
    getEpoch() {
      if (failEpoch) throw new Error('profile derivation failed');
      return epoch;
    },
    getCachedProfileCount: () => 3,
    getProfileCount() {
      throw new Error('status must not derive profiles');
    },
    buildChunkData(chunkX, chunkZ) {
      if (failBuild) throw new Error('chunk refresh failed');
      return Object.freeze({
        signature: `${epoch}:${chunkX}:${chunkZ}`,
        colliders: Object.freeze([]),
        stats: Object.freeze({ colliders: 0 }),
      });
    },
  };
  return {
    record: Object.freeze({ id: 'rocks', counterName: 'Rock', provider }),
    setEpoch(value) { epoch = value; },
    setFailEpoch(value) { failEpoch = value; },
    setFailBuild(value) { failBuild = value; },
  };
}

function commitChunk(provider, world, chunkX, chunkZ) {
  const built = provider.buildOwnerChunk(chunkX, chunkZ);
  world.replaceOwnerChunk({ chunkX, chunkZ, ...built });
  provider.commitOwnerChunk({ chunkX, chunkZ, ...built });
}

test('initial source failure is contained and status stays readable', () => {
  const component = createComponent();
  component.setFailEpoch(true);
  let clock = 0;

  const provider = new NaturalCollisionProvider({
    components: [component.record],
    now: () => clock,
    logger: QUIET_LOGGER,
  });

  assert.match(provider.getStatus().lastError, /profile derivation failed/);
  assert.equal(provider.getStatus().components.rocks.profileCount, 3);

  component.setFailEpoch(false);
  assert.equal(provider.refresh(createWorld()).attempted, 0);
  assert.match(provider.getStatus().lastError, /profile derivation failed/);

  clock += COLLISION_RETRY_BASE_MS;
  provider.refresh(createWorld());
  assert.equal(provider.getStatus().lastError, null);
});

test('failed chunk refreshes back off and recover without dropping valid data', () => {
  const component = createComponent();
  const world = createWorld();
  let clock = 0;
  const provider = new NaturalCollisionProvider({
    components: [component.record],
    buildsPerFrame: 2,
    buildBudgetMs: 100,
    now: () => clock,
    logger: QUIET_LOGGER,
  });
  commitChunk(provider, world, 0, 0);
  const beforeRevision = world.revision;

  component.setEpoch(2);
  component.setFailBuild(true);
  const failed = provider.refresh(world);
  assert.equal(failed.attempted, 1);
  assert.equal(failed.rebuilt, 0);
  assert.equal(provider.getStatus().deferredRetries, 1);
  assert.equal(world.isOwnerChunkReady(0, 0), true);
  assert.equal(world.revision, beforeRevision);

  assert.equal(provider.refresh(world).attempted, 0);

  component.setFailBuild(false);
  clock += COLLISION_RETRY_BASE_MS;
  const recovered = provider.refresh(world);
  assert.equal(recovered.rebuilt, 1);
  assert.equal(provider.getStatus().deferredRetries, 0);
  assert.equal(provider.getStatus().lastError, null);
  assert.ok(world.revision > beforeRevision);
});

test('unloading a chunk removes its queued refresh work', () => {
  const component = createComponent();
  const world = createWorld();
  const provider = new NaturalCollisionProvider({
    components: [component.record],
    buildsPerFrame: 1,
    buildBudgetMs: 100,
    now: () => 0,
    logger: QUIET_LOGGER,
  });
  commitChunk(provider, world, 0, 0);
  commitChunk(provider, world, 1, 0);

  component.setEpoch(2);
  provider.refresh(world);
  assert.equal(provider.getStatus().queuedRefreshes, 1);

  world.unloadOwnerChunk(1, 0);
  provider.unloadOwnerChunk(1, 0);
  assert.equal(provider.getStatus().queuedRefreshes, 0);
  assert.equal(provider.getStatus().loadedChunks, 1);
});
