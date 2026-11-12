export const RENDER_CREATION_COUNTERS = Object.freeze({
  objects: 'renderObjectsCreated', pipelines: 'renderPipelinesCreated',
  buffers: 'renderGpuBuffersCreated', bytes: 'renderGpuBufferBytesCreated',
  bindGroups: 'renderBindGroupsCreated',
});

const creationNames = new Set(Object.values(RENDER_CREATION_COUNTERS));
const mainTargets = new Set(['canvas', 'output']);

/** Creation or an auxiliary scene that accounts for the render-time excess. */
export function renderSpikeReport(report) {
  const p50Ms = report.summary?.phases?.render?.p50Ms;
  if (!Number.isFinite(p50Ms)) return { available: false, spikes: [], reason: 'Render p50 is missing; recapture with the current harness.' };
  const frames = new Map([...(report.samples ?? []), ...(report.hitchFrames ?? [])].map(frame => [frame.index, frame]));
  const measured = [...frames.values()].filter(frame => frame.dtMs > 0);
  const stageNames = new Set(measured.flatMap(frame => Object.keys(frame.countersDelta ?? {}))
    .filter(name => name.startsWith('renderStageCpuMs:')));
  const stageP50 = report.summary.frameCount === measured.length
    ? Object.fromEntries([...stageNames].map(name => [name,
      percentileSorted(measured.map(frame => frame.countersDelta?.[name] ?? 0).sort((a, b) => a - b), .5)])) : {};
  const spikes = [...frames.values()].filter(frame => frame.dtMs > 0 && frame.phases?.render > p50Ms + 5)
    .sort((a, b) => a.index - b.index).map(frame => {
      const counters = frame.countersDelta ?? {};
      const causes = Object.entries(counters).filter(([name, value]) => value > 0 && (
        creationNames.has(name) || (name.startsWith('renderSceneCpuMs:')
          && !mainTargets.has(name.slice('renderSceneCpuMs:'.length))
          && value >= frame.phases.render - p50Ms)));
      const stageExcess = Object.entries(stageP50).map(([name, median]) => [name, Math.max(0, (counters[name] ?? 0) - median)])
        .filter(([, excess]) => excess > 0);
      if (stageExcess.reduce((sum, [, excess]) => sum + excess, 0) >= (frame.phases.render - p50Ms) * .8) {
        for (const [name] of stageExcess) causes.push([name, counters[name]]);
        for (const [name, value] of Object.entries(counters)) if (name.startsWith('renderSlowDraw:') && value > 0) causes.push([name, value]);
      }
      return { index: frame.index, timestamp: frame.timestamp, dtMs: frame.dtMs,
        renderMs: frame.phases.render, counters, causes: Object.fromEntries(causes), attributed: causes.length > 0 };
    });
  const attributed = spikes.filter(frame => frame.attributed).length;
  return { available: true, p50Ms, thresholdMs: p50Ms + 5, stageP50, spikes, attributed,
    attributedShare: spikes.length ? attributed / spikes.length : 1 };
}
import { percentileSorted } from './FrameProfiler.js';

