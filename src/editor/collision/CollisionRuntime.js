import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { CollisionDebugView } from './CollisionDebugView.js';
import {
  COLLISION_COUNT_COUNTERS,
  COLLISION_GAUGE_COUNTERS,
  COLLISION_TIMING_COUNTERS,
  recordCollisionTiming,
} from './CollisionPerfCounters.js';
import { COLLISION_LAYERS } from './CollisionLayers.js';
import { CollisionResidency } from './CollisionResidency.js';
import { CollisionWorld } from './CollisionWorld.js';
import {
  canonicalCollisionSignature,
  getCollisionWorldComposition,
} from './CollisionWorldMetrics.js';
import { createSweptCapsuleAabb } from './colliders/ColliderBounds.js';
import {
  findMeshSideContact,
  findMeshTopSupport,
} from './mesh/MeshCapsuleQuery.js';
import { createCollisionP1QaProvider } from './providers/CollisionP1QaProvider.js';
import { ConstructionCollisionProvider } from './providers/ConstructionCollisionProvider.js';
import { NaturalCollisionProvider } from './providers/NaturalCollisionProvider.js';
import { ObjectCollisionProvider } from './providers/ObjectCollisionProvider.js';
import { RockCollisionProvider } from './providers/RockCollisionProvider.js';
import { createRockCollisionSource } from './providers/RockCollisionSource.js';
import { TreeCollisionProvider } from './providers/TreeCollisionProvider.js';
import { createTreeCollisionSource } from './providers/TreeCollisionSource.js';

const EMPTY_COLLIDERS = Object.freeze([]);
const FIXTURE_QA_SCENARIOS = new Set(['collision-p1', 'collision-p2']);
const COLLISION_QA_SCENARIOS = new Set([
  ...FIXTURE_QA_SCENARIOS,
  'collision-p3',
  'collision-p4',
  'collision-p5',
  'collision-p6',
  'collision-p7',
  'collision-p8',
]);

function hasDebugEnabled(debug) {
  return Object.values(debug).some(Boolean);
}

function qaScenario(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const scenario = params.get('qa');
  return COLLISION_QA_SCENARIOS.has(scenario) ? scenario : null;
}

export function collisionQaDebugConfig(debug) {
  return debug;
}

function residencyConfig(streaming, activeQaScenario) {
  if (!['collision-p4', 'collision-p5', 'collision-p6', 'collision-p7', 'collision-p8']
    .includes(activeQaScenario)) {
    return streaming;
  }
  return Object.freeze({
    ...streaming,
    residentRadius: Math.max(streaming.residentRadius, 2),
    unloadRadius: Math.max(streaming.unloadRadius, 3),
  });
}

function createEmptyProvider() {
  return Object.freeze({
    descriptor: null,
    buildOwnerChunk: () => Object.freeze({ revision: 0, colliders: EMPTY_COLLIDERS }),
    getStatus: () => Object.freeze({ id: 'empty', colliderCount: 0 }),
  });
}

function createNaturalComponents({
  treeSource,
  objectSource,
  constructionSource,
  collisionConfig,
  terrainView,
}) {
  const components = [];
  if (collisionConfig.trees.enabled && treeSource?.treeView) {
    const provider = new TreeCollisionProvider({
      source: createTreeCollisionSource({
        treeView: treeSource.treeView,
        rockSource: treeSource.rockSource,
        config: collisionConfig.trees,
      }),
      buildsPerFrame: collisionConfig.streaming.buildsPerFrame,
      buildBudgetMs: collisionConfig.streaming.buildBudgetMs,
    });
    components.push(Object.freeze({ id: 'trees', counterName: 'Tree', provider }));
  }
  if (collisionConfig.rocks.enabled && treeSource?.rockSource) {
    const provider = new RockCollisionProvider({
      source: createRockCollisionSource({
        rockView: treeSource.rockSource,
        config: collisionConfig.rocks,
      }),
      config: collisionConfig.rocks,
    });
    components.push(Object.freeze({ id: 'rocks', counterName: 'Rock', provider }));
  }
  if (collisionConfig.objects.enabled && objectSource) {
    const provider = new ObjectCollisionProvider({
      ...objectSource,
      chunkWorldSize: terrainView.chunkWorldSize,
    });
    components.push(Object.freeze({ id: 'objects', counterName: 'Object', provider }));
  }
  if (collisionConfig.constructions.enabled && constructionSource) {
    const provider = new ConstructionCollisionProvider({
      source: constructionSource,
      terrainView,
      chunkWorldSize: terrainView.chunkWorldSize,
    });
    components.push(Object.freeze({
      id: 'constructions',
      counterName: 'Construction',
      provider,
    }));
  }
  return components;
}

function createProvider({
  activeQaScenario,
  terrainView,
  editorConfig,
  collisionConfig,
  treeSource,
  objectSource,
  constructionSource,
  now,
  logger,
}) {
  if (FIXTURE_QA_SCENARIOS.has(activeQaScenario)) {
    return createCollisionP1QaProvider({
      terrainView,
      playerConfig: editorConfig.player,
      collisionConfig,
    });
  }
  const components = createNaturalComponents({
    treeSource,
    objectSource,
    constructionSource,
    collisionConfig,
    terrainView,
  });
  if (components.length === 0) return createEmptyProvider();
  return new NaturalCollisionProvider({
    components,
    buildsPerFrame: collisionConfig.streaming.buildsPerFrame,
    buildBudgetMs: collisionConfig.streaming.buildBudgetMs,
    now,
    logger,
  });
}

function attachProviderWorld(provider, world) {
  provider.attachWorld?.(world);
  for (const component of provider.components ?? []) component.provider.attachWorld?.(world);
}

function enqueueTargetedRefreshes(provider) {
  if (!provider?.enqueueRefreshKey || !provider?.chunkStates) return;
  const activeKeys = [...provider.chunkStates.keys()];
  for (const component of provider.components ?? []) {
    const dirty = component.provider.consumeDirtyOwnerChunks?.(activeKeys) ?? [];
    for (const key of dirty) provider.enqueueRefreshKey(key);
  }
}

function updateWorldCompositionCounters(world) {
  const composition = getCollisionWorldComposition(world);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.activePrimitiveColliders, composition.primitiveColliders);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.activeMeshInstances, composition.meshInstances);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.prototypeBvhs, composition.prototypeBvhs);
  return composition;
}

function providerRefreshFailure(status) {
  if (!status?.lastError) return null;
  return Object.freeze({
    providerId: status.id ?? 'unknown',
    phase: 'provider-refresh',
    chunkKey: null,
    sourceId: null,
    prototypeId: null,
    message: status.lastError,
  });
}

export function shouldCreateCollisionRuntime(collisionConfig, search = '') {
  return collisionConfig.enabled
    || qaScenario(search) !== null
    || hasDebugEnabled(collisionConfig.debug);
}

export function createCollisionRuntime({
  terrainView,
  editorConfig,
  treeSource = null,
  objectSource = null,
  constructionSource = null,
  search = '',
  now = () => performance.now(),
  logger = console,
}) {
  const collisionConfig = editorConfig.collision;
  if (!shouldCreateCollisionRuntime(collisionConfig, search)) return null;
  const activeQaScenario = qaScenario(search);
  const qaMode = activeQaScenario !== null;
  const debug = collisionQaDebugConfig(collisionConfig.debug);
  const provider = createProvider({
    activeQaScenario,
    terrainView,
    editorConfig,
    collisionConfig,
    treeSource,
    objectSource,
    constructionSource,
    now,
    logger,
  });

  const world = new CollisionWorld({
    chunkWorldSize: terrainView.chunkWorldSize,
    binSize: collisionConfig.streaming.binSize,
    maxChunksPerCollider: collisionConfig.streaming.maxChunksPerCollider,
  });
  attachProviderWorld(provider, world);
  const residency = new CollisionResidency({
    world,
    config: residencyConfig(collisionConfig.streaming, activeQaScenario),
    buildOwnerChunk: provider.buildOwnerChunk.bind(provider),
    onOwnerChunkCommitted: provider.commitOwnerChunk?.bind(provider) ?? null,
    onOwnerChunkUnloaded: provider.unloadOwnerChunk?.bind(provider) ?? null,
    now,
    logger,
    providerId: provider.descriptor?.id ?? 'empty',
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

  function getLiveStatus() {
    const residencyStatus = residency.getStatus();
    const providerStatus = provider.getStatus?.() ?? null;
    return Object.freeze({
      active: true,
      qaMode,
      qaScenario: activeQaScenario,
      residency: residencyStatus,
      ready: residencyStatus.ready,
      failure: residencyStatus.failure ?? providerRefreshFailure(providerStatus),
    });
  }

  function updateRuntime(focus, timestamp) {
    let velocity = { x: 0, z: 0 };
    if (lastFocus && Number.isFinite(lastTimestamp) && timestamp > lastTimestamp) {
      const seconds = Math.max(0.001, (timestamp - lastTimestamp) / 1000);
      velocity = {
        x: (focus.x - lastFocus.x) / seconds,
        z: (focus.z - lastFocus.z) / seconds,
      };
    }
    enqueueTargetedRefreshes(provider);
    if (typeof provider.refresh === 'function') {
      const refreshStartedAt = now();
      const refresh = provider.refresh(world);
      if (refresh?.attempted > 0) {
        recordCollisionTiming(COLLISION_TIMING_COUNTERS.chunkBuild, refreshStartedAt, now);
      }
    }
    residency.update({ focus, velocity });
    residency.flush();
    debugView?.update();
    updateWorldCompositionCounters(world);
    lastFocus = { x: focus.x, z: focus.z };
    lastTimestamp = timestamp;
  }

  return Object.freeze({
    world,
    residency,
    descriptor: provider.descriptor,
    qaScenario: activeQaScenario,
    update: updateRuntime,
    prime(focus, timestamp = now()) {
      lastFocus = null;
      lastTimestamp = null;
      updateRuntime(focus, timestamp);
    },
    resetTracking() {
      lastFocus = null;
      lastTimestamp = null;
    },
    querySweptCapsule({ start, end, radius, bodyHeight, layers = COLLISION_LAYERS.all, out }) {
      const startedAt = now();
      const aabb = createSweptCapsuleAabb({ start, end, radius, bodyHeight });
      const candidates = world.collectCandidates(aabb, layers, out);
      recordCollisionTiming(COLLISION_TIMING_COUNTERS.broadphase, startedAt, now);
      PerfCounters.inc(COLLISION_COUNT_COUNTERS.broadphaseQueries);
      PerfCounters.inc(COLLISION_COUNT_COUNTERS.candidates, candidates.length);
      return candidates;
    },
    findMeshSideContact(capsule, collider, skinWidth, out) {
      const prototype = world.getPrototype(collider.prototypeId);
      return findMeshSideContact({ capsule, collider, prototype, skinWidth, out });
    },
    findMeshTopSupport(options) {
      const prototype = world.getPrototype(options.collider.prototypeId);
      return findMeshTopSupport({ ...options, prototype });
    },
    checkMovementReadiness({ start, end, radius, bodyHeight }) {
      return residency.checkDestination(createSweptCapsuleAabb({
        start,
        end,
        radius,
        bodyHeight,
      }));
    },
    getCanonicalSignature() {
      return canonicalCollisionSignature(world);
    },
    getLiveStatus,
    getStatus() {
      const composition = updateWorldCompositionCounters(world);
      const providerStatus = provider.getStatus?.() ?? null;
      const liveStatus = getLiveStatus();
      return Object.freeze({
        ...liveStatus,
        canonicalSignature: canonicalCollisionSignature(world),
        provider: providerStatus,
        world: Object.freeze({ ...world.getStatus(), ...composition }),
      });
    },
    dispose() {
      debugView?.dispose();
      residency.dispose();
      provider.dispose?.();
      world.dispose();
      updateWorldCompositionCounters(world);
      lastFocus = null;
      lastTimestamp = null;
    },
  });
}
