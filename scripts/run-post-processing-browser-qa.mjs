#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'tmp', 'post-processing-qa');
const BASE_URL = 'http://127.0.0.1:5173';
const PRESETS = Object.freeze(['off', 'low', 'balanced', 'high', 'ultra']);
const ERROR_PATTERN = /wgsl|shader|pipeline|bind.?group|webgpu|gpu validation|uncaptured/i;

function startServer() {
  return spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}.`);
}

async function applyScenario(page, scenario) {
  await page.evaluate(({ preset, patch }) => {
    const controller = window.__editor?.stylizedSurface?.terrainView?.godRays?.postProcessing;
    if (!controller) throw new Error('Post-processing controller is unavailable.');
    controller.applyPreset(preset);
    if (patch) controller.setSettings(patch);
    controller.invalidate(`qa:${preset}`);
  }, scenario);
  await page.waitForTimeout(1_000);
  return page.evaluate(() => {
    const terrain = window.__editor.stylizedSurface.terrainView;
    const controller = terrain.godRays.postProcessing;
    return {
      settings: controller.getSettings(),
      failed: controller.failed,
      lastInvalidationReason: controller.lastInvalidationReason ?? null,
      backend: terrain.getRendererBackendStatus(),
    };
  });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = startServer();
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: !process.argv.includes('--headed'),
      args: ['--enable-unsafe-webgpu', '--use-angle=vulkan'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const messages = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || ERROR_PATTERN.test(message.text())) {
        messages.push({ type: `console:${message.type()}`, text: message.text() });
      }
    });
    page.on('pageerror', (error) => messages.push({ type: 'pageerror', text: error.stack ?? error.message }));
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (
      window.__editor?.stylizedSurface?.terrainView?.godRays?.postProcessing
      && document.querySelector('[data-post-processing-panel]')
    ), null, { timeout: 60_000 });

    const scenarios = PRESETS.map((preset) => ({ id: preset, preset }));
    scenarios.push(
      { id: 'balanced-ssr', preset: 'balanced', patch: { ssr: { enabled: true } } },
      { id: 'balanced-dof', preset: 'balanced', patch: { depthOfField: { enabled: true } } },
      { id: 'balanced-vignette', preset: 'balanced', patch: { vignette: { enabled: true } } },
      { id: 'balanced-grain', preset: 'balanced', patch: { grain: { enabled: true } } },
    );

    const results = [];
    for (const scenario of scenarios) {
      const state = await applyScenario(page, scenario);
      const screenshot = join(OUT_DIR, `${scenario.id}.png`);
      await page.screenshot({ path: screenshot });
      results.push({ id: scenario.id, screenshot, ...state });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      url: BASE_URL,
      results,
      messages,
      passed: results.every((result) => !result.failed) && messages.length === 0,
    };
    writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed) process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
