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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const spawnX = readArg('x');
const spawnZ = readArg('z');
const yaw = readArg('yaw');
const pitch = readArg('pitch');
const viewportWidth = positiveNumber('viewportWidth', 1280, { integer: true });
const viewportHeight = positiveNumber('viewportHeight', 720, { integer: true });
const deviceScaleFactor = positiveNumber('deviceScaleFactor', 1);
const timeoutMs = positiveNumber(
  'timeoutMs',
  (Number(warmup) + Number(duration) + 90) * 1000,
);
const outPath = path.resolve(readArg('out', path.join(outDir, 'perf-qa-latest.json')));
const screenshotArg = readArg('screenshot');
const screenshotPath = screenshotArg === null ? null : path.resolve(screenshotArg);
const screenshotReportPath = screenshotPath === null
  ? null
  : path.relative(root, screenshotPath).replaceAll('\\', '/');
const runnerPath = path.join(outDir, 'perf-qa-playwright-runner.cjs');

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
setOptionalQuery(query, 'x', spawnX);
setOptionalQuery(query, 'z', spawnZ);
setOptionalQuery(query, 'yaw', yaw);
setOptionalQuery(query, 'pitch', pitch);
const targetUrl = `${baseUrl.replace(/\/$/, '')}/?${query.toString()}`;

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
if (screenshotPath !== null) fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });

fs.writeFileSync(
  runnerPath,
  `
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
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
  await page.goto(${JSON.stringify(targetUrl)}, { waitUntil: 'domcontentloaded' });

  // Refuse to report timings from a software adapter.
  const adapter = await page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: 'navigator.gpu is unavailable' };
    const found = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
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
    || /swiftshader|lavapipe|basic render|microsoft basic|llvmpipe|warp/.test(softwareHint);
  if (isSoftware) {
    console.error('Perf QA aborted: WebGPU is running on a software adapter.');
    console.error(JSON.stringify(adapter, null, 2));
    console.error('Timings from a CPU rasterizer are not comparable to the GPU path.');
    await browser.close();
    process.exit(2);
  }
  console.log('WebGPU adapter: ' + JSON.stringify(adapter));

  await page.waitForFunction(() => window.__perfQa && window.__perfQa.status === 'done', null, {
    timeout: ${timeoutMs},
  });
  const report = await page.evaluate(() => window.__perfQa.getReport());
  report.adapter = adapter;
  report.capture = {
    viewport: {
      width: ${viewportWidth},
      height: ${viewportHeight},
      deviceScaleFactor: ${deviceScaleFactor},
    },
    screenshot: ${JSON.stringify(screenshotReportPath)},
  };
  ${screenshotPath === null ? '' : `await page.screenshot({ path: ${JSON.stringify(screenshotPath.replace(/\\/g, '/'))} });`}
  fs.writeFileSync(${JSON.stringify(outPath.replace(/\\/g, '/'))}, JSON.stringify(report, null, 2) + '\\n');
  console.log(JSON.stringify({
    outPath: ${JSON.stringify(outPath.replace(/\\/g, '/'))},
    screenshotPath: ${JSON.stringify(screenshotPath?.replace(/\\/g, '/') ?? null)},
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
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`,
);

console.log(`Running Perf QA: ${targetUrl}`);

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
