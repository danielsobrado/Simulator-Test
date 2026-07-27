import * as THREE from 'three/webgpu';
import { COLLISION_LAYER_WALKABLE } from './CollisionLayers.js';

const COLORS = Object.freeze({
  chunk: 0x46a3ff,
  bin: 0x6f7f91,
  blocking: 0xff6655,
  walkable: 0x55dd88,
});
const PROTOTYPE_COLORS = Object.freeze([
  0xff7b72,
  0xf2cc60,
  0x7ee787,
  0x79c0ff,
  0xd2a8ff,
  0xffa657,
  0x56d4dd,
  0xf778ba,
]);

function prototypeColor(prototypeId) {
  if (!prototypeId) return null;
  let hash = 0x811c9dc5;
  for (let index = 0; index < prototypeId.length; index += 1) {
    hash ^= prototypeId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROTOTYPE_COLORS[hash % PROTOTYPE_COLORS.length];
}

function colliderColor(collider) {
  const byPrototype = prototypeColor(collider.prototypeId);
  if (byPrototype !== null) return byPrototype;
  return (collider.layers & COLLISION_LAYER_WALKABLE) !== 0
    ? COLORS.walkable
    : COLORS.blocking;
}

function boxFromAabb(aabb) {
  return new THREE.Box3(
    new THREE.Vector3(aabb.minX, aabb.minY, aabb.minZ),
    new THREE.Vector3(aabb.maxX, aabb.maxY, aabb.maxZ),
  );
}

function disposeHelper(helper) {
  helper.geometry?.dispose?.();
  helper.material?.dispose?.();
}

function colliderHeightRange(colliders) {
  if (colliders.length === 0) return { minY: 0, maxY: 1 };
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const collider of colliders) {
    minY = Math.min(minY, collider.aabb.minY);
    maxY = Math.max(maxY, collider.aabb.maxY);
  }
  return { minY, maxY };
}

export class CollisionDebugView {
  constructor({ scene, floatingOrigin, world, debug }) {
    this.scene = scene;
    this.floatingOrigin = floatingOrigin;
    this.world = world;
    this.debug = debug;
    this.revision = -1;
    this.root = new THREE.Group();
    this.root.name = 'collision-debug';
    this.root.renderOrder = 1000;
    scene.add(this.root);
  }

  addHelper(aabb, color, name) {
    const helper = new THREE.Box3Helper(boxFromAabb(aabb), color);
    helper.name = name;
    helper.renderOrder = 1000;
    this.root.add(helper);
  }

  rebuild() {
    for (const child of this.root.children) disposeHelper(child);
    this.root.clear();
    const snapshot = this.world.debugSnapshot();
    const drawnColliders = new Set();

    for (const chunk of snapshot.chunks) {
      if (this.debug.broadphase) {
        const { minY, maxY } = colliderHeightRange(chunk.colliders);
        this.addHelper({
          ...chunk.bounds,
          minY,
          maxY: Math.max(minY + 0.2, maxY),
        }, COLORS.chunk, `collision-chunk-${chunk.status.key}`);
        for (const [index, bin] of chunk.bins.entries()) {
          this.addHelper({ ...bin, minY, maxY: minY + 0.08 }, COLORS.bin, `collision-bin-${chunk.status.key}-${index}`);
        }
      }

      if (this.debug.colliders) {
        for (const collider of chunk.colliders) {
          if (drawnColliders.has(collider.sourceId)) continue;
          drawnColliders.add(collider.sourceId);
          this.addHelper(
            collider.aabb,
            colliderColor(collider),
            `collision-collider-${collider.prototypeId ?? 'unprofiled'}-${collider.sourceId}`,
          );
        }
      }
    }
    this.revision = snapshot.revision;
  }

  update() {
    const origin = this.floatingOrigin.getState();
    this.root.position.set(-origin.x, 0, -origin.z);
    if (this.revision !== this.world.revision) this.rebuild();
  }

  dispose() {
    for (const child of this.root.children) disposeHelper(child);
    this.root.clear();
    this.scene.remove(this.root);
  }
}
