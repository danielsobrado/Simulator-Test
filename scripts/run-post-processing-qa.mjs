/**
 * Headless runner for post-processing baseline captures.
 *
 * Prerequisites: app already serving (`npm run dev`) and Playwright Chromium installed.
 *
 * Usage:
 *   npm run qa:postprocessing
 *   npm run qa:postprocessing -- --headed
 *   npm run qa:postprocessing -- --only forest-close,route
 *   npm run qa:postprocessing -- --outDir tmp/post-processing-qa/baseline
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  POST_PROCESSING_CAPTURE_LOCATIONS,
  POST_PROCESSING_MEASURE_FRAMES,
  POST_PROCESSING_WARMUP_FRAMES,
} from '../src/editor/performance/qa/PostProcessingQaCaptures.js';

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

function positiveNumber(name, fallback, { integer = false } = {}) {
  const value = Number(readArg(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`--${name} must be a positive ${integer ? 'safe integer' : 'number'}.`);
  }
  return value;
}

async function waitForServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // still starting
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

async function inspectAdapter(page) {
  return page.evaluate(async () => {
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
}

function openPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer[1] !== 0x50) {
    throw new Error(`Screenshot is not a PNG: ${filePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 16 || height < 16) {
    throw new Error(`Screenshot too small (${width}x${height}): ${filePath}`);
  }
  return { width, height, bytes: buffer.length };
}

const baseUrl = readArg('url', 'http://localhost:5173').replace(/\/$/, '');
const outDir = path.resolve(
  readArg('outDir', path.join(root, 'tmp', 'post-processing-qa', 'baseline')),
);
const viewportWidth = positiveNumber('viewportWidth', 1280, { integer: true });
const viewportHeight = positiveNumber('viewportHeight', 720, { integer: true });
const deviceScaleFactor = positiveNumber('deviceScaleFactor', 1);
const warmupFrames = positiveNumber('warmupFrames', POST_PROCESSING_WARMUP_FRAMES, {
  integer: true,
});
const measureFrames = positiveNumber('measureFrames', POST_PROCESSING_MEASURE_FRAMES, {
  integer: true,
});
const timeoutMs = positiveNumber(
  'timeoutMs',
  Math.max(180_000, (warmupFrames + measureFrames) * 80 + 120_000),
);
const onlyArg = readArg('only');
const only = onlyArg
  ? new Set(onlyArg.split(',').map((value) => value.trim()).filter(Boolean))
  : null;
const headed = hasFlag('headed');
const allowSoftware = hasFlag('allow-software');

const captures = POST_PROCESSING_CAPTURE_LOCATIONS.filter(
  (entry) => !only || only.has(entry.id),
);
const includeRoute = !only || only.has('route');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'screenshots'), { recursive: true });

async function runCapture(page, {
  id,
  qa,
  captureId = null,
  density = 'standard',
  spawn = { x: 0, z: 0 },
  yawDegrees = 0,
  pitchDegrees = 0,
  weather = null,
  night = false,
  spell = false,
}) {
  const query = new URLSearchParams({
    qa,
    density,
    x: String(spawn.x),
    z: String(spawn.z),
    yaw: String(yawDegrees),
    pitch: String(pitchDegrees),
    warmupFrames: String(warmupFrames),
    measureFrames: String(measureFrames),
    hitchMs: '33.3',
    download: '0',
    autostart: '0',
  });
  if (captureId) query.set('ppCapture', captureId);
  if (weather) query.set('weather', weather);
  if (night) query.set('night', '1');
  if (spell) query.set('spell', '1');

  const targetUrl = `${baseUrl}/?${query.toString()}`;
  console.log(`Capturing ${id}: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__perfQa != null && window.__editor != null, null, {
    timeout: timeoutMs,
  });

  await page.evaluate((mode) => {
    window.__editor?.applyPostProcessingCaptureMode?.(mode);
  }, { weather, night, spell });

  await page.evaluate(() => {
    window.__perfQa.restart();
  });

  await page.waitForFunction(() => window.__perfQa?.status === 'done', null, {
    timeout: timeoutMs,
  });

  const report = await page.evaluate(() => window.__perfQa.getReport());
  const adapter = await inspectAdapter(page);
  report.adapter = adapter;
  report.capture = {
    id,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
  };

  const jsonPath = path.join(outDir, `${id}.json`);
  const screenshotPath = path.join(outDir, 'screenshots', `${id}.png`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await page.screenshot({ path: screenshotPath, type: 'png' });
  const png = openPng(screenshotPath);

  return {
    id,
    jsonPath: path.relative(root, jsonPath).replaceAll('\\', '/'),
    screenshotPath: path.relative(root, screenshotPath).replaceAll('\\', '/'),
    png,
    summary: report.summary,
    cpuUpdate: report.cpuUpdate,
    gpuRender: report.gpuRender,
    postProcessingCapture: report.postProcessingCapture,
    adapter,
  };
}

async function main() {
  await waitForServer(baseUrl);

  const browser = await chromium.launch({
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

  const results = [];
  try {
    const page = await browser.newPage({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor,
    });
    page.setDefaultTimeout(timeoutMs);

    await page.goto(`${baseUrl}/?qa=post-processing-capture&autostart=0&download=0`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__perfQa != null, null, { timeout: timeoutMs });

    const adapter = await inspectAdapter(page);
    if (isSoftwareAdapter(adapter) && !allowSoftware) {
      console.error('Post-processing QA aborted: WebGPU is software or unidentified.');
      console.error(JSON.stringify(adapter, null, 2));
      process.exitCode = 2;
      return;
    }
    console.log(`WebGPU adapter: ${JSON.stringify(adapter)}`);

    for (const location of captures) {
      const result = await runCapture(page, {
        id: location.id,
        qa: 'post-processing-capture',
        captureId: location.id,
        density: location.density,
        spawn: location.spawn,
        yawDegrees: location.yawDegrees,
        pitchDegrees: location.pitchDegrees,
        weather: location.weather ?? null,
        night: Boolean(location.night),
        spell: Boolean(location.spell),
      });
      results.push(result);
      console.log(JSON.stringify({
        id: result.id,
        avgFps: result.summary?.avgFps,
        dtP95: result.summary?.dt?.p95Ms,
        screenshot: result.screenshotPath,
        png: result.png,
      }));
    }

    if (includeRoute) {
      const result = await runCapture(page, {
        id: 'route',
        qa: 'post-processing-route',
        density: 'standard',
        spawn: { x: 0, z: 0 },
        yawDegrees: 0,
        pitchDegrees: -6,
      });
      results.push(result);
      console.log(JSON.stringify({
        id: result.id,
        avgFps: result.summary?.avgFps,
        dtP95: result.summary?.dt?.p95Ms,
        originSnaps: result.summary?.originSnapCount,
        screenshot: result.screenshotPath,
        png: result.png,
      }));
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    kind: 'simcity-dnd-post-processing-baseline',
    version: 1,
    generatedAt: new Date().toISOString(),
    outDir: path.relative(root, outDir).replaceAll('\\', '/'),
    warmupFrames,
    measureFrames,
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor },
    results: results.map((entry) => ({
      id: entry.id,
      jsonPath: entry.jsonPath,
      screenshotPath: entry.screenshotPath,
      png: entry.png,
      avgFps: entry.summary?.avgFps ?? null,
      frame: entry.summary?.dt ?? null,
      cpuUpdate: entry.cpuUpdate ?? null,
      gpuRender: entry.gpuRender ?? null,
      capture: entry.postProcessingCapture ?? null,
    })),
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const failed = results.filter((entry) => !entry.png?.width);
  if (failed.length > 0) {
    throw new Error(`Baseline screenshots failed: ${failed.map((entry) => entry.id).join(', ')}`);
  }
  if (results.length === 0) {
    throw new Error('No post-processing baseline captures were produced.');
  }

  console.log(JSON.stringify({
    manifestPath: path.relative(root, manifestPath).replaceAll('\\', '/'),
    captures: results.length,
    ids: results.map((entry) => entry.id),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
