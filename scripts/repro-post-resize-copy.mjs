/**
 * Reproduce WebGPU CopyTextureToTexture size mismatch on resize + water refraction.
 * Requires: npm run dev --url (default http://127.0.0.1:5173)
 */
import { chromium } from 'playwright';
import {
  applyPostProcessingPreset,
} from '../src/render/postprocessing/PostProcessingPresets.js';
import {
  DEFAULT_POST_PROCESSING_SETTINGS,
  postProcessingSettingsToPlain,
} from '../src/render/postprocessing/PostProcessingSettings.js';

const baseUrl = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://127.0.0.1:5173';
const headed = process.argv.includes('--headed');
const deviceScaleFactor = Number(
  process.argv.includes('--dpr')
    ? process.argv[process.argv.indexOf('--dpr') + 1]
    : '1.5',
);
const iterations = Number(
  process.argv.includes('--iterations')
    ? process.argv[process.argv.indexOf('--iterations') + 1]
    : '60',
);

function isCopySizeError(text) {
  return /CopyTextureToTexture|touches outside of|Texture copy range/i.test(text);
}

async function main() {
  const browser = await chromium.launch({
    headless: !headed,
    args: [
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--use-angle=default',
      '--enable-gpu-rasterization',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1056, height: 629 },
    deviceScaleFactor,
  });

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (isCopySizeError(text) || /GPUValidationError/i.test(text)) {
      errors.push(text.slice(0, 500));
    }
  });
  page.on('pageerror', (error) => {
    errors.push(String(error?.message ?? error).slice(0, 500));
  });

  const query = new URLSearchParams({
    qa: 'post-processing-capture',
    ppCapture: 'river-close',
    density: 'standard',
    x: '180',
    z: '-40',
    yaw: '90',
    pitch: '-12',
    autostart: '0',
    download: '0',
  });
  await page.goto(`${baseUrl}/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => Boolean(
      window.__editor?.terrainView
      && (
        window.__editor?.sceneSettingsRuntime?.postProcessing
        || window.__editor?.postProcessingStore
      )
    ),
    null,
    { timeout: 120000 },
  );

  const balanced = postProcessingSettingsToPlain(
    applyPostProcessingPreset('balanced', DEFAULT_POST_PROCESSING_SETTINGS),
  );
  await page.evaluate((settings) => {
    const store = window.__editor.sceneSettingsRuntime?.postProcessing
      ?? window.__editor.postProcessingStore;
    store.reset(settings);
    // Keep volumetric god rays from stealing the render path.
    window.__editor.terrainView?.godRays?.setSettings?.({
      enabled: false,
    });
  }, balanced);

  await page.waitForFunction(() => {
    const controller = window.__editor?.terrainView?.postProcessing;
    return Boolean(controller?.graph?.scenePass && controller?.settings?.enabled);
  }, null, { timeout: 90000 }).catch(() => {});

  // Extra frames for streaming/water residency near the river spawn.
  await page.evaluate(async () => {
    for (let i = 0; i < 90; i += 1) await new Promise(requestAnimationFrame);
  });

  const ready = await page.evaluate(() => {
    const view = window.__editor.terrainView;
    const controller = view?.postProcessing;
    const counters = window.__editor?.getPerfCounters?.()
      ?? window.__perfQa?.getCounters?.()
      ?? null;
    return {
      graph: Boolean(controller?.graph?.scenePass),
      enabled: controller?.settings?.enabled === true,
      taaWidth: controller?.history?.taaWidth ?? 0,
      taaHeight: controller?.history?.taaHeight ?? 0,
      refractive: counters?.waterChunksRefractive ?? null,
      wet: counters?.waterChunksWet ?? null,
      backend: view?.rendererBackendStatus ?? null,
      pixelRatio: view?.renderer?.getPixelRatio?.() ?? null,
    };
  });

  const heights = [629, 630, 628, 631, 627, 632, 629, 630];
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const height = heights[i % heights.length];
    const width = 1056 + (i % 3); // also nudge width for floor(w*1.5) churn
    await page.setViewportSize({ width, height });
    // Let ResizeObserver + animation frames run; do not call resize manually.
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i += 1) await new Promise(requestAnimationFrame);
    });
    if (i % 5 === 0) {
      samples.push(await page.evaluate(() => {
        const view = window.__editor.terrainView;
        const controller = view.postProcessing;
        const scenePass = controller?.graph?.scenePass;
        const resources = controller?.resources;
        const drawing = view.renderer.getDrawingBufferSize({
          x: 0,
          y: 0,
          set(x, y) { this.x = x; this.y = y; return this; },
          floor() {
            this.x = Math.floor(this.x);
            this.y = Math.floor(this.y);
            return this;
          },
        });
        return {
          canvas: {
            width: view.renderer.domElement.width,
            height: view.renderer.domElement.height,
          },
          drawing: { width: drawing.x, height: drawing.y },
          resourcesScaled: resources
            ? {
              width: Math.floor(resources.width * resources.pixelRatio),
              height: Math.floor(resources.height * resources.pixelRatio),
            }
            : null,
          scenePass: scenePass
            ? {
              width: scenePass.renderTarget?.width,
              height: scenePass.renderTarget?.height,
            }
            : null,
          history: {
            taaWidth: controller?.history?.taaWidth ?? 0,
            taaHeight: controller?.history?.taaHeight ?? 0,
          },
          css: {
            width: resources?.width ?? null,
            height: resources?.height ?? null,
            clientWidth: view.renderer.domElement.clientWidth,
            clientHeight: view.renderer.domElement.clientHeight,
          },
        };
      }));
    }
  }

  const copyErrors = errors.filter(isCopySizeError);
  const mismatchSamples = samples.filter((sample) => {
    const canvas = sample.canvas;
    const scene = sample.scenePass;
    const hist = sample.history;
    if (!canvas || !scene) return true;
    return scene.height !== canvas.height
      || (hist.taaHeight > 0 && hist.taaHeight !== canvas.height)
      || (sample.resourcesScaled && sample.resourcesScaled.height !== canvas.height);
  });

  console.log(JSON.stringify({
    deviceScaleFactor,
    iterations,
    ready,
    errorCount: errors.length,
    copyErrorCount: copyErrors.length,
    mismatchSampleCount: mismatchSamples.length,
    firstCopyError: copyErrors[0] ?? null,
    firstMismatch: mismatchSamples[0] ?? null,
    lastSample: samples.at(-1) ?? null,
    uniqueCanvasHeights: [...new Set(samples.map((s) => s.canvas.height))],
  }, null, 2));

  await browser.close();
  process.exit(copyErrors.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
