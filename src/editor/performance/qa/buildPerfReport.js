import {
  COLLISION_COUNT_COUNTERS,
  COLLISION_GAUGE_COUNTERS,
  COLLISION_TIMING_COUNTERS,
} from '../../collision/CollisionPerfCounters.js';
import { percentileSorted } from './FrameProfiler.js';
import { PerfCounters } from './PerfCounters.js';

const COLLISION_P95_TARGET_MS = 0.83;

function round(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function compactStreaming(streaming) {
  if (!streaming) {
    return null;
  }
  return {
    resident: streaming.resident,
    loading: streaming.loading,
    focusChunk: streaming.focusChunk,
    cacheSize: streaming.cache?.cacheSize ?? null,
    revision: streaming.cache?.revision ?? null,
    originX: streaming.origin?.x ?? null,
    originZ: streaming.origin?.z ?? null,
  };
}

function timingSummary(frames, counters) {
  const names = Array.isArray(counters) ? counters : [counters];
  const values = frames
    .filter((frame) => frame.dt > 0)
    .map((frame) => Math.max(
      0,
      names.reduce((sum, name) => sum + (frame.countersDelta?.[name] ?? 0), 0),
    ))
    .sort((left, right) => left - right);
  const totalMs = values.reduce((sum, value) => sum + value, 0);
  return Object.freeze({
    samples: values.length,
    totalMs: round(totalMs),
    meanMs: round(values.length > 0 ? totalMs / values.length : 0),
    minMs: round(values[0] ?? 0),
    p50Ms: round(percentileSorted(values, 0.5) ?? 0),
    p95Ms: round(percentileSorted(values, 0.95) ?? 0),
    p99Ms: round(percentileSorted(values, 0.99) ?? 0),
    maxMs: round(values.at(-1) ?? 0),
  });
}

function count(counters, name) {
  return Math.max(0, Math.round(counters[name] ?? 0));
}

function buildCollisionReport({ frames, counters, collisionConfig, collisionStatus }) {
  const timingsMs = Object.freeze({
    total: timingSummary(frames, [
      COLLISION_TIMING_COUNTERS.total,
      COLLISION_TIMING_COUNTERS.chunkBuild,
    ]),
    broadphase: timingSummary(frames, COLLISION_TIMING_COUNTERS.broadphase),
    narrowPhase: timingSummary(frames, COLLISION_TIMING_COUNTERS.narrowPhase),
    support: timingSummary(frames, COLLISION_TIMING_COUNTERS.support),
    chunkBuild: timingSummary(frames, COLLISION_TIMING_COUNTERS.chunkBuild),
  });
  const enabled = collisionStatus?.active === true || collisionConfig?.enabled === true;
  const readiness = Object.freeze({
    ready: collisionStatus?.ready ?? !enabled,
    policy: collisionStatus?.residency?.notReadyPolicy ?? null,
    desiredChunks: collisionStatus?.residency?.desiredChunks ?? 0,
    readyDesiredChunks: collisionStatus?.residency?.readyDesiredChunks ?? 0,
    failure: collisionStatus?.failure ?? null,
  });
  const samplePassed = timingsMs.total.samples > 0;
  const timingPassed = timingsMs.total.p95Ms <= COLLISION_P95_TARGET_MS;
  const readinessPassed = readiness.ready && readiness.failure === null;
  return Object.freeze({
    enabled,
    timingsMs,
    counts: Object.freeze({
      candidates: count(counters, COLLISION_COUNT_COUNTERS.candidates),
      broadphaseQueries: count(counters, COLLISION_COUNT_COUNTERS.broadphaseQueries),
      primitiveTests: count(counters, COLLISION_COUNT_COUNTERS.primitiveTests),
      bvhQueries: count(counters, COLLISION_COUNT_COUNTERS.bvhQueries),
      triangleTests: count(counters, COLLISION_COUNT_COUNTERS.triangleTests),
      contacts: count(counters, COLLISION_COUNT_COUNTERS.contacts),
      stepAttempts: count(counters, COLLISION_COUNT_COUNTERS.stepAttempts),
      stepSuccesses: count(counters, COLLISION_COUNT_COUNTERS.stepSuccesses),
      activeChunks: count(counters, COLLISION_GAUGE_COUNTERS.activeChunks),
      activePrimitiveColliders: count(
        counters,
        COLLISION_GAUGE_COUNTERS.activePrimitiveColliders,
      ),
      activeMeshInstances: count(counters, COLLISION_GAUGE_COUNTERS.activeMeshInstances),
      prototypeBvhs: count(counters, COLLISION_GAUGE_COUNTERS.prototypeBvhs),
      readinessMisses: count(counters, COLLISION_COUNT_COUNTERS.readinessMisses),
      failedChunks: count(counters, COLLISION_GAUGE_COUNTERS.failedChunks),
      finalQueueDepth: count(counters, COLLISION_GAUGE_COUNTERS.queueDepth),
    }),
    readiness,
    canonicalSignature: collisionStatus?.canonicalSignature ?? null,
    provider: collisionStatus?.provider ?? null,
    gate: Object.freeze({
      provisionalP95TargetMs: COLLISION_P95_TARGET_MS,
      measuredP95Ms: timingsMs.total.p95Ms,
      sampleCount: timingsMs.total.samples,
      samplePassed,
      timingPassed,
      readinessPassed,
      passed: !enabled || (samplePassed && timingPassed && readinessPassed),
    }),
  });
}

export function buildPerfReport({
  config,
  profiler,
  meta = {},
  playerConfig = null,
  worldConfig = null,
  collisionConfig = null,
  collisionStatus = null,
}) {
  const frames = profiler.getFrames();
  const summary = profiler.summarize();
  const counters = PerfCounters.snapshot();
  const hitches = frames
    .filter((frame) => frame.hitch && frame.dt > 0)
    .map((frame) => ({
      index: frame.index,
      timestamp: round(frame.timestamp, 2),
      dtMs: round(frame.dt, 3),
      phases: Object.fromEntries(
        Object.entries(frame.phases).map(([name, value]) => [name, round(value, 3)]),
      ),
      countersDelta: frame.countersDelta,
      streaming: compactStreaming(frame.streaming),
      voxel: frame.voxel,
      player: frame.player,
      originSnap: frame.originSnap,
      forcePredictiveRefresh: frame.forcePredictiveRefresh,
    }));

  const sampleStride = Math.max(1, Math.ceil(frames.length / 240));
  const samples = frames
    .filter((frame, index) => {
      if (index % sampleStride === 0 || frame.hitch) {
        return true;
      }
      const phaseMax = Math.max(0, ...Object.values(frame.phases ?? {}));
      if (phaseMax >= 8) {
        return true;
      }
      return Boolean(frame.countersDelta && Object.keys(frame.countersDelta).length);
    })
    .map((frame) => ({
      index: frame.index,
      timestamp: round(frame.timestamp, 2),
      dtMs: round(frame.dt, 3),
      hitch: frame.hitch,
      phases: Object.fromEntries(
        Object.entries(frame.phases).map(([name, value]) => [name, round(value, 3)]),
      ),
      countersDelta: frame.countersDelta,
      streaming: compactStreaming(frame.streaming),
      voxel: frame.voxel,
      player: frame.player,
      originSnap: frame.originSnap,
    }));

  const roundedSummary = {
    ...summary,
    avgFps: round(summary.avgFps, 2),
    durationMs: round(summary.durationMs, 2),
    hitchRate: round(summary.hitchRate, 4),
    dt: Object.fromEntries(
      Object.entries(summary.dt).map(([key, value]) => [key, round(value, 3)]),
    ),
    phases: Object.fromEntries(
      Object.entries(summary.phases).map(([name, stats]) => [
        name,
        Object.fromEntries(
          Object.entries(stats).map(([key, value]) => [key, round(value, 3)]),
        ),
      ]),
    ),
  };

  return {
    version: 2,
    kind: 'simcity-dnd-perf-qa',
    generatedAt: new Date().toISOString(),
    meta,
    scenario: {
      id: config.scenarioId,
      label: config.scenarioLabel,
      spawn: config.spawn,
      yawDegrees: config.yawDegrees,
      pitchDegrees: config.pitchDegrees,
      warmupSeconds: config.warmupSeconds,
      durationSeconds: config.durationSeconds,
      speed: config.speed,
      keys: config.keys,
      hitchMs: config.hitchMs,
      buildingCount: config.buildingCount ?? null,
      densityProfile: config.densityProfile ?? 'standard',
    },
    config: {
      player: playerConfig,
      world: worldConfig,
      collision: collisionConfig,
    },
    summary: roundedSummary,
    collision: buildCollisionReport({
      frames,
      counters,
      collisionConfig,
      collisionStatus,
    }),
    counters,
    hitchFrames: hitches,
    samples,
  };
}

export function downloadPerfReport(report, filename = null) {
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const name = filename ?? `perf-qa-${report.scenario.id}-${stamp}.json`;
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
  return name;
}
