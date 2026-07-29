import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameProfiler, percentileSorted } from '../src/editor/performance/qa/FrameProfiler.js';
import {
  PerfCounters,
  resetWaterChunkGauges,
} from '../src/editor/performance/qa/PerfCounters.js';
import { buildPerfReport } from '../src/editor/performance/qa/buildPerfReport.js';
import {
  createMovementPlan,
  parseQaParams,
} from '../src/editor/performance/qa/parseQaParams.js';

test('parseQaParams returns null when qa is absent', () => {
  assert.equal(parseQaParams(''), null);
  assert.equal(parseQaParams('x=1&z=2'), null);
});

test('parseQaParams builds a deterministic move scenario', () => {
  const config = parseQaParams(
    '?qa=move&x=12&z=-4&yaw=90&pitch=-10&warmup=1&duration=8&speed=walk&hitchMs=40&download=0',
  );
  assert.equal(config.scenarioId, 'move');
  assert.deepEqual(config.spawn, { x: 12, z: -4 });
  assert.equal(config.yawDegrees, 90);
  assert.equal(config.pitchDegrees, -10);
  assert.equal(config.warmupSeconds, 1);
  assert.equal(config.durationSeconds, 8);
  assert.equal(config.speed, 'walk');
  assert.equal(config.running, false);
  assert.equal(config.hitchMs, 40);
  assert.equal(config.download, false);
  assert.deepEqual(config.keys, ['KeyW']);
});

test('parseQaParams defaults qa=1 to run-forward move', () => {
  const config = parseQaParams('?qa=1');
  assert.equal(config.scenarioId, 'move');
  assert.equal(config.speed, 'run');
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(config.autostart, true);
  assert.equal(config.download, true);
});

test('object-town scenario clamps its deterministic building count and uses a longer warmup', () => {
  const defaultTown = parseQaParams('?qa=object-town');
  assert.equal(defaultTown.buildingCount, 64);
  assert.equal(defaultTown.warmupSeconds, 8);
  assert.equal(defaultTown.durationSeconds, 14);
  assert.deepEqual(defaultTown.keys, ['KeyW', 'ShiftLeft']);

  assert.equal(parseQaParams('?qa=object-town&buildings=999').buildingCount, 256);
  assert.equal(parseQaParams('?qa=object-town&buildings=-4').buildingCount, 1);
});

test('QA density profile is recorded in the deterministic scenario config', () => {
  assert.equal(
    parseQaParams('?qa=diagonal&density=dense-forest').densityProfile,
    'dense-forest',
  );
  assert.equal(parseQaParams('?qa=diagonal').densityProfile, 'standard');
});

test('water acceptance reserves movement control for its external phase driver', () => {
  const config = parseQaParams('?qa=water-acceptance');
  assert.equal(config.scenarioId, 'water-acceptance');
  assert.deepEqual(config.keys, []);
  assert.equal(config.speed, 'walk');
});

test('createMovementPlan warms up before measuring', () => {
  const config = parseQaParams('?qa=strafe&warmup=2&duration=5');
  const plan = createMovementPlan(config);
  assert.equal(plan.phases.length, 2);
  assert.equal(plan.phases[0].record, false);
  assert.deepEqual(plan.phases[0].keys, []);
  assert.equal(plan.phases[1].record, true);
  assert.deepEqual(plan.phases[1].keys, ['KeyD', 'ShiftLeft']);
});

test('FrameProfiler records hitch stats and phase timings', () => {
  const profiler = new FrameProfiler({ hitchMs: 20 });
  profiler.start();

  profiler.beginFrame(1000);
  profiler.mark('player');
  profiler.mark('stylized');
  profiler.endFrame({ originSnap: false });

  profiler.beginFrame(1016);
  profiler.mark('player');
  profiler.mark('stylized');
  profiler.endFrame();

  profiler.beginFrame(1060);
  profiler.mark('player');
  profiler.mark('stylized');
  profiler.endFrame({ originSnap: true, countersDelta: { grassRebuilds: 2 } });

  const summary = profiler.summarize();
  assert.equal(profiler.getLiveAverageFps(), 2000 / 60);
  assert.equal(summary.frameCount, 2);
  assert.equal(summary.hitchCount, 1);
  assert.equal(summary.originSnapCount, 1);
  assert.ok(summary.dt.maxMs >= 40);
  assert.ok(summary.phases.player);
  assert.ok(summary.phases.stylized);
});

test('percentileSorted interpolates', () => {
  assert.equal(percentileSorted([10], 0.95), 10);
  assert.equal(percentileSorted([10, 20, 30, 40], 0.5), 25);
});

test('PerfCounters snapshot and delta', () => {
  PerfCounters.reset();
  PerfCounters.inc('grassRebuilds', 2);
  PerfCounters.inc('treeRebuilds');
  const first = PerfCounters.snapshot();
  PerfCounters.inc('grassRebuilds', 3);
  assert.deepEqual(PerfCounters.delta(first), { grassRebuilds: 3 });
  assert.equal(PerfCounters.get('grassRebuilds'), 5);
  PerfCounters.reset();
  assert.equal(PerfCounters.get('grassRebuilds'), 0);
});

test('water chunk residency counters are per-frame gauges', () => {
  PerfCounters.reset();
  PerfCounters.inc('waterChunksWet', 9);
  PerfCounters.inc('waterChunksDry', 40);
  PerfCounters.inc('waterChunksRefractive', 4);

  resetWaterChunkGauges();

  assert.equal(PerfCounters.get('waterChunksWet'), 0);
  assert.equal(PerfCounters.get('waterChunksDry'), 0);
  assert.equal(PerfCounters.get('waterChunksRefractive'), 0);
});

test('buildPerfReport includes scenario and hitch frames', () => {
  PerfCounters.reset();
  PerfCounters.inc('grassRebuilds', 4);
  const config = parseQaParams('?qa=chunk-cross&duration=3&density=dense-forest');
  const profiler = new FrameProfiler({ hitchMs: 10 });
  profiler.start();
  profiler.beginFrame(0);
  profiler.endFrame();
  profiler.beginFrame(40);
  profiler.mark('stylized');
  profiler.endFrame({
    countersDelta: { grassRebuilds: 4 },
    streaming: {
      resident: 9,
      loading: 1,
      focusChunk: '0:0',
      cache: { cacheSize: 12, revision: 3 },
      origin: { x: 0, z: 0 },
    },
    player: { x: 1, y: 2, z: 3, grounded: true, running: true },
  });

  const report = buildPerfReport({
    config,
    profiler,
    meta: { href: 'http://localhost/?qa=chunk-cross' },
    playerConfig: { walkSpeed: 9 },
    worldConfig: { seed: 1 },
  });

  assert.equal(report.kind, 'simcity-dnd-perf-qa');
  assert.equal(report.scenario.id, 'chunk-cross');
  assert.equal(report.scenario.densityProfile, 'dense-forest');
  assert.equal(report.summary.hitchCount, 1);
  assert.equal(report.counters.grassRebuilds, 4);
  assert.equal(report.hitchFrames.length, 1);
  assert.equal(report.hitchFrames[0].streaming.focusChunk, '0:0');
  assert.equal(report.config.player.walkSpeed, 9);
});
