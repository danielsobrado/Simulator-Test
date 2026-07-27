import { createCollisionSourceId, collisionChunkKey } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCollisionP0QaFixture } from '../CollisionP0QaFixture.js';
import {
  COLLIDER_TYPE_BOX,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';
import {
  collisionChunkForCanonical,
  createCanonicalAabb,
} from '../colliders/ColliderBounds.js';

const EMPTY_COLLIDERS = Object.freeze([]);

function colliderForEntry(entry, groundHeight, chunkWorldSize) {
  const owner = collisionChunkForCanonical(entry.x, entry.z, chunkWorldSize);
  const sourceId = createCollisionSourceId('qa', entry.id);
  const baseHeight = groundHeight + (entry.baseHeight ?? 0);

  if (entry.kind === 'tree') {
    return createPrimitiveCollider({
      sourceId,
      type: COLLIDER_TYPE_CAPSULE,
      layers: COLLISION_LAYERS.blocking,
      ownerChunkX: owner.chunkX,
      ownerChunkZ: owner.chunkZ,
      position: [entry.x, groundHeight, entry.z],
      rotationY: 0,
      dimensions: [entry.radius, entry.height, entry.radius],
      aabb: createCanonicalAabb({
        minX: entry.x - entry.radius,
        maxX: entry.x + entry.radius,
        minY: groundHeight,
        maxY: groundHeight + entry.height,
        minZ: entry.z - entry.radius,
        maxZ: entry.z + entry.radius,
      }),
    });
  }

  if (entry.kind === 'rock') {
    return createPrimitiveCollider({
      sourceId,
      type: COLLIDER_TYPE_SPHERE,
      layers: entry.walkable ? COLLISION_LAYERS.solid : COLLISION_LAYERS.blocking,
      ownerChunkX: owner.chunkX,
      ownerChunkZ: owner.chunkZ,
      position: [entry.x, groundHeight + entry.height / 2, entry.z],
      rotationY: 0,
      dimensions: [entry.radius, entry.height / 2, entry.radius],
      aabb: createCanonicalAabb({
        minX: entry.x - entry.radius,
        maxX: entry.x + entry.radius,
        minY: groundHeight,
        maxY: groundHeight + entry.height,
        minZ: entry.z - entry.radius,
        maxZ: entry.z + entry.radius,
      }),
    });
  }

  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: owner.chunkX,
    ownerChunkZ: owner.chunkZ,
    position: [entry.x, baseHeight + entry.height / 2, entry.z],
    rotationY: 0,
    dimensions: [entry.width, entry.height, entry.depth],
    aabb: createCanonicalAabb({
      minX: entry.x - entry.width / 2,
      maxX: entry.x + entry.width / 2,
      minY: baseHeight,
      maxY: baseHeight + entry.height,
      minZ: entry.z - entry.depth / 2,
      maxZ: entry.z + entry.depth / 2,
    }),
  });
}

export function createCollisionP1QaProvider({ terrainView, playerConfig, collisionConfig }) {
  const stepHeight = playerConfig?.stepHeight;
  if (!(stepHeight > 0)) {
    throw new Error('Collision P1 QA provider requires a positive player.stepHeight.');
  }
  const descriptor = createCollisionP0QaFixture({
    stepHeight,
    maxSlopeDegrees: collisionConfig.player.maxSlopeDegrees,
    chunkWorldSize: terrainView.chunkWorldSize,
  });
  const collidersByOwner = new Map();
  for (const entry of descriptor.entries) {
    const collider = colliderForEntry(
      entry,
      terrainView.getCanonicalHeight(entry.x, entry.z),
      terrainView.chunkWorldSize,
    );
    const key = collisionChunkKey(collider.ownerChunkX, collider.ownerChunkZ);
    const colliders = collidersByOwner.get(key) ?? [];
    colliders.push(collider);
    collidersByOwner.set(key, colliders);
  }
  for (const [key, colliders] of collidersByOwner) {
    collidersByOwner.set(key, Object.freeze(colliders));
  }

  return Object.freeze({
    descriptor,
    buildOwnerChunk(chunkX, chunkZ) {
      return Object.freeze({
        revision: descriptor.version,
        colliders: collidersByOwner.get(collisionChunkKey(chunkX, chunkZ)) ?? EMPTY_COLLIDERS,
      });
    },
  });
}
