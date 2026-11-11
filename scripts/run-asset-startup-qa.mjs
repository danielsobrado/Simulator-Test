import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'tmp', 'asset-startup-qa-latest.json');
const screenshotPath = path.join(root, 'tmp', 'asset-startup-qa-latest.png');

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

const baseUrl = readArg('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const runCount = Number(readArg('runs', '2'));
const timeoutMs = Number(readArg('timeoutMs', '180000'));
if (!Number.isInteger(runCount) || runCount < 1 || runCount > 10) {
  throw new Error('--runs must be an integer from 1 to 10.');
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const browser = await chromium.launch({
  headless: !hasFlag('headed'),
  args: [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--use-angle=default',
    '--enable-gpu-rasterization',
  ],
});

const runs = [];
const repeatCache = hasFlag('repeat-cache');
let repeatContext;
try {
  for (let run = 1; run <= runCount; run += 1) {
    const context = repeatContext ?? await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    if (repeatCache) repeatContext = context;
    await context.addInitScript(() => {
      performance.setResourceTimingBufferSize(5000);
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: !repeatCache });

    await page.goto(`${baseUrl}/?assetQa=1&run=${run}`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    const adapter = await page.evaluate(async () => {
      const found = await navigator.gpu?.requestAdapter({
        powerPreference: 'high-performance',
      });
      if (!found) return { ok: false, reason: 'no WebGPU adapter' };
      const info = found.info ?? {};
      return {
        ok: true,
        vendor: info.vendor ?? null,
        architecture: info.architecture ?? null,
        description: info.description ?? null,
        fallback: Boolean(info.isFallbackAdapter ?? found.isFallbackAdapter),
      };
    });
    const softwareHint = [
      adapter.vendor,
      adapter.architecture,
      adapter.description,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!adapter.ok || adapter.fallback
        || /swiftshader|lavapipe|basic render|llvmpipe|warp/.test(softwareHint)) {
      throw new Error(`Asset startup QA requires hardware WebGPU: ${JSON.stringify(adapter)}`);
    }

    await page.waitForFunction(
      () => window.__assetStartupTelemetry?.status === 'done',
      null,
      { timeout: timeoutMs },
    );
    const report = await page.evaluate(async () => {
      const startup = window.__assetStartupTelemetry.getReport();
      const surface = window.__editor?.stylizedSurface;
      if (!surface) throw new Error('Asset startup QA could not inspect the tree atlas state.');
      await surface?.impostorReady;
      const settings = surface?.config?.lod?.impostor;
      const trees = surface?.treeView;
      startup.treeImpostors = {
        required: Boolean(surface?.config?.trees?.enabled && settings?.enabled
          && settings.manifest && settings.runtimeBake === false),
        expected: trees?.prototypes?.length ?? 0,
        loaded: trees?.impostorAtlases?.length ?? 0,
        fromAssets: trees?.impostorAtlases?.filter((atlas) => atlas.source === 'asset').length ?? 0,
        sourceSignature: trees?.prototypeSignature ?? null,
      };
      const resources = performance.getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.endsWith('.glb'));
      const startTimes = resources.map((entry) => entry.startTime);
      const responseEnds = resources.map((entry) => entry.responseEnd);
      startup.network = {
        glbRequests: resources.length,
        durationMs: resources.length === 0
          ? 0
          : Math.max(...responseEnds) - Math.min(...startTimes),
        transferBytes: resources.reduce(
          (sum, entry) => sum + (entry.transferSize ?? 0),
          0,
        ),
        encodedBodyBytes: resources.reduce(
          (sum, entry) => sum + (entry.encodedBodySize ?? 0),
          0,
        ),
        decodedBodyBytes: resources.reduce(
          (sum, entry) => sum + (entry.decodedBodySize ?? 0),
          0,
        ),
      };
      return startup;
    });
    if (run === runCount) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    runs.push({ run, adapter, cachePolicy: repeatCache
      ? (run === 1 ? 'fresh-context-cache-enabled' : 'repeat-context-cache-enabled')
      : 'fresh-context-cache-disabled', ...report });
    if (errors.length > 0) {
      throw new Error(`Browser errors during asset startup:\n${errors.join('\n')}`);
    }
    if (report.failedAssets > 0 || report.ktx2.failedTranscodes > 0) {
      throw new Error(`Asset startup failures: ${JSON.stringify(report)}`);
    }
    const impostors = report.treeImpostors;
    if (impostors.required && (impostors.expected === 0
        || impostors.fromAssets !== impostors.expected
        || impostors.loaded !== impostors.expected)) {
      throw new Error(`Pre-baked tree impostors were not loaded: ${JSON.stringify(impostors)}`);
    }
    if (report.meshopt.decodeCount === 0 || report.ktx2.transcodeCount === 0
        || report.ktx2.gpuTextureBytes === 0) {
      throw new Error('Asset startup telemetry did not observe Meshopt and KTX2 work.');
    }
    console.log(
      `asset startup ${run}/${runCount}: assets ${report.navigationToAssetsReadyMs} ms, `
      + `first frame ${report.navigationToFirstFrameMs} ms, `
      + `KTX2 ${(report.ktx2.gpuTextureBytes / 1024 / 1024).toFixed(2)} MiB GPU`,
    );
    if (repeatCache) await page.close();
    else await context.close();
  }
} catch (error) {
  fs.writeFileSync(outputPath, `${JSON.stringify({ version: 1, kind: 'simcity-dnd-asset-startup-qa-suite', generatedAt: new Date().toISOString(), url: baseUrl, runs, failure: error.stack }, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}

const result = {
  version: 1,
  kind: 'simcity-dnd-asset-startup-qa-suite',
  generatedAt: new Date().toISOString(),
  url: baseUrl,
  runs,
  summary: {
    runs: runs.length,
    navigationToAssetsReadyMedianMs: median(
      runs.map((run) => run.navigationToAssetsReadyMs),
    ),
    navigationToFirstFrameMedianMs: median(
      runs.map((run) => run.navigationToFirstFrameMs),
    ),
    meshoptSummedTaskMedianMs: median(
      runs.map((run) => run.meshopt.summedTaskMs),
    ),
    ktx2SummedTaskMedianMs: median(
      runs.map((run) => run.ktx2.summedTaskMs),
    ),
    gpuTextureBytes: runs.at(-1).ktx2.gpuTextureBytes,
    rgba8TextureBytes: runs.at(-1).ktx2.rgba8TextureBytes,
    residencyReductionRatio: runs.at(-1).ktx2.residencyReductionRatio,
    formats: runs.at(-1).ktx2.formats,
  },
  screenshot: screenshotPath.replaceAll('\\', '/'),
};
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`wrote ${outputPath}`);
