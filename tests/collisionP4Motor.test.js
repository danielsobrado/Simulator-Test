import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { RockCollisionProvider } from '../src/editor/collision/providers/RockCollisionProvider.js';
import { TerrainCollisionProvider } from '../src/editor/collision/providers/TerrainCollisionProvider.js';

const config = Object.freeze({
  minimumCollidableHeight: 0.3,
  minimumCollidableWidth: 0.4,
  minimumWalkableHeight: 3,
  minimumWalkableWidth: 3,
  prototypeOverrides: Object.freeze({}),
});

function buildRock() {
  const profile = Object.freeze({
    id: 'rock.glb',
    prototypeIndex: 0,
    width: 2,
    height: 2,
    depth: 2,
    shape: 'ellipsoid',
    forcedTier: null,
    parts: Object.freeze([Object.freeze({
      type: 'ellipsoid',
      centerX: 0,
      centerY: 1,
      centerZ: 0,
      radiusX: 1,
      radiusY: 1,
      radiusZ: 1,
    })]),
  });
  const placement = Object.freeze({
    stableId: 'rock:0:0:1',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 2,
    z: 0,
    height: 0,
    scale: 1,
    rotationY: 0,
    prototypeIndex: 0,
  });
  const source = Object.freeze({
    descriptor: Object.freeze({ id: 'production-rock-primitives' }),
    getProfiles: () => Object.freeze([profile]),
    getProfileSignature: () => 'profiles:1',
    epoch: () => 'epoch:1',
    resolvePrototypeIndex: () => 0,
    burialFor: () => 0,
    snapshotChunk: () => Object.freeze({
      signature: 'manifest:1',
      placements: Object.freeze([placement]),
    }),
  });
  return new RockCollisionProvider({ source, config }).buildChunkData(0, 0);
}

function motorFor(world) {
  const runtime = {
    checkMovementReadiness: () => Object.freeze({ ready: true, missing: Object.freeze([]) }),
    querySweptCapsule: ({ start, end, radius, bodyHeight, layers, out = [] }) => {
      out.length = 0;
      return world.collectCandidates({
        minX: Math.min(start.x, end.x) - radius,
        maxX: Math.max(start.x, end.x) + radius,
        minY: Math.min(start.y, end.y),
        maxY: Math.max(start.y, end.y) + bodyHeight,
        minZ: Math.min(start.z, end.z) - radius,
        maxZ: Math.max(start.z, end.z) + radius,
      }, layers, out);
    },
  };
  return new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider: new TerrainCollisionProvider({ getHeight: () => 0 }),
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
}

test('manifest-derived medium rock blocks and allows a grazing slide', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const built = buildRock();
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: built.colliders });
  const motor = motorFor(world);
  motor.reset({ x: 0, y: 0, z: 0 });

  const headOn = motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 4, z: 0 },
    grounded: true,
  });
  assert.equal(headOn.blocked, true);
  assert.ok(headOn.position.x < 1, `rock was crossed at x=${headOn.position.x}`);
  assert.ok(headOn.primitiveTests > 0);

  motor.reset({ x: 0, y: 0, z: 0.9 });
  const grazing = motor.move({
    start: { x: 0, y: 0, z: 0.9 },
    displacement: { x: 4, z: 1 },
    grounded: true,
  });
  assert.equal(grazing.blocked, true);
  assert.ok(grazing.position.z > 1.4, `rock did not deflect the player: z=${grazing.position.z}`);
});
