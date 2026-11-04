import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { focusPerfBrowser } from './lib/perf-browser-focus.mjs';
import { waitForPerfRunLock } from './perf-run-lock.mjs';

const args = process.argv.slice(2);
const value = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const url = value('url', 'http://localhost:5173');
const out = path.resolve(value('out', 'tmp/stonehold-aaa/runtime'));
const headed = args.includes('--headed');
fs.mkdirSync(out, { recursive: true });
const releaseBrowserLock = await waitForPerfRunLock(path.resolve(`tmp/perf-browser-${process.platform}.lock`));
process.once('exit', releaseBrowserLock);
const browser = await chromium.launch({ headless: !headed, args: [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist', '--use-angle=default', '--enable-gpu-rasterization',
  '--disable-gpu-vsync', '--disable-frame-rate-limit',
] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${url}/stonehold-qa.html?module=Stonehold_Twin_Outcrop`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stoneholdQa?.ready, null, { timeout: 120000 });
  const adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    return { vendor: adapter.info.vendor, architecture: adapter.info.architecture, fallback: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false };
  });
  assert.equal(adapter.fallback, false, 'requires a hardware WebGPU adapter');
  assert.equal(await page.evaluate(() => {
    try { return window.__stoneholdQa.renderer.domElement.getContext('webgpu') !== null; }
    catch { return false; }
  }), true, 'the review canvas must use WebGPU');
  const focus = await focusPerfBrowser(browser, page, { headed });
  const modules = await page.locator('#module option').evaluateAll(options => options.map(option => option.value));
  const measurements = [];
  for (const name of modules) {
    await page.selectOption('#module', name);
    for (const lod of ['0', '1']) {
      await page.selectOption('#lod', lod);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const current = await page.evaluate(() => window.__stoneholdQa.current);
      assert.ok(current.triangles > 0 && current.triangles <= (lod === '0' ? 48000 : 12000), JSON.stringify(current));
      measurements.push(current);
    }
  }
  await page.selectOption('#module', 'Stonehold_Twin_Outcrop');
  await page.selectOption('#lod', '0');
  for (const light of ['day', 'dusk']) {
    await page.selectOption('#light', light);
    for (const view of ['hero', 'detail']) {
      await page.selectOption('#view', view);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(out, `twin-${light}-${view}.png`) });
    }
  }
  await page.selectOption('#view', 'hero');
  await page.selectOption('#light', 'day');
  // Only headed captures with retained foreground focus are performance evidence.
  await page.evaluate(() => { window.__stoneholdQa.frameTimes = []; window.__stoneholdQa.measuring = true; });
  await page.waitForTimeout(5000);
  const frameTimes = await page.evaluate(() => { window.__stoneholdQa.measuring = false; return window.__stoneholdQa.frameTimes; });
  const retainedFocus = await focus();
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const report = { adapter, measurements, focus: retainedFocus, errors,
    frames: { count: sorted.length, p95: sorted[Math.floor(sorted.length * 0.95)],
      mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, authoritative: headed && retainedFocus.passed } };
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(errors.length, 0, errors.join('\n'));
  if (headed) assert.equal(retainedFocus.passed, true, 'benchmark lost foreground focus');
  console.log(JSON.stringify({ modules: modules.length, lodChecks: measurements.length, ...report.frames, adapter, errors }, null, 2));
} finally {
  await browser.close();
  releaseBrowserLock();
}
