import assert from 'node:assert/strict';
import test from 'node:test';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { createSweptCapsuleAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
import { ConstructionCollisionProvider } from '../src/editor/collision/providers/ConstructionCollisionProvider.js';
import { ConstructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { compileConstructionCollision } from '../src/editor/construction/compile/ConstructionCollisionCompiler.js';
import { sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  doorFeature,
  straightConstruction,
} from './helpers/constructionCollisionFixtures.js';

function fixture() {
  const record = straightConstruction({ features: [doorFeature()] });
  const plan = compileConstructionCollision(record, sampleCubicBezierPath(record.path));
  const source = new ConstructionCollisionSource();
  source.setActive(record);
  source.applyPlan(record, plan);
  const provider = new ConstructionCollisionProvider({
    source,
    terrainView: { getCanonicalHeight: () => 0 },
    chunkWorldSize: 128,
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  for (const chunkX of [-1, 0]) {
    const built = provider.buildChunkData(chunkX, 0);
    world.replaceOwnerChunk({
      chunkX,
      chunkZ: 0,
      revision: chunkX + 2,
      colliders: built.colliders,
    });
  }
  const runtime = {
    querySweptCapsule({ start, end, radius, bodyHeight, layers, out }) {
      return world.collectCandidates(
        createSweptCapsuleAabb({ start, end, radius, bodyHeight }),
        layers,
        out,
      );
    },
    checkMovementReadiness: () => Object.freeze({ ready: true, missing: Object.freeze([]) }),
  };
  const terrainProvider = {
    constrainMovement: ({ endX, endZ }) => ({ x: endX, z: endZ, constrained: false }),
    sample: () => Object.freeze({
      sourceId: 'terrain',
      height: 0,
      normal: Object.freeze({ x: 0, y: 1, z: 0 }),
      walkable: true,
    }),
  };
  const motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider,
    config: Object.freeze({
      radius: 0.35,
      bodyHeight: 1.8,
      skinWidth: 0.03,
      maxSlopeDegrees: 50,
      maxSubstepDistance: 0.2,
      maxIterations: 6,
    }),
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  return { motor, plan };
}

test('the player capsule passes through a compiled construction doorway', () => {
  const { motor, plan } = fixture();
  assert.ok(plan.boxes.some((box) => box.openingIds.includes('door-main')));
  const result = motor.move({
    start: { x: 0, y: 0, z: 2 },
    displacement: { x: 0, z: -4 },
    grounded: true,
  });

  assert.equal(result.ready, true);
  assert.equal(result.blocked, false);
  assert.ok(result.position.z < -1.5, `doorway stopped at z=${result.position.z}`);
});

test('the same construction wall blocks beside its doorway', () => {
  const { motor } = fixture();
  const result = motor.move({
    start: { x: 2, y: 0, z: 2 },
    displacement: { x: 0, z: -4 },
    grounded: true,
  });

  assert.equal(result.blocked, true);
  assert.ok(result.position.z > 0.2, `wall was crossed at z=${result.position.z}`);
  assert.ok(result.contacts.some((contact) => contact.sourceId.startsWith('construction:')));
});
