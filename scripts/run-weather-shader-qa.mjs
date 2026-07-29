import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { terminateChildProcess } from './lib/processLifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'tmp', 'weather-shader-qa');
const modes = Object.freeze(['meadow', 'rain', 'snow', 'sandstorm', 'storm', 'wind']);
const shaderErrorPattern = /weather|shader|wgsl|webgpu|gpu validation|pipeline|bind.?group|texture/i;

function readArgument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const headed = process.argv.includes('--headed');
const timeoutMs = Number(readArgument('timeoutMs', '180000'));
const settleMs = Number(readArgument('settleMs', '1200'));
const requestedPort = process.argv.includes('--port') ? Number(readArgument('port', '4178')) : 0;

async function reservePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address();
      const selected = typeof address === 'object' ? address.port : preferredPort;
      server.close((error) => (error ? reject(error) : resolve(selected)));
    });
  });
}

function startServer(port) {
  return spawn(
    process.execPath,
    [
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
}

async function waitForServer(server, baseUrl) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Weather QA Vite server exited with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message ?? 'unknown error'}`);
}

async function setWeatherMode(page, mode) {
  await page.evaluate((nextMode) => {
    const select = document.querySelector('[data-weather="mode"]');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('Weather mode selector is unavailable.');
    }
    select.value = nextMode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, mode);
  await page.waitForFunction(
    (expected) => document.querySelector('[data-weather="mode"]')?.value === expected,
    mode,
    { timeout: 10000 },
  );
}

async function captureViewport(page, mode) {
  try {
    const canvas = await page.locator('canvas').first().boundingBox({ timeout: 10000 });
    if (!canvas || canvas.width < 1 || canvas.height < 1) return null;
    const buffer = await page.screenshot({
      path: path.join(outputDirectory, `${mode}.png`),
      clip: canvas,
      timeout: 30000,
    });
    return createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    console.warn(`Skipped ${mode} screenshot: ${error.message}`);
    return null;
  }
}

async function run() {
  await mkdir(outputDirectory, { recursive: true });
  const port = await reservePort(requestedPort);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const server = startServer(port);
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  const report = {
    baseUrl,
    startedAt: new Date().toISOString(),
    headed,
    modes: [],
    errors: [],
  };
  let browser;

  try {
    await waitForServer(server, baseUrl);
    browser = await chromium.launch({
      headless: !headed,
      channel: 'chromium',
      args: [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--use-angle=default',
        '--enable-gpu-rasterization',
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
    });

    await page.goto(baseUrl, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForSelector('[data-weather="mode"]', { timeout: timeoutMs });
    await page.waitForSelector('canvas', { timeout: timeoutMs });
    const hasWebGpu = await page.evaluate(() => Boolean(navigator.gpu));
    assert.equal(hasWebGpu, true, 'Chromium did not expose WebGPU.');

    const baselineErrorCount = runtimeErrors.length;
    for (const mode of modes) {
      const startedAt = performance.now();
      const errorStart = runtimeErrors.length;
      await setWeatherMode(page, mode);
      await delay(settleMs);
      const modeErrors = runtimeErrors.slice(errorStart);
      const shaderErrors = modeErrors.filter((message) => shaderErrorPattern.test(message));
      const screenshotHash = await captureViewport(page, mode);
      report.modes.push({
        mode,
        activationMs: performance.now() - startedAt,
        screenshotHash,
        errors: modeErrors,
      });
      assert.deepEqual(shaderErrors, [], `${mode} produced shader/runtime errors:\n${shaderErrors.join('\n')}`);
    }

    report.errors = runtimeErrors.slice(baselineErrorCount);
    await setWeatherMode(page, 'off');
  } finally {
    await browser?.close();
    await terminateChildProcess(server);
    await writeFile(path.join(outputDirectory, 'vite.log'), serverOutput);
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
