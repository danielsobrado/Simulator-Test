import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createCollisionSourceId, collisionChunkKey, parseCollisionChunkKey } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { COLLIDER_TYPE_BOX, createPrimitiveCollider } from '../colliders/ColliderRecords.js';

const CONSTRUCTION_COLLISION_SCHEMA = 'constructions:v1';

function heightAt(terrainView, x, z) {
  const value = terrainView.getCanonicalHeight(x, z);
  return Number.isFinite(value) ? value : 0;
}

function ownerFor(x, z, chunkWorldSize) {
  return {
    chunkX: Math.floor(x / chunkWorldSize),
    chunkZ: Math.floor(z / chunkWorldSize),
  };
}

function createRecord(constructionId, box, terrainView, chunkWorldSize) {
  const halfLength = box.length / 2;
  const startX = box.center[0] - box.tangent[0] * halfLength;
  const startZ = box.center[1] - box.tangent[1] * halfLength;
  const endX = box.center[0] + box.tangent[0] * halfLength;
  const endZ = box.center[1] + box.tangent[1] * halfLength;
  const heights = [
    heightAt(terrainView, startX, startZ),
    heightAt(terrainView, box.center[0], box.center[1]),
    heightAt(terrainView, endX, endZ),
  ];
  const bottom = Math.min(...heights) + box.bottom - box.foundationOverlap;
  const top = Math.max(...heights) + box.top;
  const colliderHeight = Math.max(0.01, top - bottom);
  const owner = ownerFor(box.center[0], box.center[1], chunkWorldSize);
  return createPrimitiveCollider({
    sourceId: createCollisionSourceId('construction', constructionId, box.id),
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: owner.chunkX,
    ownerChunkZ: owner.chunkZ,
    aabb: {
      minX: box.bounds.minX,
      minY: bottom,
      minZ: box.bounds.minZ,
      maxX: box.bounds.maxX,
      maxY: top,
      maxZ: box.bounds.maxZ,
    },
    position: [box.center[0], bottom + colliderHeight / 2, box.center[1]],
    rotationY: Math.atan2(-box.tangent[1], box.tangent[0]),
    dimensions: [box.length, colliderHeight, box.thickness],
    prototypeId: `construction:${constructionId}:${box.segmentId}`,
  });
}

export class ConstructionCollisionProvider {
  constructor({ source, terrainView, chunkWorldSize }) {
    if (!source?.configure || !source?.list || !source?.getPlan || !source?.signature) {
      throw new Error('Construction collision provider requires a configurable compiled-plan source.');
    }
    if (!terrainView?.getCanonicalHeight || !(chunkWorldSize > 0)) {
      throw new Error('Construction collision provider requires terrain and chunk dimensions.');
    }
    this.source = source.configure(chunkWorldSize);
    this.terrainView = terrainView;
    this.chunkWorldSize = chunkWorldSize;
    this.observedSpatialSignatures = new Map();
    this.descriptor = Object.freeze({ id: 'production-constructions' });
  }

  getEpoch() {
    return CONSTRUCTION_COLLISION_SCHEMA;
  }

  getProfileCount() {
    return this.source.getPlanCount();
  }

  consumeDirtyOwnerChunks(activeKeys) {
    const dirty = [];
    for (const key of activeKeys ?? []) {
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      const signature = this.source.signature(chunkX, chunkZ);
      if (this.observedSpatialSignatures.get(key) !== signature) dirty.push(key);
    }
    return Object.freeze(dirty);
  }

  buildChunkData(chunkX, chunkZ) {
    const key = collisionChunkKey(chunkX, chunkZ);
    const colliders = [];
    const signatures = [];
    let sample = null;

    for (const constructionId of this.source.list(chunkX, chunkZ)) {
      const plan = this.source.getPlan(constructionId);
      if (!plan) continue;
      let owned = 0;
      for (const box of plan.boxes) {
        const owner = ownerFor(box.center[0], box.center[1], this.chunkWorldSize);
        if (owner.chunkX !== chunkX || owner.chunkZ !== chunkZ) continue;
        const collider = createRecord(
          constructionId,
          box,
          this.terrainView,
          this.chunkWorldSize,
        );
        colliders.push(collider);
        owned += 1;
        sample ??= Object.freeze({
          sourceId: collider.sourceId,
          constructionId,
          x: box.center[0],
          y: collider.aabb.minY,
          z: box.center[1],
          radius: Math.max(box.length, box.thickness) / 2,
          height: collider.dimensions[1],
        });
      }
      if (owned > 0) signatures.push(`${constructionId}:${plan.signature}:${owned}`);
    }

    colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    signatures.sort();
    this.observedSpatialSignatures.set(key, this.source.signature(chunkX, chunkZ));
    PerfCounters.set('collisionConstructionPlans', this.getProfileCount());
    PerfCounters.inc('collisionConstructionChunkBuilds');
    return Object.freeze({
      signature: `${CONSTRUCTION_COLLISION_SCHEMA}|${signatures.join('|')}`,
      colliders: Object.freeze(colliders),
      stats: Object.freeze({
        constructions: signatures.length,
        colliders: colliders.length,
      }),
      sample,
    });
  }

  getStatus() {
    return Object.freeze({
      id: this.descriptor.id,
      plans: this.getProfileCount(),
      source: this.source.getStatus(),
    });
  }

  dispose() {
    this.observedSpatialSignatures.clear();
  }
}
