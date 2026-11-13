import { PerfCounters } from '../editor/performance/qa/PerfCounters.js';
import { RENDER_CREATION_COUNTERS, RENDER_REFRESH_COUNTERS } from '../editor/performance/qa/renderSpikeReport.js';

/** The only adapter using Three's internal creation hooks. Restored on renderer disposal. */
export class RendererCreationDiagnostics {
  constructor(renderer, trace) {
    this.renderer = renderer;
    this.trace = trace;
    this.restores = [];
    this.support = {};
    trace.hookSupport = this.support;
    this.live = true;
    if (!trace.enabled) return;
    const family = object => {
      const name = `${object?.name ?? ''} ${object?.material?.name ?? ''}`.toLowerCase();
      return ['terrain', 'water', 'tree', 'meadow', 'snow', 'rain', 'character', 'construction', 'tropical']
        .find(value => name.includes(value)) ?? 'other';
    };
    const wrap = (target, name, kind) => {
      if (typeof target?.[name] !== 'function') { this.support[name] = false; return; }
      this.support[name] = true;
      const original = target[name];
      const adapter = this;
      function wrapped(...args) {
        const start = trace.clock();
        try { return original.apply(this, args); }
        finally { if (adapter.live) trace.record(kind, 'backend', trace.clock() - start); }
      }
      target[name] = wrapped;
      this.restores.push(() => { if (target[name] === wrapped) target[name] = original; });
    };
    for (const name of ['createProgram', 'createRenderPipeline', 'createComputePipeline',
      'createAttribute', 'createIndexAttribute', 'createStorageAttribute', 'updateAttribute', 'createTexture', 'updateTexture']) {
      wrap(renderer.backend, name, name);
    }
    const debug = renderer.debug;
    this.support.nodeBuilder = Boolean(debug && 'onNodeBuilderCreated' in debug);
    if (this.support.nodeBuilder) {
      const previous = debug.onNodeBuilderCreated;
      const adapter = this;
      const hook = (builder, target) => {
        previous?.(builder, target);
        const originals = { build: builder.build, buildAsync: builder.buildAsync };
        const restore = () => { for (const [name, original] of Object.entries(originals)) if (original) builder[name] = original; };
        const recordBuild = (start, kind) => {
          if (!adapter.live) return;
          trace.record(kind, family(target?.object ?? target ?? builder.object), trace.clock() - start,
            builder.fragmentShader ?? builder.computeShader);
          const samplers = (builder.fragmentShader ?? '').match(/^.*:\s*sampler.*$/gm) ?? [];
          if (samplers.length > 16 && !trace.samplerOverflow) trace.samplerOverflow = {
            object: builder.object?.name, material: builder.material?.name, samplers,
            textures: (builder.uniforms?.fragment ?? []).filter(row => row.node?.isTextureNode)
              .map(row => ({ name: row.name, texture: row.node.value?.name, image: row.node.value?.image?.src,
                sampler: row.node.sampler, uuid: row.node.value?.uuid })),
          };
        };
        // One-shot wrapper: builders cannot retain a disposed diagnostic collector.
        builder.build = function (...args) {
          restore();
          const start = trace.clock();
          try { return originals.build.apply(this, args); }
          finally { recordBuild(start, 'nodeBuild'); }
        };
        if (originals.buildAsync) builder.buildAsync = async function (...args) {
          restore();
          const start = trace.clock();
          try { return await originals.buildAsync.apply(this, args); }
          finally { recordBuild(start, 'nodeBuildAsyncWall'); }
        };
      };
      debug.onNodeBuilderCreated = hook;
      this.restores.push(() => { if (debug.onNodeBuilderCreated === hook) debug.onNodeBuilderCreated = previous; });
    }
  }

  /** Called once after renderer initialization, only for perf QA. */
  attachPerfCounters(targetNames = new Map(), scene = null) {
    if (this.perfCountersAttached) return;
    this.perfCountersAttached = true;
    const adapter = this, renderer = this.renderer, clock = () => this.trace.clock();
    const wrap = (target, name, operation) => {
      if (typeof target?.[name] !== 'function') throw new Error(`Perf QA renderer hook unavailable: ${name}`);
      const original = target[name], own = Object.hasOwn(target, name);
      function wrapped() { return operation.call(this, original, arguments); }
      target[name] = wrapped;
      this.restores.push(() => {
        if (target[name] !== wrapped) return;
        if (own) target[name] = original;
        else delete target[name];
      });
    };
    const creation = (target, name, counter, bytes = false) => wrap(target, name, function (original, args) {
      const start = clock();
      const result = original.apply(this, args);
      PerfCounters.inc(counter);
      PerfCounters.inc(`${counter}CpuMs`, clock() - start);
      if (bytes) PerfCounters.inc(RENDER_CREATION_COUNTERS.bytes, Number(args[0].size));
      return result;
    });
    creation(renderer._objects, 'createRenderObject', RENDER_CREATION_COUNTERS.objects);
    if (renderer.backend.isWebGPUBackend) {
      const device = renderer.backend.device;
      creation(device, 'createRenderPipeline', RENDER_CREATION_COUNTERS.pipelines);
      creation(device, 'createRenderPipelineAsync', RENDER_CREATION_COUNTERS.pipelines);
      creation(device, 'createBuffer', RENDER_CREATION_COUNTERS.buffers, true);
      creation(device, 'createBindGroup', RENDER_CREATION_COUNTERS.bindGroups);
    }
    if (renderer.isRenderer) {
      const stack = [], slowDrawNames = new Set();
      let depth = 0;
      const stage = (target, name, label, draw = false) => wrap(target, name, function (original, args) {
        if (depth === 0 && label !== 'sceneSetup') return original.apply(this, args);
        const parent = depth ? stack[depth - 1] : null;
        const frame = stack[depth] ??= { childrenMs: 0 };
        frame.childrenMs = 0; depth++;
        const start = clock();
        try { return original.apply(this, args); }
        finally {
          const elapsed = clock() - start;
          depth--;
          if (parent) parent.childrenMs += elapsed;
          const ownMs = Math.max(0, elapsed - frame.childrenMs);
          PerfCounters.inc(`renderStageCpuMs:${label}`, ownMs);
          if (draw) PerfCounters.inc(RENDER_REFRESH_COUNTERS.draws);
          if (draw && ownMs >= 1) {
            let family = (args[1]?.name || args[0]?.name || 'unnamed').replace(/[-_:\s]?-?\d+([,.:_-]-?\d+)*/g, '').slice(0, 48);
            if (slowDrawNames.size < 64 || slowDrawNames.has(family)) slowDrawNames.add(family);
            else family = 'other';
            PerfCounters.inc(`renderSlowDraw:${family}`, ownMs);
          }
        }
      });
      stage(renderer, '_renderScene', 'sceneSetup');
      stage(renderer, '_renderObjectDirect', 'drawSubmission', true);
      stage(renderer.backend, 'finishRender', 'commandSubmission');
      if (scene) stage(scene, 'updateMatrixWorld', 'matrixWorld');
      // Three's own verdict per draw: 0 none, 1 shared, 2 full (RenderObjectRefreshType).
      const refresh = [RENDER_REFRESH_COUNTERS.none, RENDER_REFRESH_COUNTERS.shared, RENDER_REFRESH_COUNTERS.full];
      wrap(renderer._nodes, 'needsRefresh', function (original, args) {
        const type = original.apply(this, args);
        PerfCounters.inc(refresh[type] ?? RENDER_REFRESH_COUNTERS.full);
        return type;
      });
    }
    wrap(renderer, 'render', function (original, args) {
      const target = this.getRenderTarget();
      const base = targetNames.get(target) || target?.texture?.name || target?.name || (target ? 'offscreen' : 'canvas');
      const name = target?.isCubeRenderTarget ? `${base}:face${this.getActiveCubeFace()}` : base;
      const parent = adapter.sceneRender, frame = { childrenMs: 0 };
      adapter.sceneRender = frame;
      const start = clock();
      try { return original.apply(this, args); }
      finally {
        const elapsed = clock() - start;
        adapter.sceneRender = parent;
        if (parent) parent.childrenMs += elapsed;
        PerfCounters.inc(`renderScene:${name}`);
        PerfCounters.inc(`renderSceneCpuMs:${name}`, Math.max(0, elapsed - frame.childrenMs));
      }
    });
  }

  dispose() { this.live = false; this.restores.reverse().forEach(restore => restore()); this.restores.length = 0; }
}
