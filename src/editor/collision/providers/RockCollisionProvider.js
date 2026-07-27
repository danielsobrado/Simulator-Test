import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createCollisionSourceId } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from '../colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';
import {
  ROCK_COLLISION_SHAPE_CAPSULE,
  ROCK_COLLISION_TIER_BLOCKING,
  ROCK_COLLISION_TIER_DECORATIVE,
  ROCK_COLLISION_TIER_WALKABLE,
} from './RockCollisionConstants.js';
import { classifyRockCollision } from './RockCollisionProfiles.js';

function positiveScale(placement) {
  const value = placement.scale ?? 1;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Rock placement ${placement.stableId} has an invalid collision scale.`);
  }
  return value;
}

function rotateOffset(x, z, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * x + sine * z,
    z: -sine * x + cosine * z,
  };
}

function rotatedEllipseExtents(radiusX, radiusZ, rotationY) {
  const cosine = Math.cos(rotationY);
  const sine = Math.sin(rotationY);
  return {
    x: Math.hypot(radiusX * cosine, radiusZ * sine),
    z: Math.hypot(radiusX * sine, radiusZ * cosine),
  };
}

function colliderPrototypeId(profile, tier) {
  const fallback = tier === ROCK_COLLISION_TIER_WALKABLE ? ':p4-fallback' : '';
  return `rock-tier-${tier}:${profile.id}:${profile.shape}${fallback}`;
}

function sphereCollider({ placement, profile, part, partIndex, tier, translationY, scale }) {
  const rotationY = Number.isFinite(placement.rotationY) ? placement.rotationY : 0;
  const offset = rotateOffset(part.centerX * scale, part.centerZ * scale, rotationY);
  const radiusX = part.radiusX * scale;
  const radiusY = part.radiusY * scale;
  const radiusZ = part.radiusZ * scale;
  const extents = rotatedEllipseExtents(radiusX, radiusZ, rotationY);
  const x = placement.x + offset.x;
  const y = translationY + part.centerY * scale;
  const z = placement.z + offset.z;
  return createPrimitiveCollider({
    sourceId: createCollisionSourceId('rock', placement.stableId, `primitive-${partIndex}`),
    type: COLLIDER_TYPE_SPHERE,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: placement.ownerChunkX,
    ownerChunkZ: placement.ownerChunkZ,
    aabb: createCanonicalAabb({
      minX: x - extents.x,
      maxX: x + extents.x,
      minY: y - radiusY,
      maxY: y + radiusY,
      minZ: z - extents.z,
      maxZ: z + extents.z,
    }),
    position: [x, y, z],
    rotationY,
    dimensions: [radiusX, radiusY, radiusZ],
    prototypeId: colliderPrototypeId(profile, tier),
  });
}

function capsuleCollider({ placement, profile, part, partIndex, tier, translationY, scale }) {
  const rotationY = Number.isFinite(placement.rotationY) ? placement.rotationY : 0;
  const offset = rotateOffset(part.centerX * scale, part.centerZ * scale, rotationY);
  const radius = part.radius * scale;
  const height = part.height * scale;
  const x = placement.x + offset.x;
  const y = translationY + part.baseY * scale;
  const z = placement.z + offset.z;
  return createPrimitiveCollider({
    sourceId: createCollisionSourceId('rock', placement.stableId, `primitive-${partIndex}`),
    type: COLLIDER_TYPE_CAPSULE,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: placement.ownerChunkX,
    ownerChunkZ: placement.ownerChunkZ,
    aabb: createCanonicalAabb({
      minX: x - radius,
      maxX: x + radius,
      minY: y,
      maxY: y + height,
      minZ: z - radius,
      maxZ: z + radius,
    }),
    position: [x, y, z],
    rotationY,
    dimensions: [radius, height, radius],
    prototypeId: colliderPrototypeId(profile, tier),
  });
}

function colliderForPart(context) {
  return context.part.type === ROCK_COLLISION_SHAPE_CAPSULE
    ? capsuleCollider(context)
    : sphereCollider(context);
}

function sampleFrom({ placement, profile, tier, colliders }) {
  const collider = colliders[0];
  if (!collider) return null;
  return Object.freeze({
    sourceId: collider.sourceId,
    prototypeId: collider.prototypeId,
    tier,
    x: placement.x,
    y: placement.height,
    z: placement.z,
    radius: Math.max(profile.width, profile.depth) * placement.scale * 0.5,
    height: profile.height * placement.scale,
  });
}

function policySignature(config) {
  return [
    config.minimumCollidableHeight,
    config.minimumCollidableWidth,
    config.minimumWalkableHeight,
    config.minimumWalkableWidth,
  ].join(':');
}

export class RockCollisionProvider {
  constructor({ source, config }) {
    if (!source?.snapshotChunk || !source?.getProfiles) {
      throw new Error('Rock collision provider requires a canonical rock source.');
    }
    this.source = source;
    this.config = config;
    this.descriptor = source.descriptor;
    this.policySignature = policySignature(config);
  }

  getEpoch() {
    return `${this.source.epoch()}:${this.policySignature}`;
  }

  getProfileCount() {
    return this.source.getProfiles().length;
  }

  getCachedProfileCount() {
    return this.source.getCachedProfileCount?.() ?? 0;
  }

  buildChunkData(chunkX, chunkZ) {
    const snapshot = this.source.snapshotChunk(chunkX, chunkZ);
    const profiles = this.source.getProfiles();
    const colliders = [];
    const stats = {
      decorative: 0,
      blocking: 0,
      walkablePending: 0,
      colliders: 0,
    };
    let sample = null;

    for (const placement of snapshot.placements) {
      if (placement.ownerChunkX !== chunkX || placement.ownerChunkZ !== chunkZ) {
        throw new Error(`Rock placement ${placement.stableId} has the wrong collision owner chunk.`);
      }
      const prototypeIndex = this.source.resolvePrototypeIndex(placement);
      const profile = profiles[prototypeIndex];
      if (!profile) {
        throw new Error(
          `Rock placement ${placement.stableId} resolved unknown collision prototype ${prototypeIndex}.`,
        );
      }
      const scale = positiveScale(placement);
      const tier = classifyRockCollision(profile, scale, this.config);
      if (tier === ROCK_COLLISION_TIER_DECORATIVE) {
        stats.decorative += 1;
        continue;
      }
      if (tier === ROCK_COLLISION_TIER_WALKABLE) stats.walkablePending += 1;
      else if (tier === ROCK_COLLISION_TIER_BLOCKING) stats.blocking += 1;

      const translationY = placement.height - this.source.burialFor(placement, profile);
      const placementColliders = profile.parts.map((part, partIndex) => colliderForPart({
        placement,
        profile,
        part,
        partIndex,
        tier,
        translationY,
        scale,
      }));
      colliders.push(...placementColliders);
      stats.colliders += placementColliders.length;
      sample ??= sampleFrom({ placement, profile, tier, colliders: placementColliders });
    }

    colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    PerfCounters.set('collisionRockProfiles', profiles.length);
    return Object.freeze({
      signature: `${snapshot.signature}|${this.source.getProfileSignature()}|${this.policySignature}`,
      colliders: Object.freeze(colliders),
      stats: Object.freeze(stats),
      sample,
    });
  }

  getStatus() {
    return Object.freeze({
      id: this.descriptor.id,
      profileCount: this.getCachedProfileCount(),
    });
  }
}
