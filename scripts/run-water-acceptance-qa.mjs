#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { WaterAcceptanceTracker } from '../src/editor/performance/qa/WaterAcceptance.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'tmp');
const OUT_PATH = join(OUT_DIR, 'water-acceptance-latest.json');
const DEFAULT_URL = 'http://127.0.0.1:5173';
const SAMPLE_INTERVAL_MS = 100;

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function startServer(baseUrl) {
  const parsed = new URL(baseUrl);
  const child = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'run',
      'dev',
      '--',
      '--host',
      parsed.hostname,
      '--port',
      parsed.port || '5173',
      '--strictPort',
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  return child;
}

async function inspectAdapter(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu is unavailable' };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: 'no WebGPU adapter' };
    const info = adapter.info ?? {};
    return {
      ok: true,
      vendor: info.vendor ?? null,
      architecture: info.architecture ?? null,
      description: info.description ?? null,
      fallback: Boolean(adapter.isFallbackAdapter),
    };
  });
}

function isSoftwareAdapter(adapter) {
  const description = [adapter.vendor, adapter.architecture, adapter.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return !adapter.ok
    || adapter.fallback
    || /swiftshader|lavapipe|basic render|microsoft basic|llvmpipe|warp/.test(description);
}

async function discoverRoute(page) {
  await page.waitForFunction(() => window.__editor?.stylizedSurface?.terrainView?.getCanonicalWater);
  return page.evaluate(async () => {
    const { findWaterAcceptanceRoute } = await import(
      '/src/editor/performance/qa/WaterAcceptance.js'
    );
    const editor = window.__editor;
    const terrain = editor.stylizedSurface.terrainView;
    const worldStore = terrain.worldStore;
    const tileSize = worldStore.tileSize;
    const waterCache = new Map();
    const groundCache = new Map();
    const key = (x, z) => `${x.toFixed(3)}:${z.toFixed(3)}`;
    const getWaterSample = (x, z) => {
      const sampleKey = key(x, z);
      if (!waterCache.has(sampleKey)) {
        waterCache.set(sampleKey, terrain.getCanonicalWater(x, z));
      }
      return waterCache.get(sampleKey);
    };
    const getGroundHeight = (x, z) => {
      const sampleKey = key(x, z);
      if (!groundCache.has(sampleKey)) {
        groundCache.set(sampleKey, worldStore.sampleHeight(x / tileSize, -z / tileSize));
      }
      return groundCache.get(sampleKey);
    };
    const searchProfiles = [
      {},
      {
        searchRadius: 384,
        sampleStep: 6,
        maximumDryDistance: 120,
        minimumDepth: 4,
      },
      {
        searchRadius: 1024,
        sampleStep: 12,
        maximumDryDistance: 200,
        minimumDepth: 4,
        routeSampleStep: 2,
      },
      {
        searchRadius: 1024,
        sampleStep: 12,
        maximumDryDistance: 120,
        minimumDepth: 2,
        routeSampleStep: 2,
      },
    ];
    let route = null;
    let routeSearch = null;
    for (const options of searchProfiles) {
      route = findWaterAcceptanceRoute({
        getWaterSample,
        getGroundHeight,
        ...options,
      });
      if (route) {
        routeSearch = options;
        break;
      }
    }
    return {
      route,
      routeSearch,
      discoverySamples: {
        water: waterCache.size,
        ground: groundCache.size,
      },
      qualityTier: editor.config.stylizedSurface?.water?.qualityTier ?? 'high',
      eyeHeight: editor.config.player?.eyeHeight ?? 1.7,
      walkSpeed: editor.config.player?.walkSpeed ?? 4,
      swimSpeed: editor.config.player?.water?.swimSpeed ?? 3,
      swimDepth: editor.config.player?.water?.swimDepth ?? 1.35,
    };
  });
}

async function readPlayerSample(page, phaseId, previousOrigin) {
  const sample = await page.evaluate(() => {
    const editor = window.__editor;
    const terrain = editor.stylizedSurface.terrainView;
    const focus = editor.controller.focusProvider();
    const camera = editor.controller.cameraProvider();
    const water = terrain.getCanonicalWater(focus.x, focus.z);
    const eyeHeight = editor.config.player?.eyeHeight ?? 1.7;
    const swimDepth = editor.config.player?.water?.swimDepth ?? 1.35;
    const footY = camera.position.y - eyeHeight;
    const immersion = water.coverage > 0.05
      ? Math.max(0, water.surfaceHeight - footY)
      : 0;
    const headSubmerged = water.coverage > 0.05 && camera.position.y < water.surfaceHeight;
    const waterState = immersion <= 0.01
      ? 'dry'
      : headSubmerged
        ? 'submerged'
        : immersion >= swimDepth
          ? 'swimming'
          : 'wading';
    const streaming = terrain.getStreamingStatus();
    return {
      player: {
        x: focus.x,
        y: camera.position.y,
        z: focus.z,
        waterState,
        waterDepth: immersion,
        waterBodyId: water.bodyId ?? null,
        waterKind: water.kind ?? 0,
        headSubmerged,
        underwaterBlend: headSubmerged ? 1 : 0,
      },
      counters: window.__perfQa?.counters?.() ?? {},
      origin: streaming.origin ?? null,
    };
  });
  const originSnap = Boolean(
    previousOrigin
      && sample.origin
      && (sample.origin.x !== previousOrigin.x || sample.origin.z !== previousOrigin.z)
  );
  return { ...sample, phaseId, originSnap };
}

async function samplePhase({ page, tracker, phaseId, durationSeconds, previousOrigin }) {
  const deadline = performance.now() + durationSeconds * 1000;
  let origin = previousOrigin;
  while (performance.now() < deadline) {
    const sample = await readPlayerSample(page, phaseId, origin);
    tracker.observe(sample);
    origin = sample.origin;
    await page.waitForTimeout(SAMPLE_INTERVAL_MS);
  }
  return origin;
}

async function sampleUntilTarget({
  page,
  tracker,
  phaseId,
  target,
  maximumSeconds,
  previousOrigin,
}) {
  const startedAt = performance.now();
  const deadline = startedAt + maximumSeconds * 1000;
  let origin = previousOrigin;
  let closestDistance = Number.POSITIVE_INFINITY;
  while (performance.now() < deadline) {
    const sample = await readPlayerSample(page, phaseId, origin);
    tracker.observe(sample);
    origin = sample.origin;
    const distance = Math.hypot(
      sample.player.x - target.x,
      sample.player.z - target.z,
    );
    closestDistance = Math.min(closestDistance, distance);
    if (distance <= 0.75) {
      return {
        origin,
        reached: true,
        closestDistance,
        elapsedSeconds: (performance.now() - startedAt) / 1000,
      };
    }
    await page.waitForTimeout(50);
  }
  return {
    origin,
    reached: false,
    closestDistance,
    elapsedSeconds: (performance.now() - startedAt) / 1000,
  };
}

async function setKeys(page, { down = [], up = [] }) {
  await page.evaluate(({ downCodes, upCodes }) => {
    const active = new Set(window.__waterQaKeys ?? []);
    for (const code of upCodes) active.delete(code);
    for (const code of downCodes) active.add(code);
    window.__waterQaKeys = [...active];
    if (!window.__perfQa?.setKeys?.(window.__waterQaKeys)) {
      throw new Error('Performance QA harness is not accepting external water-phase keys.');
    }
  }, { downCodes: down, upCodes: up });
}

function collectGpuValidationErrors(page) {
  const counts = new Map();
  const record = (text) => {
    const message = text.replace(/\s+/g, ' ').trim().slice(0, 240);
    counts.set(message, (counts.get(message) ?? 0) + 1);
  };
  page.on('console', (message) => {
    const text = message.text();
    if (/GPUValidationError|GPUOutOfMemoryError|Uncaptured WebGPU/i.test(text)) record(text);
  });
  return counts;
}

async function main() {
  const baseUrl = readArg('url', DEFAULT_URL).replace(/\/$/, '');
  const useExistingServer = hasFlag('existing-server') || process.argv.includes('--url');
  const allowSoftware = hasFlag('allow-software');
  const headed = hasFlag('headed');
  const server = useExistingServer ? null : startServer(baseUrl);
  let browser = null;

  try {
    await waitForServer(baseUrl);
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
    const page = await browser.newPage();
    page.setDefaultTimeout(120_000);
    // Water is the only material that samples the viewport colour and depth
    // textures, so this is the run where a mis-sized framebuffer copy shows up.
    // A validation error discards the whole command buffer for that frame, which
    // no frame-time metric would ever report as a failure.
    const gpuErrors = collectGpuValidationErrors(page);

    await page.goto(`${baseUrl}/?qa=water-acceptance&autostart=0&download=0`, {
      waitUntil: 'domcontentloaded',
    });
    const adapter = await inspectAdapter(page);
    const softwareAdapter = isSoftwareAdapter(adapter);
    if (softwareAdapter && !allowSoftware) {
      throw new Error(`Hardware WebGPU adapter required: ${JSON.stringify(adapter)}`);
    }

    const discovery = await discoverRoute(page);
    if (!discovery.route) {
      throw new Error(
        `No deterministic dry-to-deep shoreline route was found: ${
          JSON.stringify(discovery.discoverySamples)
        }`,
      );
    }

    const enterSeconds = clamp(
      discovery.route.distance / Math.max(
        0.5,
        Math.min(discovery.walkSpeed, discovery.swimSpeed),
      ) + 2,
      2,
      30,
    );
    const diveSeconds = 4;
    const surfaceSeconds = 4;
    const exitSeconds = enterSeconds + 3;
    const settleSeconds = 2;
    const measuredSeconds = enterSeconds + diveSeconds + surfaceSeconds + exitSeconds + settleSeconds;
    const warmupSeconds = 4;
    const query = new URLSearchParams({
      qa: 'water-acceptance',
      x: String(discovery.route.start.x),
      z: String(discovery.route.start.z),
      yaw: String(discovery.route.yawDegrees),
      warmup: String(warmupSeconds),
      duration: String(measuredSeconds),
      speed: 'walk',
      hitchMs: '33.3',
      autostart: '1',
      download: '0',
    });
    await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(({ x, z }) => {
      const focus = window.__editor?.controller?.focusProvider?.();
      return focus && Math.hypot(focus.x - x, focus.z - z) < 2;
    }, discovery.route.start);
    await page.waitForTimeout((warmupSeconds + 0.5) * 1000);

    const tracker = new WaterAcceptanceTracker({
      route: discovery.route,
      qualityTier: discovery.qualityTier,
    });
    let origin = null;

    await setKeys(page, { down: ['KeyW'] });
    const entry = await sampleUntilTarget({
      page,
      tracker,
      phaseId: 'enter-water',
      target: discovery.route.target,
      maximumSeconds: enterSeconds,
      previousOrigin: origin,
    });
    origin = entry.origin;

    await setKeys(page, { up: ['KeyW'], down: ['ControlLeft'] });
    origin = await samplePhase({
      page,
      tracker,
      phaseId: 'dive',
      durationSeconds: diveSeconds,
      previousOrigin: origin,
    });

    await setKeys(page, { up: ['KeyW', 'ControlLeft'], down: ['Space'] });
    origin = await samplePhase({
      page,
      tracker,
      phaseId: 'surface',
      durationSeconds: surfaceSeconds,
      previousOrigin: origin,
    });

    await setKeys(page, { up: ['Space'], down: ['KeyS'] });
    origin = await samplePhase({
      page,
      tracker,
      phaseId: 'exit-water',
      durationSeconds: exitSeconds,
      previousOrigin: origin,
    });

    await setKeys(page, { up: ['KeyS'] });
    await samplePhase({
      page,
      tracker,
      phaseId: 'settle',
      durationSeconds: settleSeconds,
      previousOrigin: origin,
    });

    await page.waitForFunction(() => window.__perfQa?.status === 'done');
    const perfReport = await page.evaluate(() => window.__perfQa.getReport());
    const authoritativePerformance = !softwareAdapter;
    const thresholds = {
      maximumFrameP95Ms: authoritativePerformance ? 33.3 : Number.POSITIVE_INFINITY,
      maximumHitchRate: authoritativePerformance ? 0.02 : 1,
      maximumProjectedCausticCpuMs: authoritativePerformance ? 4 : Number.POSITIVE_INFINITY,
    };
    const acceptance = tracker.buildResult({
      summary: perfReport.summary,
      thresholds,
    });
    const gpuValidationErrors = [...gpuErrors.entries()]
      .map(([message, count]) => ({ count, message }))
      .sort((left, right) => right.count - left.count);
    const gpuValidationErrorCount = gpuValidationErrors
      .reduce((total, entry) => total + entry.count, 0);
    const report = {
      ...perfReport,
      adapter,
      performanceAuthoritative: authoritativePerformance,
      waterAcceptance: acceptance,
      gpuValidationErrorCount,
      gpuValidationErrors,
      phases: {
        enterSeconds: entry.elapsedSeconds,
        entryReachedTarget: entry.reached,
        entryClosestDistance: entry.closestDistance,
        diveSeconds,
        surfaceSeconds,
        exitSeconds,
        settleSeconds,
      },
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
      outPath: OUT_PATH,
      adapter,
      performanceAuthoritative: authoritativePerformance,
      pass: acceptance.pass && gpuValidationErrorCount === 0,
      gates: acceptance.gates,
      metrics: acceptance.metrics,
      frameP95Ms: perfReport.summary.dt.p95Ms,
      hitchRate: perfReport.summary.hitchRate,
      gpuValidationErrorCount,
      gpuValidationErrors: gpuValidationErrors.slice(0, 4),
    }, null, 2));

    if (!acceptance.pass || gpuValidationErrorCount > 0) process.exitCode = 1;
  } finally {
    await browser?.close();
    if (server) {
      server.kill('SIGTERM');
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(resolvePromise, 2_000);
        server.once('exit', () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
