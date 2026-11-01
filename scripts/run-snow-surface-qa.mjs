import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { waitForPerfRunLock } from './perf-run-lock.mjs';
import { createBrowserErrorMonitor } from './lib/perf-browser-errors.mjs';
import { compareRenderedImages } from './lib/rendered-image-metrics.mjs';

const option = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? fallback : process.argv[index + 1];
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(option('--out', path.join(root, 'tmp/snow-surface-qa')));
await mkdir(output, { recursive: true });
const release = await waitForPerfRunLock(path.join(root, 'tmp', `perf-browser-${process.platform}.lock`));
const report = { passed: false, checks: [] };
let browser;
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = createBrowserErrorMonitor(page);
  await page.goto(new URL('/scripts/fixtures/snow-surface.html', option('--url', 'http://localhost:5173')).href);
  await page.waitForFunction(() => window.__snowSurfaceFixture?.ready || window.__snowSurfaceFixture?.failure,
    null, { timeout: 90000 });
  const fixture = await page.evaluate(() => ({ webgpu: window.__snowSurfaceFixture.webgpu, failure: window.__snowSurfaceFixture.failure }));
  assert.equal(fixture.failure, undefined); assert.equal(fixture.webgpu, true);
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter({ featureLevel: 'compatibility', powerPreference: 'high-performance' });
    return { vendor: adapter?.info.vendor, architecture: adapter?.info.architecture, description: adapter?.info.description,
      fallback: Boolean(adapter?.info.isFallbackAdapter ?? adapter?.isFallbackAdapter) };
  });
  assert.ok(report.adapter.vendor || report.adapter.architecture || report.adapter.description);
  assert.equal(report.adapter.fallback, false);
  assert.doesNotMatch(Object.values(report.adapter).join(' '), /swiftshader|lavapipe|llvmpipe|warp|basic render/i);
  const images = new Map();
  for (const kind of ['open', 'worked', 'packed', 'snowless', 'snowless-packed', 'snowless-worked',
    'negative', 'rebased', 'detail', 'detail-adjacent-chunk', 'night', 'baked', 'baked-pending',
    'biome', 'biome-snowfall', 'biome-snowfall-moving', 'biome-particles', 'biome-night', 'biome-night-snowfall',
    'powder-kick', 'powder-kick-settled']) {
    await page.evaluate(kind => window.__snowSurfaceFixture.capture(kind), kind);
    const png = await page.locator('canvas').screenshot(); await writeFile(path.join(output, `${kind}.png`), png);
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    images.set(kind, { data, width: info.width, height: info.height, channels: info.channels });
  }
  const compare = (id, left, right, changed = false, minimumChange = 0.2) => {
    const result = compareRenderedImages(images.get(left), images.get(right), { maximumMeanColorError: changed ? 255 : 0.05,
      minimumBrightnessRatio: 0, maximumBrightnessRatio: 100 });
    const passed = changed ? result.meanColorError > minimumChange : result.passed;
    report.checks.push({ id, passed, meanColorError: result.meanColorError }); assert.equal(passed, true, id);
  };
  compare('sheltered powder visibly differs from worked snow', 'open', 'worked', true);
  compare('compaction visibly changes snow', 'open', 'packed', true);
  compare('compaction leaves snowless ground alone', 'snowless', 'snowless-packed');
  compare('powder leaves snowless ground alone', 'snowless', 'snowless-worked');
  compare('origin rebase preserves the snow surface', 'open', 'rebased');
  compare('adjacent chunk coordinates preserve detail', 'detail', 'detail-adjacent-chunk');
  compare('authored snowy alpine trees are visible', 'open', 'biome', true);
  // White flakes over clean snow: a smaller mean change than over the old mottled ground.
  compare('falling snow is visible against the snowy biome', 'biome', 'biome-snowfall', true, 0.15);
  compare('falling flakes move over time', 'biome-snowfall', 'biome-snowfall-moving', true);
  // Fine ice grains occupy very few pixels; verify local contrast rather than
  // requiring them to change a broad area of the entire image like a snow puff.
  compare('diamond dust and ground spindrift are visible', 'biome', 'biome-particles', true, 0.005);
  let grains = 0, groundGrains = 0, peak = 0;
  const plain = images.get('biome').data, particles = images.get('biome-particles').data;
  for (let i = 0; i < plain.length; i += 3) {
    const contrast = Math.max(...[0, 1, 2].map(channel => Math.abs(plain[i + channel] - particles[i + channel])));
    peak = Math.max(peak, contrast);
    if (contrast > 5) { grains++; if (i / 3 >= 1280 * 360) groundGrains++; }
  }
  assert.ok(grains > 100 && groundGrains > 25 && peak > 25, 'Ice grains need visible air and ground contrast.');
  report.checks.push({ id: 'ice grains retain visible local contrast', passed: true, grains, groundGrains, peak });
  const daySnow = compareRenderedImages(images.get('biome'), images.get('biome-snowfall')).meanColorError;
  const nightSnow = compareRenderedImages(images.get('biome-night'), images.get('biome-night-snowfall')).meanColorError;
  assert.ok(nightSnow < daySnow * 0.35, 'Night flakes must follow the darkened sky lighting.');
  report.checks.push({ id: 'night snowfall follows sky light', passed: true, daySnow, nightSnow });
  compare('footfall powder rises and settles', 'powder-kick', 'powder-kick-settled', true);
  const luminance = name => images.get(name).data.reduce((sum, value) => sum + value, 0) / images.get(name).data.length;
  assert.ok(luminance('night') < luminance('open') * 0.65, 'Snow stays dark without direct light.');
  report.checks.push({ id: 'snow stays dark without direct light', passed: true });
  for (const kind of ['baked', 'baked-pending']) {
    assert.ok(luminance(kind) > luminance('open') * 0.85, `${kind}: baked normal must remain finite across material passes.`);
    report.checks.push({ id: `${kind} normal stays finite in color, roughness and lighting`, passed: true });
  }
  report.browserErrors = errors.snapshot(); assert.equal(report.browserErrors.count, 0);
  report.passed = true;
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); release();
  await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
