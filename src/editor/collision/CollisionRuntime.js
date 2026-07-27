import { CollisionDebugView } from './CollisionDebugView.js';
import { COLLISION_LAYERS } from './CollisionLayers.js';
import { CollisionResidency } from './CollisionResidency.js';
import { CollisionWorld } from './CollisionWorld.js';
import { createSweptCapsuleAabb } from './colliders/ColliderBounds.js';
import { createCollisionP1QaProvider } from './providers/CollisionP1QaProvider.js';

const EMPTY_COLLIDERS = Object.freeze([]);

function hasDebugEnabled(debug) {
  return Object.values(debug).some(Boolean);
}

export function shouldCreateCollisionRuntime(collisionConfig, search = '') {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return collisionConfig.enabled
    || params.get('qa') === 'collision-p1'
    || hasDebugEnabled(collisionConfig.debug);
}

export function createCollisionRuntime({ terrainView, editorConfig, search = '' }) {
  const collisionConfig = editorConfig.collision;
  if (!shouldCreateCollisionRuntime(collisionConfig, search)) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const qaMode = params.get('qa') === 'collision-p1';
  const debug = qaMode
    ? Object.freeze({ ...collisionConfig.debug, colliders: true, broadphase: true })
    : collisionConfig.debug;
  const provider = qaMode
    ? createCollisionP1QaProvider({
      terrainView,
      playerConfig: editorConfig.player,
      collisionConfig,
    })
    : Object.freeze({
      descriptor: null,
      buildOwnerChunk: () => Object.freeze({ revision: 0, colliders: EMPTY_COLLIDERS }),
    });

  const world = new CollisionWorld({
    chunkWorldSize: terrainView.chunkWorldSize,
    binSize: collisionConfig.streaming.binSize,
  });
  const residency = new CollisionResidency({
    world,
    config: collisionConfig.streaming,
    buildOwnerChunk: provider.buildOwnerChunk,
  });
  const debugView = debug.colliders || debug.broadphase
    ? new CollisionDebugView({
      scene: terrainView.scene,
      floatingOrigin: terrainView.floatingOrigin,
      world,
      debug,
    })
    : null;

  let lastFocus = null;
  let lastTimestamp = null;

  return Object.freeze({
    world,
    residency,
    descriptor: provider.descriptor,
    update(focus, timestamp) {
      let velocity = { x: 0, z: 0 };
      if (lastFocus && Number.isFinite(lastTimestamp) && timestamp > lastTimestamp) {
        const seconds = Math.max(0.001, (timestamp - lastTimestamp) / 1000);
        velocity = {
          x: (focus.x - lastFocus.x) / seconds,
          z: (focus.z - lastFocus.z) / seconds,
        };
      }
      residency.update({ focus, velocity });
      residency.flush();
      debugView?.update();
      lastFocus = { x: focus.x, z: focus.z };
      lastTimestamp = timestamp;
    },
    querySweptCapsule({ start, end, radius, bodyHeight, layers = COLLISION_LAYERS.all, out }) {
      const aabb = createSweptCapsuleAabb({ start, end, radius, bodyHeight });
      return world.collectCandidates(aabb, layers, out);
    },
    checkMovementReadiness({ start, end, radius, bodyHeight }) {
      return residency.checkDestination(createSweptCapsuleAabb({
        start,
        end,
        radius,
        bodyHeight,
      }));
    },
    getStatus() {
      return Object.freeze({
        active: true,
        qaMode,
        world: world.getStatus(),
        residency: residency.getStatus(),
      });
    },
    dispose() {
      debugView?.dispose();
      residency.dispose();
      world.dispose();
    },
  });
}
