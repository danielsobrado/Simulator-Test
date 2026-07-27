import { CollisionDebugView } from './CollisionDebugView.js';
import { COLLISION_LAYERS } from './CollisionLayers.js';
import { CollisionResidency } from './CollisionResidency.js';
import { CollisionWorld } from './CollisionWorld.js';
import { createSweptCapsuleAabb } from './colliders/ColliderBounds.js';
import { createCollisionP1QaProvider } from './providers/CollisionP1QaProvider.js';
import { TreeCollisionProvider } from './providers/TreeCollisionProvider.js';
import { createTreeCollisionSource } from './providers/TreeCollisionSource.js';

const EMPTY_COLLIDERS = Object.freeze([]);
const FIXTURE_QA_SCENARIOS = new Set(['collision-p1', 'collision-p2']);
const COLLISION_QA_SCENARIOS = new Set([...FIXTURE_QA_SCENARIOS, 'collision-p3']);

function hasDebugEnabled(debug) {
  return Object.values(debug).some(Boolean);
}

function qaScenario(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const scenario = params.get('qa');
  return COLLISION_QA_SCENARIOS.has(scenario) ? scenario : null;
}

function createEmptyProvider() {
  return Object.freeze({
    descriptor: null,
    buildOwnerChunk: () => Object.freeze({ revision: 0, colliders: EMPTY_COLLIDERS }),
    getStatus: () => Object.freeze({ id: 'empty', colliderCount: 0 }),
  });
}

function createProvider({
  activeQaScenario,
  terrainView,
  editorConfig,
  collisionConfig,
  treeSource,
}) {
  if (FIXTURE_QA_SCENARIOS.has(activeQaScenario)) {
    return createCollisionP1QaProvider({
      terrainView,
      playerConfig: editorConfig.player,
      collisionConfig,
    });
  }
  if (collisionConfig.trees.enabled && treeSource) {
    return new TreeCollisionProvider({
      source: createTreeCollisionSource({
        treeView: treeSource.treeView,
        rockSource: treeSource.rockSource,
        config: collisionConfig.trees,
      }),
      buildsPerFrame: collisionConfig.streaming.buildsPerFrame,
      buildBudgetMs: collisionConfig.streaming.buildBudgetMs,
    });
  }
  return createEmptyProvider();
}

export function shouldCreateCollisionRuntime(collisionConfig, search = '') {
  return collisionConfig.enabled
    || qaScenario(search) !== null
    || hasDebugEnabled(collisionConfig.debug);
}

export function createCollisionRuntime({ terrainView, editorConfig, treeSource = null, search = '' }) {
  const collisionConfig = editorConfig.collision;
  if (!shouldCreateCollisionRuntime(collisionConfig, search)) return null;
  const activeQaScenario = qaScenario(search);
  const qaMode = activeQaScenario !== null;
  const debug = qaMode
    ? Object.freeze({ ...collisionConfig.debug, colliders: true, broadphase: true })
    : collisionConfig.debug;
  const provider = createProvider({
    activeQaScenario,
    terrainView,
    editorConfig,
    collisionConfig,
    treeSource,
  });

  const world = new CollisionWorld({
    chunkWorldSize: terrainView.chunkWorldSize,
    binSize: collisionConfig.streaming.binSize,
    maxChunksPerCollider: collisionConfig.streaming.maxChunksPerCollider,
  });
  const residency = new CollisionResidency({
    world,
    config: collisionConfig.streaming,
    buildOwnerChunk: provider.buildOwnerChunk.bind(provider),
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
    qaScenario: activeQaScenario,
    update(focus, timestamp) {
      let velocity = { x: 0, z: 0 };
      if (lastFocus && Number.isFinite(lastTimestamp) && timestamp > lastTimestamp) {
        const seconds = Math.max(0.001, (timestamp - lastTimestamp) / 1000);
        velocity = {
          x: (focus.x - lastFocus.x) / seconds,
          z: (focus.z - lastFocus.z) / seconds,
        };
      }
      provider.refresh?.(world);
      residency.update({ focus, velocity });
      residency.flush();
      debugView?.update();
      lastFocus = { x: focus.x, z: focus.z };
      lastTimestamp = timestamp;
    },
    resetTracking() {
      lastFocus = null;
      lastTimestamp = null;
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
        qaScenario: activeQaScenario,
        provider: provider.getStatus?.() ?? null,
        world: world.getStatus(),
        residency: residency.getStatus(),
      });
    },
    dispose() {
      debugView?.dispose();
      residency.dispose();
      provider.dispose?.();
      world.dispose();
      lastFocus = null;
      lastTimestamp = null;
    },
  });
}
