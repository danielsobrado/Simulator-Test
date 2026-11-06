/**
 * Headless runner for the in-app Perf QA harness.
 *
 * Prerequisites: `npm run dev` already serving the app and the repository's
 * Playwright Chromium installed.
 *
 * Usage:
 *   npm run qa:perf
 *   npm run qa:perf -- --qa chunk-cross --duration 12 --warmup 2
 *   npm run qa:perf -- --qa collision-p8 --out tmp/collision-p8.json
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultPerfQaTimeoutMs } from './lib/perf-qa-timeout.mjs';
import { waitForPerfRunLock } from './perf-run-lock.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'tmp');

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveNumber(name, fallback, { integer = false } = {}) {
  const value = Number(readArg(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`--${name} must be a positive ${integer ? 'safe integer' : 'number'}.`);
  }
  return value;
}

function setOptionalQuery(query, key, value) {
  if (value !== null) query.set(key, value);
}

const baseUrl = readArg('url', 'http://localhost:5173');
const scenario = readArg('qa', 'chunk-cross');
const duration = readArg('duration', '12');
const warmup = readArg('warmup', '2');
const speed = readArg('speed', 'run');
const hitchMs = readArg('hitchMs', '33.3');
const buildings = readArg('buildings');
const density = readArg('density');
const collisionDebug = readArg('collisionDebug');
const constructionStyle = readArg('constructionStyle');
const spawnX = readArg('x');
const spawnZ = readArg('z');
const yaw = readArg('yaw');
const pitch = readArg('pitch');
const viewportWidth = positiveNumber('viewportWidth', 1280, { integer: true });
const viewportHeight = positiveNumber('viewportHeight', 720, { integer: true });
const deviceScaleFactor = positiveNumber('deviceScaleFactor', 1);
const outPath = path.resolve(readArg('out', path.join(outDir, 'perf-qa-latest.json')));
const screenshotArg = readArg('screenshot');
const screenshotPath = screenshotArg === null ? null : path.resolve(screenshotArg);
const screenshotReportPath = screenshotPath === null
  ? null
  : path.relative(root, screenshotPath).replaceAll('\\', '/');
const cpuProfileArg = readArg('cpu-profile');
const cpuProfilePath = cpuProfileArg === null ? null : path.resolve(cpuProfileArg);
const cpuProfileReportPath = cpuProfilePath === null
  ? null
  : path.relative(root, cpuProfilePath).replaceAll('\\', '/');
const drainSeconds = readArg('drain-seconds') === null
  ? 0 : positiveNumber('drain-seconds', 15);
const runnerPath = path.join(
  outDir,
  `perf-qa-playwright-runner-${process.pid}-${randomUUID()}.cjs`,
);

const query = new URLSearchParams({
  qa: scenario,
  duration,
  warmup,
  speed,
  hitchMs,
  download: '0',
  autostart: '1',
});
setOptionalQuery(query, 'buildings', buildings);
setOptionalQuery(query, 'density', density);
setOptionalQuery(query, 'gpuTimings', readArg('gpuTimings'));
setOptionalQuery(query, 'contactOcclusion', readArg('contactOcclusion'));
setOptionalQuery(query, 'collisionDebug', collisionDebug);
setOptionalQuery(query, 'constructionStyle', constructionStyle);
// settlement-approach only: visit another Eldara burg (looking at a realm's town, not the perf gate).
setOptionalQuery(query, 'burg', readArg('burg'));
if (hasFlag('settle')) query.set('settle', '1');
setOptionalQuery(query, 'settleTimeout', readArg('settleTimeout'));
setOptionalQuery(query, 'x', spawnX);
setOptionalQuery(query, 'z', spawnZ);
setOptionalQuery(query, 'yaw', yaw);
setOptionalQuery(query, 'pitch', pitch);
const target = new URL(baseUrl);
for (const [key, value] of query) target.searchParams.set(key, value);
const targetUrl = target.href;
const timeoutMs = positiveNumber('timeoutMs', defaultPerfQaTimeoutMs(query));

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (screenshotPath !== null) fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
if (cpuProfilePath !== null) fs.mkdirSync(path.dirname(cpuProfilePath), { recursive: true });

fs.writeFileSync(
  runnerPath,
  `
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  let browser = null;
  let cdp = null;
  let cpuProfiling = false;
  try {
    browser = await chromium.launch({
      headless: ${hasFlag('headed') ? 'false' : 'true'},
      // Without the blocklist bypass Chromium quietly hands WebGPU a software
      // adapter, and every number below then describes a CPU rasterizer rather
      // than the GPU path players use. Frame rates come out ~100x too low.
      // vsync is also disabled: a 60 Hz cap hides all headroom above the refresh
      // rate, so a regression is invisible until it drops under the cap.
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
      viewport: { width: ${viewportWidth}, height: ${viewportHeight} },
      deviceScaleFactor: ${deviceScaleFactor},
    });
    page.setDefaultTimeout(${timeoutMs});
    const { createBrowserErrorMonitor } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/perf-browser-errors.mjs')).href)});
    const browserErrors = createBrowserErrorMonitor(page);
    page.on('crash', () => {
      console.error('Perf QA aborted: the browser page crashed.');
      void browser.close();
    });
    page.on('pageerror', error => console.error('Perf QA browser error:', error.stack ?? error.message));
    const { focusPerfBrowser } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/perf-browser-focus.mjs')).href)});
    // Activate the owned blank window before cold renderer work can block it.
    const startupFocus = await focusPerfBrowser(browser, page, { headed: ${hasFlag('headed')} });
    if (!(await startupFocus()).passed) throw new Error('Benchmark startup did not retain foreground focus.');
    await page.goto(${JSON.stringify(targetUrl)}, { waitUntil: 'commit' });
    const captureFocus = await focusPerfBrowser(browser, page, { headed: ${hasFlag('headed')} });
    await page.waitForFunction(() => window.__perfQa != null, null, { timeout: ${timeoutMs} });

    const rendererBackend = await page.evaluate(() => {
      const canvas = document.querySelector(
        'canvas[aria-label="Drusniel World infinite world editor viewport"]',
      );
      if (!canvas) return { webgpu: false, webgl2: false, reason: 'renderer canvas not found' };
      let webgpu = false;
      let webgl2 = false;
      try {
        webgpu = canvas.getContext('webgpu') !== null;
      } catch {
        webgpu = false;
      }
      try {
        webgl2 = canvas.getContext('webgl2') !== null;
      } catch {
        webgl2 = false;
      }
      return { webgpu, webgl2, reason: null };
    });
    if (!rendererBackend.webgpu || rendererBackend.webgl2) {
      console.error('Perf QA aborted: the measured renderer is not using WebGPU.');
      console.error(JSON.stringify(rendererBackend, null, 2));
      process.exitCode = 2;
      return;
    }

    // Match Three's (r187) WebGPUBackend adapter selection. The canvas check above
    // proves the measured renderer is WebGPU; this second request records the
    // identity selected by the same compatibility-level options.
    const adapter = await page.evaluate(async () => {
      if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu is unavailable' };
      const found = await navigator.gpu.requestAdapter({
        featureLevel: 'compatibility',
        xrCompatible: false,
      });
      if (!found) return { ok: false, reason: 'no WebGPU adapter' };
      const flags = found.info ?? {};
      return {
        ok: true,
        vendor: flags.vendor ?? null,
        architecture: flags.architecture ?? null,
        description: flags.description ?? null,
        fallback: Boolean(found.isFallbackAdapter),
      };
    });
    const softwareHint = [adapter.vendor, adapter.architecture, adapter.description]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const isSoftware = !adapter.ok
      || adapter.fallback
      || softwareHint.length === 0
      || /swiftshader|lavapipe|basic render|microsoft basic|llvmpipe|warp/.test(softwareHint);
    if (isSoftware) {
      console.error('Perf QA aborted: WebGPU is using software or unidentified hardware.');
      console.error(JSON.stringify(adapter, null, 2));
      console.error('These timings are not valid hardware-GPU evidence.');
      process.exitCode = 2;
      return;
    }
    console.log('WebGPU adapter: ' + JSON.stringify(adapter));

    if (${JSON.stringify(cpuProfilePath)} !== null) {
      cdp = await page.context().newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
      cpuProfiling = true;
    }

    // Observe warmup only: after recording starts, the first movement frame can
    // already enqueue new chunks and obscure the queue that blocked settling.
    await page.evaluate(() => {
      window.__perfQaWarmupQueues = [];
      let lastSample = -Infinity;
      const observe = now => {
        if (window.__perfQa.recording || window.__perfQa.status === 'done') return;
        if (now - lastSample >= 1000) {
          lastSample = now;
          const surface = window.__editor.stylizedSurface;
          const describe = queue => ({ size: queue?.size ?? 0,
            jobs: (queue?.queue ?? []).slice(0, 3).map(job => ({
              key: String(job.key).slice(0, 1024), chunkX: job.chunkX, chunkZ: job.chunkZ,
              ageMs: now - job.requestedAt,
            })) });
          const views = [surface?.rockView, surface?.treeView, surface?.bushView,
            ...(surface?.detailViews ?? [])].filter(Boolean).map(view => ({
              name: view.layerName ?? view.constructor.name,
              pending: (view.pendingRebuild ?? view.pendingLodRebuild)?.updateKey?.slice(0, 1024),
              staged: view.stagedRebuild?.job.updateKey?.slice(0, 1024),
              last: view.lastUpdateKey?.slice(0, 1024),
              builderDone: view.stagedRebuild?.builder.done,
              pendingMatchesStaged: (view.pendingRebuild ?? view.pendingLodRebuild)?.updateKey
                === view.stagedRebuild?.job.updateKey,
              pendingManifestChunks: [...(view.pendingManifests?.keys() ?? [])].slice(0, 3),
              revision: view.revisionTracker?.revision, prototypes: view.prototypeRevision,
            }));
          window.__perfQaWarmupQueues.push({ now,
            preparation: surface?.getPreparationStatus(),
            position: window.__editor.playerController?.getStatus().position,
            views,
            ...Object.fromEntries(['rock', 'tree', 'bush', 'detail', 'grass', 'flower'].map(name =>
              [name, describe(surface?.[name + 'BuildQueue'])])),
            rockManifests: describe(surface?.rockView?.manifestStore?.queue),
            treeManifests: describe(surface?.treeView?.manifestStore?.queue) });
          if (window.__perfQaWarmupQueues.length > 60) window.__perfQaWarmupQueues.shift();
        }
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    // Wait through bootstrap publication; capture against frozen sources so
    // development reloads cannot silently change the measured runtime.
    await page.waitForFunction(() => window.__perfQa?.recording
      || window.__perfQa?.status === 'done', null, { timeout: ${timeoutMs} });
    const preparationQueuesAtStart = await page.evaluate(() => {
      const surface = window.__editor.stylizedSurface;
      const describe = queue => ({ size: queue?.size ?? 0,
        jobs: (queue?.queue ?? []).slice(0, 3).map(job => ({
          key: String(job.key).slice(0, 2048), chunkX: job.chunkX, chunkZ: job.chunkZ,
          ageMs: performance.now() - job.requestedAt,
        })) });
      return { recording: window.__perfQa.recording,
        ...Object.fromEntries(['rock', 'tree', 'bush', 'detail', 'grass', 'flower'].map(name =>
          [name, describe(surface?.[name + 'BuildQueue'])])),
        rockManifests: describe(surface?.rockView?.manifestStore?.queue),
        treeManifests: describe(surface?.treeView?.manifestStore?.queue) };
    });
    await page.waitForFunction(() => window.__perfQa?.status === 'done', null, {
      timeout: ${timeoutMs},
    });
    const detailVisibilityAtStop = await page.evaluate(() => window.__editor.stylizedSurface.detailViews
      .filter(view => view.visibility).map(view => {
        const visibility = view.visibility;
        const eligible = visibility.instances?.reduce((sum, rows) => sum + rows.length, 0) ?? 0;
        const full = visibility.fullMeshes.some(mesh => mesh.visible);
        return { layer: view.layerName, eligible, full, pending: Boolean(visibility.job),
          submitted: full ? eligible : view.meshes.reduce((sum, parts) => sum + (parts[0]?.count ?? 0), 0) };
      }));
    if (${hasFlag('grass-diagnostics')}) await readGrassDiagnostics(true);
    // Observe recovery before transferring the multi-megabyte frame report.
    // Its protocol serialization otherwise blocks the very work being timed.
    const recovery = ${drainSeconds} > 0 ? await observeRecovery() : null;
    const report = await page.evaluate(() => window.__perfQa.getReport());
    report.detailVisibilityAtStop = detailVisibilityAtStop;
    report.preparationQueuesDuringWarmup = await page.evaluate(() => window.__perfQaWarmupQueues);
    report.preparationQueuesAtStart = preparationQueuesAtStart;
    async function readGrassDiagnostics(hold = false) { return page.evaluate(async hold => {
        if (!hold && Object.hasOwn(window, '__perfGrassAtStop')) return window.__perfGrassAtStop;
        const field = window.__editor.stylizedSurface.meadowGrass;
        if (!field) return null;
        const result = { state: field.getState(), batches: ['blades', 'cards'].flatMap(name => {
          const layer = field[name];
          if (!layer) return [];
          return [...layer.batches.batches].map(([band, batch]) => ({
            layer: name, band, tiles: batch.slots.size,
            capacity: batch.slotCapacity, stride: batch.stride,
            eligibleInstances: batch.meshes?.reduce((sum, mesh) => sum + mesh.geometry.instanceCount, 0)
              ?? batch.geometry.instanceCount,
            retainedBytes: (batch.meshes ?? [{ geometry: batch.geometry }])
              .reduce((sum, mesh) => sum + Object.values(mesh.geometry.attributes)
                .filter(attribute => attribute.isInstancedBufferAttribute)
                .reduce((bytes, attribute) => bytes + attribute.array.byteLength, 0), 0),
          }));
        }), pending: ['blades', 'cards'].flatMap(name => {
          const layer = field[name];
          if (!layer) return [];
          return [...layer.tiles.values()].filter(tile => layer.constructor.isStale(tile)).slice(0, 24).map(tile => ({
            layer: name, key: tile.key, band: tile.band, preparationBand: tile.preparationBand,
            inView: tile.inView,
            builtBand: tile.builtBand, revision: tile.revision, builtRevision: tile.builtRevision,
            preparedCapacity: tile.prepared?.capacity, desiredCapacity: tile.preparationCapacity,
            jobBand: tile.job?.band, jobRevision: tile.job?.revision, progress: tile.job?.compaction.progress,
          }));
        }) };
        if (hold) { window.__perfGrassAtStop = structuredClone(result); return null; }
        return result;
    }, hold); }
    if (${hasFlag('grass-diagnostics')}) report.grass = await readGrassDiagnostics();
    if (cpuProfiling) {
      const { profile } = await cdp.send('Profiler.stop');
      cpuProfiling = false;
      fs.writeFileSync(
        ${JSON.stringify(cpuProfilePath?.replace(/\\/g, '/') ?? null)},
        JSON.stringify(profile),
      );
    }
    // Separate from measured movement: finish() has already released the keys.
    async function observeRecovery() { return page.evaluate(async seconds => {
        const surface = window.__editor.stylizedSurface;
        const observedAt = performance.now();
        const lastMovementFrame = window.__perfQa.getReport()?.samples?.at(-1)?.timestamp;
        // A conservative clock: the retained movement frame precedes key
        // release. Report transfer/diagnostics must not give recovery free time.
        const started = Number.isFinite(lastMovementFrame) ? Math.min(observedAt, lastMovementFrame) : observedAt;
        const start = surface.getPreparationStatus();
        let readyFrames = 0;
        let firstReadyMs = null;
        let grassReadyFrames = 0;
        let grassFirstReadyMs = null;
        const timeline = [];
        let nextSampleMs = 0;
        while (performance.now() - started < seconds * 1000 && readyFrames < 60) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const counters = window.__perfQa.counters();
          const missing = counters.meadowInViewMissingTiles ?? 0;
          const lag = counters.meadowInViewCapacityLagTiles ?? 0;
          if (missing === 0 && lag === 0) {
            grassFirstReadyMs ??= performance.now() - started;
            grassReadyFrames++;
          } else { grassReadyFrames = 0; grassFirstReadyMs = null; }
          const status = surface.getPreparationStatus();
          if (performance.now() - started >= nextSampleMs) {
            timeline.push({ elapsedMs: performance.now() - started, ready: status.ready,
              fields: status.fields, meadow: status.meadow, staged: status.staged,
              queues: Object.fromEntries(Object.entries(status.queues ?? {}).map(([name, queue]) =>
                [name, { depth: queue.depth, completed: queue.completed, advanced: queue.advanced }])),
              deferredMs: counters.frameDeferredCpuMs ?? 0,
              pressureFloorMs: counters.frameDeferredPressureFloorMs ?? 0 });
            nextSampleMs += 250;
          }
          if (status.ready) {
            firstReadyMs ??= performance.now() - started;
            readyFrames++;
          } else { readyFrames = 0; firstReadyMs = null; }
        }
        return { ready: readyFrames >= 60, firstReadyMs, timeline,
          timingOrigin: Number.isFinite(lastMovementFrame) ? 'last-retained-movement-frame' : 'observer-entry',
          observerDelayMs: observedAt - started,
          grass: { ready: grassReadyFrames >= 60, firstReadyMs: grassFirstReadyMs },
          waitedMs: performance.now() - started, start,
          end: surface.getPreparationStatus(), counters: window.__perfQa.counters() };
    }, ${drainSeconds}); }
    if (${drainSeconds} > 0) report.recovery = recovery;
    if (${hasFlag('revisit')}) {
      await page.evaluate(() => window.__perfQa.restart());
      if (${hasFlag('turn-on-revisit')}) {
        await page.waitForFunction(() => window.__perfQa?.recording === true);
        await page.waitForTimeout(${Number(duration) * 500});
        await page.evaluate(() => {
          window.__perfQa.freezeRoute();
          const player = window.__editor.playerController;
          const state = player.getStatus();
          player.setPose({ ...state.position, yaw: state.yaw + Math.PI, pitch: state.pitch });
        });
      }
      await page.waitForFunction(() => window.__perfQa?.status === 'done'
        && window.__perfQa.getReport() !== null);
      if (${hasFlag('grass-diagnostics')}) await readGrassDiagnostics(true);
      const revisitRecovery = ${drainSeconds} > 0 ? await observeRecovery() : null;
      report.revisit = await page.evaluate(() => window.__perfQa.getReport());
      report.revisit.conditions = { sameBrowser: true,
        midpointCameraTurnDegrees: ${hasFlag('turn-on-revisit') ? 180 : 0} };
      if (${hasFlag('grass-diagnostics')}) report.revisit.grass = await readGrassDiagnostics();
      if (${drainSeconds} > 0) report.revisit.recovery = revisitRecovery;
    }
    report.adapter = adapter;
    report.capture = {
      viewport: {
        width: ${viewportWidth},
        height: ${viewportHeight},
        deviceScaleFactor: ${deviceScaleFactor},
      },
      rendererBackend,
      screenshot: ${JSON.stringify(screenshotReportPath)},
      cpuProfile: ${JSON.stringify(cpuProfileReportPath)},
    };
    // On-demand accounting after movement AND recovery; never in frame timing.
    if (${hasFlag('resources')}) report.capture.resourcesAfterRecovery = await page.evaluate(async () => {
      const { trackedWorldResources } = await import('/src/editor/performance/qa/WorldVisualResources.js');
      return trackedWorldResources(window.__editor);
    });
    ${screenshotPath === null ? '' : `await page.screenshot({ path: ${JSON.stringify(screenshotPath.replace(/\\/g, '/'))} });`}
    report.capture.browserErrors = browserErrors.snapshot();
    report.capture.focus = await captureFocus();
    fs.writeFileSync(${JSON.stringify(outPath.replace(/\\/g, '/'))}, JSON.stringify(report, null, 2) + '\\n');
    const { perfPreparationFailures } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/perf-preparation-gates.mjs')).href)});
    for (const failure of perfPreparationFailures(report, ${hasFlag('settle')})) {
      console.error('Perf QA invalid: ' + failure + '; inspect the saved report.');
      process.exitCode = 1;
    }
    if (report.capture.browserErrors.count > 0) {
      console.error('Perf QA invalid: browser errors occurred; inspect capture.browserErrors in the saved report.');
      process.exitCode = 1;
    }
    if (!report.capture.focus.passed) {
      console.error('Perf QA invalid: the headed browser lost foreground focus; inspect capture.focus.');
      process.exitCode = 1;
    }
    console.log(JSON.stringify({
      outPath: ${JSON.stringify(outPath.replace(/\\/g, '/'))},
      screenshotPath: ${JSON.stringify(screenshotPath?.replace(/\\/g, '/') ?? null)},
      cpuProfilePath: ${JSON.stringify(cpuProfilePath?.replace(/\\/g, '/') ?? null)},
      adapter,
      capture: report.capture,
      scenario: report.scenario?.id,
      avgFps: report.summary.avgFps,
      hitchCount: report.summary.hitchCount,
      dt: report.summary.dt,
      counters: report.counters,
      collision: report.collision
        ? {
          enabled: report.collision.enabled,
          p95Ms: report.collision.timingsMs?.total?.p95Ms,
          gatePassed: report.collision.gate?.passed,
          readiness: report.collision.readiness,
        }
        : null,
    }, null, 2));
  } finally {
    if (cpuProfiling) {
      await cdp?.send('Profiler.stop').catch(() => {});
    }
    await browser?.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`,
);

console.log(`Running Perf QA: ${targetUrl}`);

let releaseBrowserLock = () => {};
try {
  releaseBrowserLock = await waitForPerfRunLock(path.join(outDir, `perf-browser-${process.platform}.lock`));
  process.once('exit', releaseBrowserLock);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [runnerPath],
      { cwd: root, stdio: 'inherit', windowsHide: true },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Perf QA runner exited with code ${code}`));
    });
  });
} finally {
  releaseBrowserLock();
  fs.rmSync(runnerPath, { force: true });
}
