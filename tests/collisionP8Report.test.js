import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLISION_COUNT_COUNTERS,
  COLLISION_GAUGE_COUNTERS,
  COLLISION_TIMING_COUNTERS,
} from '../src/editor/collision/CollisionPerfCounters.js';
import { buildPerfReport } from '../src/editor/performance/qa/buildPerfReport.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

function profiler(totalSamples) {
  const frames = totalSamples.map((total, index) => ({
    index,
    timestamp: index * 16.67,
    dt: index === 0 ? 0 : 16.67,
    hitch: false,
    phases: { player: 1 },
    countersDelta: {
      [COLLISION_TIMING_COUNTERS.total]: total,
      [COLLISION_TIMING_COUNTERS.broadphase]: total * 0.2,
      [COLLISION_TIMING_COUNTERS.narrowPhase]: total * 0.5,
      [COLLISION_TIMING_COUNTERS.support]: total * 0.2,
      [COLLISION_TIMING_COUNTERS.chunkBuild]: index === 1 ? 0.4 : 0,
    },
    streaming: null,
    voxel: null,
    player: null,
    originSnap: false,
    forcePredictiveRefresh: false,
  }));
  return {
    getFrames: () => frames,
    summarize: () => ({
      frameCount: frames.length - 1,
      durationMs: (frames.length - 1) * 16.67,
      avgFps: 60,
      dt: {
        minMs: 16.67,
        p50Ms: 16.67,
        p95Ms: 16.67,
        p99Ms: 16.67,
        maxMs: 16.67,
        meanMs: 16.67,
      },
      hitchMs: 33.3,
      hitchCount: 0,
      hitchRate: 0,
      phases: {
        player: { totalMs: 3, avgMs: 1, p95Ms: 1, maxMs: 1 },
      },
      originSnapCount: 0,
    }),
  };
}

function config() {
  return {
    scenarioId: 'collision-p8',
    scenarioLabel: 'Collision P8 streaming and performance gate',
    spawn: { x: 0, z: 0 },
    yawDegrees: 0,
    pitchDegrees: 0,
    warmupSeconds: 10,
    durationSeconds: 12,
    speed: 'run',
    keys: ['KeyW', 'ShiftLeft'],
    hitchMs: 33.3,
  };
}

test('collision QA report uses per-frame deltas and exposes required counts', () => {
  PerfCounters.reset();
  PerfCounters.set(COLLISION_COUNT_COUNTERS.candidates, 42);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.primitiveTests, 18);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.bvhQueries, 3);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.triangleTests, 27);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.contacts, 5);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.stepAttempts, 2);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.stepSuccesses, 1);
  PerfCounters.set(COLLISION_COUNT_COUNTERS.readinessMisses, 4);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.activeChunks, 9);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.activePrimitiveColliders, 30);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.activeMeshInstances, 2);
  PerfCounters.set(COLLISION_GAUGE_COUNTERS.prototypeBvhs, 1);

  const report = buildPerfReport({
    config: config(),
    profiler: profiler([0, 0.2, 0.4, 0.6]),
    collisionConfig: { enabled: true },
    collisionStatus: {
      active: true,
      ready: true,
      canonicalSignature: 'deadbeef',
      provider: { id: 'production-natural-props' },
      residency: {
        ready: true,
        notReadyPolicy: 'retain-previous-valid-position',
        desiredChunks: 9,
        readyDesiredChunks: 9,
      },
    },
  });

  assert.equal(report.version, 2);
  assert.equal(report.collision.enabled, true);
  assert.equal(report.collision.timingsMs.total.samples, 3);
  assert.equal(report.collision.timingsMs.total.p95Ms, 0.6);
  assert.equal(report.collision.timingsMs.chunkBuild.p95Ms, 0.36);
  assert.equal(report.collision.counts.candidates, 42);
  assert.equal(report.collision.counts.activePrimitiveColliders, 30);
  assert.equal(report.collision.counts.prototypeBvhs, 1);
  assert.equal(report.collision.readiness.ready, true);
  assert.equal(report.collision.canonicalSignature, 'deadbeef');
  assert.equal(report.collision.gate.passed, true);
  PerfCounters.reset();
});

test('collision p95 above the provisional budget fails the report gate', () => {
  PerfCounters.reset();
  const report = buildPerfReport({
    config: config(),
    profiler: profiler([0, 0.2, 0.6, 1]),
    collisionConfig: { enabled: true },
    collisionStatus: {
      active: true,
      ready: false,
      failure: { message: 'proxy failed' },
      residency: {
        ready: false,
        notReadyPolicy: 'retain-previous-valid-position',
        desiredChunks: 1,
        readyDesiredChunks: 0,
      },
    },
  });

  assert.equal(report.collision.timingsMs.total.p95Ms, 0.96);
  assert.equal(report.collision.gate.passed, false);
  assert.equal(report.collision.readiness.failure.message, 'proxy failed');
  PerfCounters.reset();
});
