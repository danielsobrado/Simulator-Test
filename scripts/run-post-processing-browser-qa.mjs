/**
 * Browser acceptance battery for the world post-processing stack.
 *
 * Prerequisites:
 *   npm run dev
 *   npm run qa:postprocessing:install
 *
 * Usage:
 *   npm run qa:postprocessing:browser -- --headed
 *   npm run qa:postprocessing:browser -- --quick --headed
 *   npm run qa:postprocessing:browser -- --url http://127.0.0.1:5173
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  POST_PROCESSING_CAPTURE_LOCATIONS,
} from '../src/editor/performance/qa/PostProcessingQaCaptures.js';
import {
  DEBUG_VIEWS,
  DEFAULT_POST_PROCESSING_SETTINGS,
  normalizePostProcessingSettings,
  postProcessingSettingsToPlain,
} from '../src/render/postprocessing/PostProcessingSettings.js';
import {
  applyPostProcessingPreset,
} from '../src/render/postprocessing/PostProcessingPresets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(name, fallback) {
  const value = Number(readArg(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive safe integer.`);
  }
  return value;
}

function reportPath(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function clone(value) {
  return structuredClone(value);
}

function mergeSettings(base, patch) {
  const result = clone(base);
  for (const [key, value] of Object.entries(patch)) {
    result[key] = (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && result[key]
      && typeof result[key] === 'object'
    )
      ? { ...result[key], ...value }
      : value;
  }
  return postProcessingSettingsToPlain(
    normalizePostProcessingSettings(result, { markCustom: true }),
  );
}

function presetSettings(id) {
  return postProcessingSettingsToPlain(
    applyPostProcessingPreset(id, DEFAULT_POST_PROCESSING_SETTINGS),
  );
}

function buildMatrix(quick) {
  const primary = POST_PROCESSING_CAPTURE_LOCATIONS[0];
  const balanced = presetSettings('balanced');
  const presets = ['off', 'low', 'balanced', 'high', 'ultra'].map((id) => ({
    id: `preset-${id}`,
    label: `${id[0].toUpperCase()}${id.slice(1)} preset`,
    location: primary,
    settings: presetSettings(id),
    category: 'preset',
  }));
  if (quick) {
    return presets.filter(({ id }) => id === 'preset-off' || id === 'preset-balanced');
  }

  const cases = [...presets];
  for (const location of POST_PROCESSING_CAPTURE_LOCATIONS.slice(1)) {
    cases.push({
      id: `scene-${location.id}-balanced`,
      label: `${location.label} / Balanced`,
      location,
      settings: clone(balanced),
      category: 'scene',
    });
  }
  for (const renderScale of [0.85, 0.67]) {
    cases.push({
      id: `balanced-traau-${String(renderScale).replace('.', '-')}`,
      label: `Balanced + TAAU ${renderScale}`,
      location: primary,
      settings: mergeSettings(balanced, {
        renderScale,
        antiAliasing: { enabled: true, mode: 'traau' },
      }),
      category: 'feature',
    });
  }
  cases.push({
    id: 'screen-space-shafts',
    label: 'Screen-space shafts',
    location: POST_PROCESSING_CAPTURE_LOCATIONS.find(({ id }) => id === 'forest-aerial')
      ?? primary,
    settings: mergeSettings(balanced, {
      screenSpaceShafts: { enabled: true },
    }),
    category: 'feature',
  });
  for (const focusMode of ['player', 'selection', 'centre-raycast', 'manual']) {
    cases.push({
      id: `dof-${focusMode}`,
      label: `DOF / ${focusMode}`,
      location: primary,
      settings: mergeSettings(balanced, {
        depthOfField: { enabled: true, focusMode },
      }),
      category: 'feature',
    });
  }
  cases.push(
    {
      id: 'vignette',
      label: 'Vignette',
      location: primary,
      settings: mergeSettings(balanced, { vignette: { enabled: true } }),
      category: 'feature',
    },
    {
      id: 'grain',
      label: 'Grain',
      location: primary,
      settings: mergeSettings(balanced, { grain: { enabled: true } }),
      category: 'feature',
    },
  );
  for (const debugView of DEBUG_VIEWS) {
    cases.push({
      id: `debug-${debugView}`,
      label: `Debug / ${debugView}`,
      location: primary,
      settings: mergeSettings(balanced, {
        diagnostics: { enabled: true, debugView },
      }),
      category: 'debug',
    });
  }
  return cases;
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}. Start the app with npm run dev.`);
}

function isSoftwareAdapter(adapter) {
  const description = [adapter.vendor, adapter.architecture, adapter.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return !adapter.ok
    || adapter.fallback
    || description.length === 0
    || /swiftshader|lavapipe|basic render|microsoft basic|llvmpipe|warp/.test(description);
}

async function inspectRuntime(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(
      'canvas[aria-label="Drusniel World infinite world editor viewport"]',
    );
    let canvasWebGpu = false;
    let canvasWebGl2 = false;
    try {
      canvasWebGpu = canvas?.getContext('webgpu') !== null;
    } catch {
      canvasWebGpu = false;
    }
    try {
      canvasWebGl2 = canvas?.getContext('webgl2') !== null;
    } catch {
      canvasWebGl2 = false;
    }
    if (!navigator.gpu) {
      return {
        adapter: { ok: false, reason: 'navigator.gpu is unavailable' },
        rendererBackend: { webgpu: canvasWebGpu, webgl2: canvasWebGl2 },
      };
    }
    const found = await navigator.gpu.requestAdapter({
      featureLevel: 'compatibility',
      xrCompatible: false,
    });
    if (!found) {
      return {
        adapter: { ok: false, reason: 'no WebGPU adapter' },
        rendererBackend: { webgpu: canvasWebGpu, webgl2: canvasWebGl2 },
      };
    }
    const info = found.info ?? {};
    return {
      adapter: {
        ok: true,
        vendor: info.vendor ?? null,
        architecture: info.architecture ?? null,
        description: info.description ?? null,
        fallback: Boolean(found.isFallbackAdapter),
      },
      rendererBackend: { webgpu: canvasWebGpu, webgl2: canvasWebGl2 },
    };
  });
}

function pngInfo(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error(`Screenshot is not a PNG: ${filePath}`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
  };
}

function locationUrl(baseUrl, location) {
  const query = new URLSearchParams({
    qa: 'post-processing-capture',
    ppCapture: location.id,
    density: location.density ?? 'standard',
    x: String(location.spawn?.x ?? 0),
    z: String(location.spawn?.z ?? 0),
    yaw: String(location.yawDegrees ?? 0),
    pitch: String(location.pitchDegrees ?? 0),
    autostart: '0',
    download: '0',
  });
  if (location.weather) query.set('weather', location.weather);
  if (location.night) query.set('night', '1');
  if (location.spell) query.set('spell', '1');
  return `${baseUrl}/?${query.toString()}`;
}

async function settleFrames(page, count) {
  await page.evaluate((frames) => new Promise((resolve) => {
    let remaining = frames;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), count);
}

async function waitForRuntimeReady(page, timeoutMs, errors = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      errors
      && (errors.page.length > 0
        || errors.gpu.length > 0
        || errors.wgsl.length > 0
        || errors.pipeline.length > 0)
    ) {
      throw new Error(
        'Startup emitted a GPU, WGSL, pipeline, or page error before the runtime became ready.',
      );
    }
    try {
      const ready = await page.evaluate(() => Boolean(
        window.__perfQa
        && window.__editor?.terrainView
        && (
          window.__editor?.sceneSettingsRuntime?.postProcessing?.get
          || window.__editor?.postProcessingStore?.get
        ),
      ));
      if (ready) return;
    } catch {
      // A Vite reload can briefly replace the execution context.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for the app runtime.`);
}

async function runCase(page, testCase, context) {
  const { timeoutMs, settleFrameCount, screenshotsDir, errors } = context;
  const startedAt = performance.now();
  await page.goto(locationUrl(context.baseUrl, testCase.location), {
    waitUntil: 'domcontentloaded',
  });
  await waitForRuntimeReady(page, timeoutMs, errors);
  await page.evaluate((mode) => {
    window.__editor.applyPostProcessingCaptureMode?.(mode);
  }, {
    weather: testCase.location.weather ?? null,
    night: Boolean(testCase.location.night),
    spell: Boolean(testCase.location.spell),
  });

  const before = await page.evaluate(() => ({
    resetCount: window.__editor.terrainView?.postProcessing?.history?.resetCount ?? null,
    graphBuilds: window.__editor.terrainView?.postProcessing?.diagnostics?.graphBuilds ?? null,
  }));
  const errorStart = {
    console: errors.console.length,
    gpu: errors.gpu.length,
    wgsl: errors.wgsl.length,
    pipeline: errors.pipeline.length,
  };
  const applyStartedAt = performance.now();
  await page.evaluate((settings) => {
    window.__editor.sceneSettingsRuntime.postProcessing.reset(settings);
  }, testCase.settings);
  await settleFrames(page, settleFrameCount);
  const applyAndSettleMs = performance.now() - applyStartedAt;

  const state = await page.evaluate(() => {
    const controller = window.__editor.terrainView?.postProcessing;
    const store = window.__editor.sceneSettingsRuntime?.postProcessing;
    return {
      settings: store?.get?.() ?? null,
      diagnostics: controller?.diagnostics?.snapshot?.() ?? null,
      history: controller?.history
        ? {
          resetCount: controller.history.resetCount,
          lastResetReason: controller.history.lastResetReason,
          taaColourValid: controller.history.taaColourValid,
          taaDepthValid: controller.history.taaDepthValid,
          ssrValid: controller.history.ssrValid,
        }
        : null,
      rendererBackend: window.__editor.terrainView?.rendererBackendStatus ?? null,
    };
  });
  const screenshotPath = path.join(screenshotsDir, `${testCase.id}.png`);
  await page.screenshot({ path: screenshotPath, type: 'png' });
  const png = pngInfo(screenshotPath);
  return {
    id: testCase.id,
    label: testCase.label,
    category: testCase.category,
    scene: testCase.location.id,
    status: 'passed',
    timingsMs: {
      applyAndSettle: applyAndSettleMs,
      total: performance.now() - startedAt,
      gpu: state.diagnostics?.gpuTimings ?? null,
      gpuSource: state.diagnostics?.gpuTimingSource ?? null,
    },
    resetCount: state.history?.resetCount ?? null,
    resetDelta: Number.isFinite(before.resetCount) && Number.isFinite(state.history?.resetCount)
      ? state.history.resetCount - before.resetCount
      : null,
    graphBuildDelta: Number.isFinite(before.graphBuilds)
      && Number.isFinite(state.diagnostics?.graphBuilds)
      ? state.diagnostics.graphBuilds - before.graphBuilds
      : null,
    settings: state.settings,
    diagnostics: state.diagnostics,
    history: state.history,
    rendererBackend: state.rendererBackend,
    screenshotPath: reportPath(screenshotPath),
    screenshot: png,
    errorCounts: {
      console: errors.console.length - errorStart.console,
      gpu: errors.gpu.length - errorStart.gpu,
      wgsl: errors.wgsl.length - errorStart.wgsl,
      pipeline: errors.pipeline.length - errorStart.pipeline,
    },
  };
}

async function runDynamic(page, {
  id,
  label,
  supported,
  action,
}) {
  if (!supported) {
    return { id, label, status: 'skipped', note: 'Required runtime API is unavailable.' };
  }
  const startedAt = performance.now();
  try {
    const details = await action();
    return {
      id,
      label,
      status: 'passed',
      timingMs: performance.now() - startedAt,
      ...details,
    };
  } catch (error) {
    return {
      id,
      label,
      status: 'failed',
      timingMs: performance.now() - startedAt,
      error: error?.stack ?? String(error),
    };
  }
}

async function runDynamics(page, quick, presetSequence) {
  const capabilities = await page.evaluate(() => ({
    settings: typeof window.__editor?.sceneSettingsRuntime?.postProcessing?.set === 'function',
    camera: typeof window.__editor?.viewModeController?.setMode === 'function',
    teleport: typeof window.__editor?.playerController?.setPose === 'function'
      && window.__editor?.terrainView?.floatingOrigin != null,
  }));
  const results = [];
  results.push(await runDynamic(page, {
    id: 'master-toggle-100',
    label: 'Toggle master on/off 100 times',
    supported: capabilities.settings,
    action: async () => page.evaluate(async () => {
      const store = window.__editor.sceneSettingsRuntime.postProcessing;
      const before = window.__editor.terrainView?.postProcessing?.history?.resetCount ?? null;
      const started = performance.now();
      for (let index = 0; index < 100; index += 1) {
        store.set({ enabled: index % 2 === 1 });
        await new Promise(requestAnimationFrame);
      }
      return {
        iterations: 100,
        browserTimingMs: performance.now() - started,
        resetCountBefore: before,
        resetCountAfter:
          window.__editor.terrainView?.postProcessing?.history?.resetCount ?? null,
        finalEnabled: store.get().enabled,
      };
    }),
  }));
  if (quick) return results;

  results.push(await runDynamic(page, {
    id: 'preset-cycle-50',
    label: 'Cycle presets 50 times',
    supported: capabilities.settings,
    action: async () => page.evaluate(async (sequence) => {
      const store = window.__editor.sceneSettingsRuntime.postProcessing;
      const started = performance.now();
      for (let index = 0; index < 50; index += 1) {
        store.reset(sequence[index % sequence.length]);
        await new Promise(requestAnimationFrame);
      }
      return {
        iterations: 50,
        browserTimingMs: performance.now() - started,
        finalPreset: store.get().preset,
      };
    }, presetSequence),
  }));
  results.push(await runDynamic(page, {
    id: 'resize-matrix',
    label: 'Resize viewport matrix',
    supported: true,
    action: async () => {
      const samples = [];
      for (const viewport of [
        { width: 1280, height: 720 },
        { width: 1920, height: 1080 },
        { width: 2560, height: 1440 },
      ]) {
        const started = performance.now();
        await page.setViewportSize(viewport);
        await settleFrames(page, 4);
        samples.push({ ...viewport, timingMs: performance.now() - started });
      }
      return { samples };
    },
  }));
  results.push(await runDynamic(page, {
    id: 'camera-switch-30',
    label: 'Switch player/editor camera 30 times',
    supported: capabilities.camera,
    action: async () => page.evaluate(async () => {
      const view = window.__editor.viewModeController;
      const started = performance.now();
      for (let index = 0; index < 30; index += 1) {
        if (index % 2 === 0) {
          view.setMode('player', {
            requestPointerLock: false,
            spawn: { x: 0, z: 0 },
          });
        } else {
          view.setMode('edit', { requestPointerLock: false });
        }
        await new Promise(requestAnimationFrame);
      }
      return {
        iterations: 30,
        browserTimingMs: performance.now() - started,
        finalMode: view.mode,
      };
    }),
  }));
  results.push(await runDynamic(page, {
    id: 'floating-origin-teleport',
    label: 'Floating-origin teleport/rebase',
    supported: capabilities.teleport,
    action: async () => page.evaluate(async () => {
      const editor = window.__editor;
      const threshold = Number(editor.config?.world?.floatingOriginThreshold) || 4096;
      if (editor.viewModeController.mode !== 'player') {
        editor.viewModeController.setMode('player', {
          requestPointerLock: false,
          spawn: { x: 0, z: 0 },
        });
      }
      const before = editor.terrainView.floatingOrigin.getState?.() ?? null;
      editor.playerController.setPose({ x: threshold + 256, z: 0, yaw: 0, pitch: 0 });
      for (let index = 0; index < 8; index += 1) {
        await new Promise(requestAnimationFrame);
      }
      const after = editor.terrainView.floatingOrigin.getState?.() ?? null;
      return {
        threshold,
        before,
        after,
        rebased: JSON.stringify(before) !== JSON.stringify(after),
      };
    }),
  }));
  results.push(
    {
      id: 'device-loss',
      label: 'WebGPU device loss',
      status: 'skipped',
      note: 'No safe public hook exists; forcing device loss would invalidate the remaining battery.',
    },
    {
      id: 'hot-reload',
      label: 'Shader hot reload',
      status: 'skipped',
      note: 'No deterministic in-page hook exists; file mutation is intentionally outside this runner.',
    },
  );
  return results;
}

function writeGallery(filePath, report) {
  const lines = [
    '# Post-processing browser QA gallery',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Mode: ${report.config.quick ? 'quick' : 'full'}`,
    '',
    '| Case | Scene | Result | Screenshot |',
    '|---|---|---:|---|',
  ];
  for (const result of report.cases) {
    if (!result.screenshotPath) {
      lines.push(`| ${result.label} | ${result.scene} | ${result.status} | unavailable |`);
      continue;
    }
    const relativeScreenshot = path.relative(
      path.dirname(filePath),
      path.resolve(root, result.screenshotPath),
    ).replaceAll('\\', '/');
    lines.push(
      `| ${result.label} | ${result.scene} | ${result.status} | `
      + `[image](${relativeScreenshot}) |`,
    );
  }
  lines.push('', '## Screenshots', '');
  for (const result of report.cases) {
    if (!result.screenshotPath) continue;
    const relativeScreenshot = path.relative(
      path.dirname(filePath),
      path.resolve(root, result.screenshotPath),
    ).replaceAll('\\', '/');
    lines.push(`### ${result.label}`, '', `![${result.label}](${relativeScreenshot})`, '');
  }
  if (report.dynamicTests.length > 0) {
    lines.push('## Dynamic tests', '');
    for (const test of report.dynamicTests) {
      lines.push(`- **${test.label}:** ${test.status}${test.note ? ` — ${test.note}` : ''}`);
    }
    lines.push('');
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const quick = hasFlag('quick');
const headed = hasFlag('headed');
const allowSoftware = hasFlag('allow-software');
const baseUrl = readArg('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const timeoutMs = positiveInteger('timeoutMs', 180_000);
const settleFrameCount = positiveInteger('settleFrames', quick ? 6 : 12);
const outDir = path.resolve(
  readArg('outDir', path.join(root, 'tmp', 'post-processing-qa')),
);
const screenshotsDir = path.join(outDir, 'screenshots');
const reportFile = path.join(outDir, 'report.json');
const galleryFile = path.join(outDir, 'gallery.md');

async function main() {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await waitForServer(baseUrl, Math.min(timeoutMs, 30_000));

  const matrix = buildMatrix(quick);
  const errors = {
    console: [],
    page: [],
    gpu: [],
    wgsl: [],
    pipeline: [],
  };
  const report = {
    kind: 'simcity-dnd-post-processing-browser-qa',
    version: 1,
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl,
      quick,
      headed,
      allowSoftware,
      settleFrames: settleFrameCount,
      timeoutMs,
    },
    adapter: null,
    rendererBackend: null,
    cases: [],
    dynamicTests: [],
    errors,
    notes: [],
    verdict: { passed: false, failures: [] },
  };

  let browser = null;
  let currentCaseId = 'bootstrap';
  try {
    browser = await chromium.launch({
      headless: !headed,
      args: [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--use-angle=default',
        '--enable-gpu-rasterization',
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(timeoutMs);
    page.on('console', (message) => {
      const entry = {
        caseId: currentCaseId,
        type: message.type(),
        text: message.text(),
        timestamp: new Date().toISOString(),
      };
      if (message.type() === 'error' || message.type() === 'warning') {
        errors.console.push(entry);
      }
      const diagnostic = message.type() === 'error' || message.type() === 'warning';
      if (diagnostic && /\b(?:webgpu|gpu|device lost|validation error)\b/i.test(entry.text)) {
        errors.gpu.push(entry);
      }
      if (diagnostic && /\b(?:wgsl|shader)\b/i.test(entry.text)) errors.wgsl.push(entry);
      if (diagnostic && /\bpipeline\b/i.test(entry.text)) errors.pipeline.push(entry);
    });
    page.on('pageerror', (error) => {
      errors.page.push({
        caseId: currentCaseId,
        text: error?.stack ?? String(error),
        timestamp: new Date().toISOString(),
      });
    });

    currentCaseId = 'adapter-check';
    await page.goto(locationUrl(baseUrl, matrix[0].location), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__editor?.terrainView != null, null, {
      timeout: timeoutMs,
    });
    const runtime = await inspectRuntime(page);
    report.adapter = runtime.adapter;
    report.rendererBackend = runtime.rendererBackend;
    if (!runtime.rendererBackend.webgpu || runtime.rendererBackend.webgl2) {
      throw new Error(`Measured renderer is not WebGPU: ${JSON.stringify(runtime.rendererBackend)}`);
    }
    if (isSoftwareAdapter(runtime.adapter) && !allowSoftware) {
      const error = new Error(
        `WebGPU adapter is software or unidentified: ${JSON.stringify(runtime.adapter)}`,
      );
      error.exitCode = 2;
      throw error;
    }
    await waitForRuntimeReady(page, timeoutMs, errors);

    for (const testCase of matrix) {
      currentCaseId = testCase.id;
      console.log(`Post-processing browser QA: ${testCase.label}`);
      try {
        report.cases.push(await runCase(page, testCase, {
          baseUrl,
          timeoutMs,
          settleFrameCount,
          screenshotsDir,
          errors,
        }));
      } catch (error) {
        report.cases.push({
          id: testCase.id,
          label: testCase.label,
          category: testCase.category,
          scene: testCase.location.id,
          status: 'failed',
          error: error?.stack ?? String(error),
        });
      }
    }

    currentCaseId = 'dynamic-tests';
    report.dynamicTests = await runDynamics(
      page,
      quick,
      ['off', 'low', 'balanced', 'high', 'ultra'].map(presetSettings),
    );
  } catch (error) {
    report.verdict.failures.push(error?.stack ?? String(error));
    if (error?.exitCode) process.exitCode = error.exitCode;
    else process.exitCode = 1;
  } finally {
    await browser?.close();
    const failedCases = report.cases.filter(({ status }) => status === 'failed');
    const failedDynamics = report.dynamicTests.filter(({ status }) => status === 'failed');
    const runtimeErrors = [
      ...errors.page,
      ...errors.gpu,
      ...errors.wgsl,
      ...errors.pipeline,
    ];
    if (failedCases.length > 0) {
      report.verdict.failures.push(
        `Failed cases: ${failedCases.map(({ id }) => id).join(', ')}`,
      );
    }
    if (failedDynamics.length > 0) {
      report.verdict.failures.push(
        `Failed dynamic tests: ${failedDynamics.map(({ id }) => id).join(', ')}`,
      );
    }
    if (runtimeErrors.length > 0) {
      report.verdict.failures.push(
        `GPU/WGSL/pipeline/page errors captured: ${runtimeErrors.length}`,
      );
    }
    if (report.cases.length !== matrix.length) {
      report.verdict.failures.push(
        `Only ${report.cases.length} of ${matrix.length} matrix cases completed.`,
      );
    }
    report.verdict.passed = report.verdict.failures.length === 0;
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    writeGallery(galleryFile, report);
    console.log(JSON.stringify({
      report: reportPath(reportFile),
      gallery: reportPath(galleryFile),
      screenshots: reportPath(screenshotsDir),
      cases: report.cases.length,
      dynamicTests: report.dynamicTests.length,
      passed: report.verdict.passed,
    }, null, 2));
    if (!report.verdict.passed && !process.exitCode) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
