import assert from 'node:assert/strict';
import test from 'node:test';
import { RendererCreationDiagnostics } from '../src/render/RendererCreationDiagnostics.js';
import { StartupTrace } from '../src/editor/performance/StartupTrace.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';
import { FrameProfiler } from '../src/editor/performance/qa/FrameProfiler.js';
import { buildPerfReport } from '../src/editor/performance/qa/buildPerfReport.js';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';
import { renderSpikeReport, RENDER_CREATION_COUNTERS as C } from '../src/editor/performance/qa/renderSpikeReport.js';

test('perf hooks count real allocations, preserve async return values and restore inherited methods', async () => {
  PerfCounters.reset();
  let time = 0;
  const pipelinePromise = Promise.resolve({ pipeline: true });
  const device = Object.create({
    createBuffer(descriptor) { assert.equal(this, device); time += 3; return { size: descriptor.size }; },
    createBindGroup() { time++; return { group: true }; },
    createRenderPipeline() { time += 2; return { pipeline: true }; },
    createRenderPipelineAsync() { return pipelinePromise; },
  });
  const renderer = { backend: { isWebGPUBackend: true, device },
    _objects: { createRenderObject: value => value }, getRenderTarget: () => null, render() {} };
  const originalRender = renderer.render, originalBuffer = device.createBuffer;
  const adapter = new RendererCreationDiagnostics(renderer, new StartupTrace({ clock: () => time }));
  assert.equal(renderer.render, originalRender, 'normal startup does not enable perf hooks');
  assert.equal(device.createBuffer, originalBuffer);
  assert.deepEqual(PerfCounters.snapshot(), {});
  adapter.attachPerfCounters(); adapter.attachPerfCounters();
  const object = {};
  assert.equal(renderer._objects.createRenderObject(object), object);
  assert.equal(device.createBuffer({ size: 128 }).size, 128);
  device.createBindGroup(); device.createRenderPipeline();
  assert.equal(device.createRenderPipelineAsync(), pipelinePromise);
  await pipelinePromise;
  assert.equal(PerfCounters.get(C.objects), 1);
  assert.equal(PerfCounters.get(C.pipelines), 2);
  assert.equal(PerfCounters.get(C.buffers), 1);
  assert.equal(PerfCounters.get(C.bytes), 128);
  assert.equal(PerfCounters.get(C.bindGroups), 1);
  assert.equal(PerfCounters.get(`${C.buffers}CpuMs`), 3);
  adapter.dispose(); adapter.dispose();
  assert.equal(device.createBuffer, originalBuffer);
  assert.equal(Object.hasOwn(device, 'createBuffer'), false);
  assert.equal(renderer.render, originalRender);
  PerfCounters.reset();
});

test('nested scene timings name cube faces and exclude child work, including on failure', () => {
  PerfCounters.reset();
  let time = 0, target = { texture: { name: 'output' } };
  const main = target, cube = { isCubeRenderTarget: true };
  const renderer = { backend: {}, _objects: { createRenderObject() {} }, getRenderTarget: () => target,
    getActiveCubeFace: () => 4,
    render(nested) {
      if (nested) { time += 7; throw new Error('draw failed'); }
      time += 2; target = cube;
      try { this.render(true); } finally { target = main; time += 3; }
    } };
  const adapter = new RendererCreationDiagnostics(renderer, new StartupTrace({ clock: () => time }));
  adapter.attachPerfCounters(new Map([[cube, 'waterReflectionCube0']]));
  assert.throws(() => renderer.render(false), /draw failed/);
  assert.equal(PerfCounters.get('renderScene:waterReflectionCube0:face4'), 1);
  assert.equal(PerfCounters.get('renderSceneCpuMs:waterReflectionCube0:face4'), 7);
  assert.equal(PerfCounters.get('renderSceneCpuMs:output'), 5);
  assert.equal(adapter.sceneRender, undefined);
  adapter.dispose(); PerfCounters.reset();
});

test('spike attribution deduplicates frames and does not blame a routine shadow render', () => {
  const frame = (index, render, countersDelta, dtMs = 10) => ({ index, dtMs, phases: { render }, countersDelta });
  const creation = frame(2, 11, { [C.buffers]: 1, [C.bytes]: 64 });
  const report = { summary: { phases: { render: { p50Ms: 5 } } }, samples: [
    frame(0, 100, { [C.objects]: 1 }, 0), frame(1, 10, { [C.objects]: 1 }), creation,
    frame(3, 20, { 'renderScene:ShadowMap': 1, 'renderSceneCpuMs:ShadowMap': .2 }),
    frame(4, 18, { 'renderSceneCpuMs:waterReflectionPlanar': 13 }),
  ], hitchFrames: [creation] };
  const result = renderSpikeReport(report);
  assert.deepEqual(result.spikes.map(row => row.index), [2, 3, 4]);
  assert.equal(result.attributed, 2);
  assert.equal(result.attributedShare, 2 / 3);
  assert.equal(result.spikes[1].attributed, false);
  assert.equal(renderSpikeReport({}).available, false);
});

test('reports retain every p50 + 5 ms render spike even below the old 8 ms sampling cutoff', () => {
  PerfCounters.reset();
  const profiler = new FrameProfiler();
  profiler.frames = Array.from({ length: 300 }, (_, index) => ({ index, timestamp: index * 10, dt: 10,
    phases: { render: index === 1 ? 6.2 : 1 }, countersDelta: {} }));
  const report = buildPerfReport({ config: parseQaParams('?qa=move'), profiler });
  assert.equal(report.summary.phases.render.p50Ms, 1);
  assert.equal(renderSpikeReport(report).spikes[0].index, 1);
  assert.equal(renderSpikeReport(report).spikes.length, 1);
});

test('exclusive render stages account for nested work without clocking scene updates outside render', () => {
  PerfCounters.reset();
  let time = 0;
  const scene = { updateMatrixWorld() { time += 2; } };
  const renderer = { isRenderer: true, backend: { finishRender() { time++; } },
    _objects: { createRenderObject() {} }, getRenderTarget: () => null,
    _renderObjectDirect() { time += 4; },
    _renderScene() { time++; scene.updateMatrixWorld(); this._renderObjectDirect({ name: 'tree-123' }, {}); this.backend.finishRender(); },
    render() { this._renderScene(); } };
  const adapter = new RendererCreationDiagnostics(renderer, new StartupTrace({ clock: () => time }));
  adapter.attachPerfCounters(new Map(), scene);
  scene.updateMatrixWorld();
  assert.equal(PerfCounters.get('renderStageCpuMs:matrixWorld'), 0);
  renderer.render();
  assert.equal(PerfCounters.get('renderStageCpuMs:sceneSetup'), 1);
  assert.equal(PerfCounters.get('renderStageCpuMs:matrixWorld'), 2);
  assert.equal(PerfCounters.get('renderStageCpuMs:drawSubmission'), 4);
  assert.equal(PerfCounters.get('renderStageCpuMs:commandSubmission'), 1);
  assert.equal(PerfCounters.get('renderSlowDraw:tree'), 4);
  adapter.dispose(); PerfCounters.reset();
});

test('stage attribution requires complete samples and accounts for excess above stage medians', () => {
  const samples = Array.from({ length: 9 }, (_, index) => ({ index, dtMs: 10, phases: { render: index === 8 ? 15 : 5 },
    countersDelta: { 'renderStageCpuMs:drawSubmission': index === 8 ? 12 : 3 } }));
  const report = { summary: { frameCount: 9, phases: { render: { p50Ms: 5 } } }, samples };
  assert.equal(renderSpikeReport(report).attributedShare, 1);
  assert.equal(renderSpikeReport(report).stageP50['renderStageCpuMs:drawSubmission'], 3);
  report.summary.frameCount = 10;
  assert.equal(renderSpikeReport(report).attributedShare, 0, 'downsampled data cannot establish a stage median');
});
