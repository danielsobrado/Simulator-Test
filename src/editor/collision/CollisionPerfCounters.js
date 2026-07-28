import { PerfCounters } from '../performance/qa/PerfCounters.js';

export const COLLISION_TIMING_COUNTERS = Object.freeze({
  total: 'collisionTotalMs',
  broadphase: 'collisionBroadphaseMs',
  narrowPhase: 'collisionNarrowPhaseMs',
  support: 'collisionSupportMs',
  chunkBuild: 'collisionBuildMs',
});

export const COLLISION_COUNT_COUNTERS = Object.freeze({
  candidates: 'collisionCandidatesTotal',
  broadphaseQueries: 'collisionBroadphaseQueries',
  primitiveTests: 'collisionPrimitiveTestsTotal',
  bvhQueries: 'collisionBvhQueries',
  triangleTests: 'collisionTriangleTests',
  contacts: 'collisionContactsTotal',
  treeContacts: 'collisionTreeContacts',
  rockContacts: 'collisionRockContacts',
  objectContacts: 'collisionObjectContacts',
  constructionContacts: 'collisionConstructionContacts',
  treeSupports: 'collisionTreeSupports',
  rockSupports: 'collisionRockSupports',
  objectSupports: 'collisionObjectSupports',
  constructionSupports: 'collisionConstructionSupports',
  stepAttempts: 'collisionStepAttempts',
  stepSuccesses: 'collisionStepSuccesses',
  readinessMisses: 'collisionReadinessMisses',
});

export const COLLISION_GAUGE_COUNTERS = Object.freeze({
  activeChunks: 'collisionActiveChunks',
  activePrimitiveColliders: 'collisionActivePrimitiveColliders',
  activeMeshInstances: 'collisionActiveMeshInstances',
  prototypeBvhs: 'collisionPrototypeBvhs',
  queueDepth: 'collisionBuildQueueDepth',
  failedChunks: 'collisionFailedChunks',
});

export function recordCollisionTiming(counter, startedAt, now = () => performance.now()) {
  const elapsed = Math.max(0, now() - startedAt);
  PerfCounters.inc(counter, elapsed);
  return elapsed;
}
