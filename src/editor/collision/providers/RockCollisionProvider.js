import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createCollisionSourceId } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from '../colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createMeshInstanceCollider,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';
import {
  composeUniformTransform,
  createMeshInstanceTransform,
  transformPrototypeBounds,
} from '../mesh/MeshInstanceTransform.js';
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
  return `rock-tier-${tier}:${profile.id}:${profile.shape}`;
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

function walkableCollider({ placement, prototype, translationY, scale }) {
  const transform = composeUniformTransform({
    x: placement.x,
    y: translationY,
    z: placement.z,
    rotationY: Number.isFinite(placement.rotationY) ? placement.rotationY : 0,
    scale,
  });
  const instance = createMeshInstanceTransform(transform);
  return createMeshInstanceCollider({
    sourceId: createCollisionSourceId('rock', placement.stableId, 'walkable-mesh'),
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: placement.ownerChunkX,
    ownerChunkZ: placement.ownerChunkZ,
    aabb: transformPrototypeBounds(prototype.bounds, instance.matrix),
    prototypeId: prototype.id,
    transform,
  });
}

function sampleFrom({ placement, profile, tier, colliders, prototype = null }) {
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
    generatedProxy: prototype?.metadata.generated ?? false,
  });
}

function policySignature(config) {
  return [
    config.minimumCollidableHeight,
    config.minimumCollidableWidth,
    config.minimumWalkableHeight,
    config.minimumWalkableWidth,
    config.maximumProxyTriangles,
    config.bvhMaxLeafTriangles,
    config.minimumProxyOverlapRatio,
    config.allowGeneratedProxyFallback,
    config.requireAuthoredProxy,
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
    this.world = null;
  }

  attachWorld(world) {
    if (!world?.registerPrototype) throw new Error('Rock collision provider requires a collision world.');
    if (this.world && this.world !== world) {
      throw new Error('Rock collision provider cannot attach to multiple collision worlds.');
    }
    this.world = world;
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
      walkable: 0,
      walkablePending: 0,
      generatedProxies: 0,
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

      const translationY = placement.height - this.source.burialFor(placement, profile);
      let placementColliders;
      let meshPrototype = null;
      if (tier === ROCK_COLLISION_TIER_WALKABLE) {
        meshPrototype = this.source.getMeshPrototype(prototypeIndex, this.world);
        placementColliders = [walkableCollider({
          placement,
          prototype: meshPrototype,
          translationY,
          scale,
        })];
        stats.walkable += 1;
        if (meshPrototype.metadata.generated) stats.generatedProxies += 1;
      } else {
        placementColliders = profile.parts.map((part, partIndex) => colliderForPart({
          placement,
          profile,
          part,
          partIndex,
          tier,
          translationY,
          scale,
        }));
        stats.blocking += 1;
      }

      colliders.push(...placementColliders);
      stats.colliders += placementColliders.length;
      const candidateSample = sampleFrom({
        placement,
        profile,
        tier,
        colliders: placementColliders,
        prototype: meshPrototype,
      });
      if (!sample || (tier === ROCK_COLLISION_TIER_WALKABLE
          && sample.tier !== ROCK_COLLISION_TIER_WALKABLE)) {
        sample = candidateSample;
      }
    }

    colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    const meshStatus = this.source.getMeshPrototypeStatus?.()
      ?? { count: 0, triangles: 0, generated: 0 };
    PerfCounters.set('collisionRockProfiles', profiles.length);
    PerfCounters.set('collisionRockMeshPrototypes', meshStatus.count);
    PerfCounters.set('collisionRockMeshTriangles', meshStatus.triangles);
    PerfCounters.set('collisionRockGeneratedPrototypes', meshStatus.generated);
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
      meshPrototypes: this.source.getMeshPrototypeStatus?.() ?? null,
    });
  }

  dispose() {
    this.source.dispose?.();
    this.world = null;
  }
}
