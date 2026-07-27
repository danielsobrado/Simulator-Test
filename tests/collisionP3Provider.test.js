import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { COLLIDER_TYPE_CAPSULE } from '../src/editor/collision/colliders/ColliderRecords.js';
import { TerrainCollisionProvider } from '../src/editor/collision/providers/TerrainCollisionProvider.js';
import { TreeCollisionProvider } from '../src/editor/collision/providers/TreeCollisionProvider.js';

function placement(overrides = {}) {
  return Object.freeze({
    stableId: 'tree:0:0:7',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 10,
    z: -10,
    height: 3,
    scale: 2,
    heightScale: 2,
    rotationY: Math.PI / 2,
    prototypeIndex: 0,
    speciesId: 'broadleaf_round',
    ageClass: 'mature',
    ...overrides,
  });
}

function createHarness(initialPlacements = [placement()]) {
  let epoch = 'epoch:1';
  let signature = 'manifest:1';
  let placements = initialPlacements;
  const profile = Object.freeze({
    id: 'prototype:0',
    prototypeIndex: 0,
    radius: 0.5,
    height: 5,
    centerX: 0.25,
    centerZ: 0,
    baseY: 0.1,
  });
  const source = Object.freeze({
    descriptor: Object.freeze({ id: 'production-tree-trunks', profileCount: 1 }),
    profiles: Object.freeze([profile]),
    profileSignature: 'profiles:1',
    minimumTrunkRadius: 0.16,
    epoch: () => epoch,
    resolvePrototypeIndex: () => 0,
    snapshotChunk: (chunkX, chunkZ) => Object.freeze({
      chunkX,
      chunkZ,
      signature,
      placements,
    }),
  });
  const provider = new TreeCollisionProvider({
    source,
    buildsPerFrame: 4,
    buildBudgetMs: 100,
    now: () => 0,
    logger: Object.freeze({ error() {} }),
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  return {
    provider,
    world,
    setEpoch(value) { epoch = value; },
    setSnapshot(nextSignature, nextPlacements) {
      signature = nextSignature;
      placements = nextPlacements;
    },
  };
}

test('tree placements become scaled blocking trunk capsules with stable IDs', () => {
  const harness = createHarness();
  const built = harness.provider.buildOwnerChunk(0, 0);
  assert.equal(built.colliders.length, 1);
  const collider = built.colliders[0];

  assert.equal(collider.type, COLLIDER_TYPE_CAPSULE);
  assert.equal(collider.layers, COLLISION_LAYERS.blocking);
  assert.equal(collider.sourceId, 'tree:tree%3A0%3A0%3A7:trunk');
  assert.equal(collider.prototypeId, 'prototype:0');
  assert.equal(collider.dimensions[0], 1);
  assert.equal(collider.dimensions[1], 10);
  assert.equal(collider.position[0], 10);
  assert.equal(collider.position[1], 3.2);
  assert.equal(collider.position[2], -10.5);
  assert.equal(Object.isFrozen(collider), true);
});

test('planted tree IDs remain deterministic and encoded safely', () => {
  const planted = placement({ stableId: 'planted:oak:42' });
  const harness = createHarness([planted]);
  const collider = harness.provider.buildOwnerChunk(0, 0).colliders[0];
  assert.equal(collider.sourceId, 'tree:planted%3Aoak%3A42:trunk');
});

test('cut-tree refresh removes the collider atomically', () => {
  const harness = createHarness();
  const initial = harness.provider.buildOwnerChunk(0, 0);
  harness.world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial });
  assert.ok(harness.world.getCollider('tree:tree%3A0%3A0%3A7:trunk'));

  harness.setSnapshot('manifest:2', Object.freeze([]));
  harness.setEpoch('epoch:2');
  const result = harness.provider.refresh(harness.world);

  assert.equal(result.rebuilt, 1);
  assert.equal(harness.world.getCollider('tree:tree%3A0%3A0%3A7:trunk'), null);
  assert.equal(harness.world.isOwnerChunkReady(0, 0), true);
});

test('render-LOD-only changes do not rebuild collision', () => {
  const harness = createHarness();
  const initial = harness.provider.buildOwnerChunk(0, 0);
  harness.world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial });
  const beforeRevision = harness.world.revision;

  harness.setSnapshot('manifest:1', Object.freeze([placement({ renderBand: 'impostor', fade: 0.2 })]));
  harness.setEpoch('epoch:2');
  const result = harness.provider.refresh(harness.world);

  assert.equal(result.attempted, 1);
  assert.equal(result.rebuilt, 0);
  assert.equal(harness.world.revision, beforeRevision);
});

test('canonical trunk records are unaffected by floating-origin state', () => {
  const harness = createHarness();
  const first = harness.provider.buildOwnerChunk(0, 0).colliders[0];
  const second = harness.provider.buildOwnerChunk(0, 0).colliders[0];
  assert.deepEqual(second.position, first.position);
  assert.deepEqual(second.aabb, first.aabb);
});

test('manifest-derived trunks block the P2 character motor', () => {
  const harness = createHarness([placement({
    height: 0,
    scale: 1,
    heightScale: 1,
    rotationY: 0,
  })]);
  const built = harness.provider.buildOwnerChunk(0, 0);
  harness.world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, ...built });
  const runtime = {
    checkMovementReadiness: () => Object.freeze({ ready: true, missing: Object.freeze([]) }),
    querySweptCapsule: ({ start, end, radius, bodyHeight, layers, out = [] }) => {
      out.length = 0;
      return harness.world.collectCandidates({
        minX: Math.min(start.x, end.x) - radius,
        maxX: Math.max(start.x, end.x) + radius,
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y) + bodyHeight,
        minZ: Math.min(start.z, end.z) - radius,
        maxZ: Math.max(start.z, end.z) + radius,
      }, layers, out);
    },
  };
  const terrain = new TerrainCollisionProvider({ getHeight: () => 0, sampleDistance: 0.35 });
  const motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider: terrain,
    config: {
      radius: 0.35,
      bodyHeight: 1.8,
      skinWidth: 0.03,
      maxSlopeDegrees: 50,
      maxSubstepDistance: 0.35,
      maxIterations: 4,
    },
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  const result = motor.move({
    start: { x: 10, y: 0, z: -7 },
    displacement: { x: 0, z: -5 },
    grounded: true,
  });

  assert.equal(result.blocked, true);
  assert.ok(result.position.z > -9.2, `tree was crossed at z=${result.position.z}`);
  assert.deepEqual(result.contacts, ['tree:tree%3A0%3A0%3A7:trunk']);
});
