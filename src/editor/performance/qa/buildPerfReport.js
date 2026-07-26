import { PerfCounters } from './PerfCounters.js';

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

export function buildPerfReport({
  config,
  profiler,
  meta = {},
  playerConfig = null,
  worldConfig = null,
}) {
  const frames = profiler.getFrames();
  const summary = profiler.summarize();
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
    version: 1,
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
    },
    config: {
      player: playerConfig,
      world: worldConfig,
    },
    summary: roundedSummary,
    counters: PerfCounters.snapshot(),
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
