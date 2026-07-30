/**
 * Deterministic tree + bush LOD acceptance.
 *
 * The live world is a poor visual test fixture: vegetation depends on biome,
 * streamed variants, camera angle, and asynchronous manifests. This runner
 * loads the real runtime prototype sets, validates their physical LOD contracts,
 * then rewrites the existing instanced renderers into fixed near/proxy galleries.
 *
 * Prerequisite: the app is already served by Vite.
 *
 * Usage:
 *   npm run qa:vegetation:lod -- --url http://127.0.0.1:5173
 *   npm run qa:vegetation:lod -- --headed
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(name, fallback) {
  const value = Number(readArg(name, String(fallback)));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return value;
}

const baseUrl = readArg('url', 'http://127.0.0.1:5173').replace(/\/$/, '');
const outputDirectory = path.resolve(readArg(
  'out',
  path.join(root, 'tmp', 'vegetation-lod-qa'),
));
const timeoutMs = positiveInteger('timeoutMs', 240_000);
const viewportWidth = positiveInteger('viewportWidth', 1600);
const viewportHeight = positiveInteger('viewportHeight', 950);
const reportPath = path.join(outputDirectory, 'report.json');

fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: !hasFlag('headed'),
  args: [
    '--enable-unsafe-webgpu',
    '--ignore-gpu-blocklist',
    '--use-angle=default',
    '--enable-gpu-rasterization',
  ],
});

let context = null;
const browserErrors = [];
const screenshots = [];

function relativeArtifact(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

async function captureCanvas(page, cdp, name) {
  const canvas = page.locator(
    'canvas[aria-label="Drusniel World infinite world editor viewport"]',
  );
  const clip = await canvas.boundingBox();
  if (!clip || clip.width <= 0 || clip.height <= 0) {
    throw new Error(`Cannot capture ${name}: editor canvas has no visible bounds.`);
  }
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      scale: 1,
    },
  });
  const filePath = path.join(outputDirectory, `${name}.png`);
  const bytes = Buffer.from(result.data, 'base64');
  if (bytes.byteLength < 10_000) {
    throw new Error(`${name} screenshot appears blank (${bytes.byteLength} bytes).`);
  }
  fs.writeFileSync(filePath, bytes);
  screenshots.push(relativeArtifact(filePath));
}

try {
  context = await browser.newContext({
    viewport: { width: viewportWidth, height: viewportHeight },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => browserErrors.push(`page: ${error.message}`));

  await page.goto(`${baseUrl}/?vegetationLodQa=1`, {
    waitUntil: 'domcontentloaded',
    timeout: timeoutMs,
  });
  await page.waitForFunction(
    () => window.__editor?.stylizedSurface?.treeView?.prototypes?.length > 0,
    null,
    { timeout: timeoutMs },
  );
  await page.waitForFunction(
    () => window.__assetStartupTelemetry?.status === 'done'
      && document.querySelector('.loading-overlay')?.hidden === true,
    null,
    { timeout: timeoutMs },
  );

  // Variant residency deliberately loads rocks first. QA needs the bush set as
  // a fixture, not a traversal-order test, so acquire only missing bush assets
  // directly through the same shared loader and apply path used by residency.
  await page.evaluate(async () => {
    const surface = window.__editor.stylizedSurface;
    const residency = surface.variantResidency;
    const layer = residency.layers.find((entry) => entry.id === 'bushes');
    if (!layer) throw new Error('Bush variant residency layer is unavailable.');
    residency.disposed = true;
    const missing = layer.definitions.filter((definition) => {
      const key = definition.id ?? definition.scene;
      return !surface.bushView.prototypeIndicesByAsset.has(key);
    });
    const variants = await Promise.all(missing.map(async (definition) => ({
      definition,
      scene: await layer.acquire(definition.scene),
    })));
    if (variants.length > 0) layer.apply(variants);
    await surface.treeView.impostorReady;
  });

  const report = await page.evaluate(() => {
    const editor = window.__editor;
    const surface = editor.stylizedSurface;
    const treeView = surface.treeView;
    const bushView = surface.bushView;
    const config = editor.config.stylizedSurface;
    const checks = [];

    const check = (id, passed, details = {}) => {
      checks.push({ id, passed: Boolean(passed), ...details });
    };
    const boundsOf = (geometry) => {
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      const size = bounds.getSize(bounds.min.clone());
      const center = bounds.getCenter(bounds.min.clone());
      return {
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
        size: size.toArray(),
        center: center.toArray(),
      };
    };
    const trianglesOf = (geometry) => (
      (geometry.index?.count ?? geometry.attributes.position.count) / 3
    );
    const maximumDelta = (left, right) => Math.max(
      ...left.map((value, index) => Math.abs(value - right[index])),
    );
    const horizontalDiameter = (bounds) => Math.max(bounds.size[0], bounds.size[2]);
    const stressedProxyBounds = (bounds, pivot, kind) => {
      if (!pivot) return bounds;
      const horizontalScale = kind === 'leaf' ? 0.55 : 0.94;
      const mapHorizontal = (value, axis) => (
        (value - pivot[axis]) * horizontalScale + pivot[axis]
      );
      const min = [
        mapHorizontal(bounds.min[0], 0),
        bounds.min[1],
        mapHorizontal(bounds.min[2], 2),
      ];
      const max = [
        mapHorizontal(bounds.max[0], 0),
        bounds.max[1],
        mapHorizontal(bounds.max[2], 2),
      ];
      return {
        min,
        max,
        size: max.map((value, index) => value - min[index]),
        center: max.map((value, index) => (value + min[index]) * 0.5),
      };
    };

    const treePrototypes = treeView.prototypes.map((parts, prototypeIndex) => {
      const sourceParts = parts.map((part) => ({
        kind: part.kind,
        bounds: boundsOf(part.geometry),
        triangles: trianglesOf(part.geometry),
        alphaTest: part.material.alphaTest ?? 0,
        hasOpacityNode: Boolean(part.material.opacityNode),
      }));
      const proxyParts = treeView.proxyPrototypes[prototypeIndex].map((part, partIndex) => {
        const bounds = boundsOf(part.geometry);
        const morphologyPivot = treeView.proxyRenderers[prototypeIndex][partIndex]
          .material.userData.treeMorphologyPivot ?? null;
        return {
          kind: part.kind,
          bounds,
          stressedBounds: stressedProxyBounds(bounds, morphologyPivot, part.kind),
          triangles: trianglesOf(part.geometry),
          morphologyPivot,
          trunkConnectorBounds: part.geometry.userData.trunkConnectorBounds ?? null,
        };
      });
      const crown = proxyParts.find((part) => part.kind === 'leaf');
      const trunk = proxyParts.find((part) => part.kind === 'trunk');
      const verticalOverlap = crown && trunk
        ? Math.min(crown.bounds.max[1], trunk.bounds.max[1])
          - Math.max(crown.bounds.min[1], trunk.bounds.min[1])
        : Number.NEGATIVE_INFINITY;
      const trunkInsideCrown = crown && trunk
        ? trunk.bounds.center[0] >= crown.bounds.min[0]
          && trunk.bounds.center[0] <= crown.bounds.max[0]
          && trunk.bounds.center[2] >= crown.bounds.min[2]
          && trunk.bounds.center[2] <= crown.bounds.max[2]
        : false;
      const diameterRatio = crown && trunk
        ? horizontalDiameter(trunk.bounds) / horizontalDiameter(crown.bounds)
        : Number.POSITIVE_INFINITY;
      const stressedTrunkInsideCrown = crown && trunk
        ? trunk.stressedBounds.center[0] >= crown.stressedBounds.min[0]
          && trunk.stressedBounds.center[0] <= crown.stressedBounds.max[0]
          && trunk.stressedBounds.center[2] >= crown.stressedBounds.min[2]
          && trunk.stressedBounds.center[2] <= crown.stressedBounds.max[2]
        : false;
      check(
        `tree-${prototypeIndex}-source-parts`,
        sourceParts.some((part) => part.kind === 'leaf')
          && sourceParts.some((part) => part.kind === 'trunk'),
        { sourceKinds: sourceParts.map((part) => part.kind) },
      );
      check(
        `tree-${prototypeIndex}-proxy-contact`,
          verticalOverlap > 0
          && trunkInsideCrown
          && stressedTrunkInsideCrown
          && Boolean(crown?.trunkConnectorBounds),
        {
          verticalOverlap,
          trunkInsideCrown,
          stressedTrunkInsideCrown,
          hasTrunkConnector: Boolean(crown?.trunkConnectorBounds),
        },
      );
      check(
        `tree-${prototypeIndex}-proxy-trunk-width`,
        diameterRatio <= 0.16,
        { diameterRatio },
      );
      return {
        prototypeIndex,
        sourceParts,
        proxyParts,
        verticalOverlap,
        trunkInsideCrown,
        stressedTrunkInsideCrown,
        diameterRatio,
      };
    });

    const bushPrototypes = bushView.prototypes.map((prototype, prototypeIndex) => {
      const source = boundsOf(prototype.geometry);
      const proxy = boundsOf(bushView.proxyPrototypes[prototypeIndex].geometry);
      const sourceTriangles = trianglesOf(prototype.geometry);
      const proxyTriangles = trianglesOf(bushView.proxyPrototypes[prototypeIndex].geometry);
      const boundsDelta = Math.max(
        maximumDelta(source.min, proxy.min),
        maximumDelta(source.max, proxy.max),
      );
      check(
        `bush-${prototypeIndex}-proxy-bounds`,
        boundsDelta <= 1e-4,
        { boundsDelta },
      );
      check(
        `bush-${prototypeIndex}-proxy-simplifies`,
        proxyTriangles < sourceTriangles,
        { sourceTriangles, proxyTriangles },
      );
      const proxyKind = bushView.proxyPrototypes[prototypeIndex].geometry.userData.proxyKind;
      check(
        `bush-${prototypeIndex}-proxy-is-volumetric`,
        proxyKind === 'clustered-low-poly-canopy',
        { proxyKind },
      );
      return {
        prototypeIndex,
        source,
        proxy,
        sourceTriangles,
        proxyTriangles,
        proxyKind,
        boundsDelta,
      };
    });

    const bushLod = config.lod.bush;
    check(
      'bush-has-distinct-physical-bands',
      bushLod.meshRadius < bushLod.proxyRadius,
      {
        meshRadius: bushLod.meshRadius,
        proxyRadius: bushLod.proxyRadius,
        forceNearWithinMeshRadius: bushLod.forceNearWithinMeshRadius,
      },
    );
    const treeLod = config.lod.tree;
    check(
      'tree-near-ring-cannot-select-generic-proxy',
      treeLod.forceNearWithinMeshRadius === true
        && treeLod.proxyRadius === treeLod.meshRadius,
      {
        meshRadius: treeLod.meshRadius,
        proxyRadius: treeLod.proxyRadius,
        forceNearWithinMeshRadius: treeLod.forceNearWithinMeshRadius,
      },
    );
    check(
      'tree-impostor-prototype-parity',
      treeView.impostorAtlases.length === treeView.prototypes.length,
      {
        prototypes: treeView.prototypes.length,
        atlases: treeView.impostorAtlases.length,
      },
    );
    check(
      'configured-runtime-prototype-counts',
      treeView.prototypes.length === 18 && bushView.prototypes.length === 5,
      {
        trees: treeView.prototypes.length,
        bushes: bushView.prototypes.length,
      },
    );

    return {
      kind: 'simcity-dnd-vegetation-lod-qa',
      version: 1,
      generatedAt: new Date().toISOString(),
      config: {
        treeLod: config.lod.tree,
        bushLod: config.lod.bush,
      },
      treePrototypes,
      bushPrototypes,
      checks,
    };
  });

  const cdp = await context.newCDPSession(page);

  async function arrangeGallery({
    layer,
    representation,
    firstPrototype,
    prototypeCount,
  }) {
    await page.evaluate((options) => {
      const editor = window.__editor;
      const surface = editor.stylizedSurface;
      const treeView = surface.treeView;
      const bushView = surface.bushView;
      const isTree = options.layer === 'trees';
      const view = isTree ? treeView : bushView;
      const near = isTree ? view.renderers : view.meshes;
      const proxy = isTree ? view.proxyRenderers : view.proxyMeshes;
      const prototypes = isTree ? view.prototypes : view.prototypes.map((part) => [part]);
      const scene = editor.controller.terrainView.scene;

      treeView.disposed = true;
      bushView.enabled = false;
      for (const child of scene.children) {
        child.visible = child === view.root || child.isLight;
      }
      view.root.visible = true;
      // The tree root also owns fallback, cluster, understory, and impostor
      // renderers. Hide every previously active drawable before selecting the
      // one representation under test.
      view.root.traverse((object) => {
        if (!object.isMesh) return;
        object.visible = false;
        if ('count' in object) object.count = 0;
      });
      view.root.position.set(0, 0, 0);
      scene.background = null;
      editor.controller.terrainView.renderer.setClearColor(0x24312a, 1);
      const weatherPanel = document.querySelector('.weather-panel');
      if (weatherPanel) weatherPanel.hidden = true;

      const allGroups = [...near, ...proxy];
      for (const parts of allGroups) {
        for (const mesh of parts) {
          mesh.visible = false;
          mesh.count = 0;
        }
      }

      const active = options.representation === 'near' ? near : proxy;
      const last = Math.min(
        prototypes.length,
        options.firstPrototype + options.prototypeCount,
      );
      const targetHeight = isTree ? 5 : 3;
      const gap = isTree ? 1.4 : 1;
      const position = view.root.position.clone();
      const scale = view.root.scale.clone();
      const quaternion = view.root.quaternion.clone();
      const layouts = [];
      for (let prototypeIndex = options.firstPrototype;
        prototypeIndex < last;
        prototypeIndex += 1) {
        const sourceParts = prototypes[prototypeIndex];
        let minimumX = Number.POSITIVE_INFINITY;
        let maximumX = Number.NEGATIVE_INFINITY;
        let minimumY = Number.POSITIVE_INFINITY;
        let maximumY = Number.NEGATIVE_INFINITY;
        for (const part of sourceParts) {
          part.geometry.computeBoundingBox();
          minimumX = Math.min(minimumX, part.geometry.boundingBox.min.x);
          maximumX = Math.max(maximumX, part.geometry.boundingBox.max.x);
          minimumY = Math.min(minimumY, part.geometry.boundingBox.min.y);
          maximumY = Math.max(maximumY, part.geometry.boundingBox.max.y);
        }
        const normalizedScale = targetHeight / Math.max(0.05, maximumY - minimumY);
        layouts.push({
          prototypeIndex,
          minimumY,
          normalizedScale,
          width: Math.max(0.4, (maximumX - minimumX) * normalizedScale),
        });
      }
      const totalWidth = layouts.reduce((sum, layout) => sum + layout.width, 0)
        + Math.max(0, layouts.length - 1) * gap;
      let cursorX = -totalWidth * 0.5;
      for (const layout of layouts) {
        layout.x = cursorX + layout.width * 0.5;
        cursorX += layout.width + gap;
      }

      for (const layout of layouts) {
        const { prototypeIndex } = layout;
        const parts = active[prototypeIndex];
        const sourceParts = prototypes[prototypeIndex];
        if (!parts || !sourceParts) continue;
        const matrix = view.root.matrixWorld.clone().identity().compose(
          position.set(
            layout.x,
            -layout.minimumY * layout.normalizedScale,
            0,
          ),
          quaternion.identity(),
          scale.setScalar(layout.normalizedScale),
        );
        for (const mesh of parts) {
          mesh.visible = true;
          mesh.count = 1;
          mesh.setMatrixAt(0, matrix);
          mesh.instanceMatrix.needsUpdate = true;
          const dither = mesh.geometry.getAttribute('instanceDither');
          if (dither) {
            dither.setXYZ(0, 1, 0.37 + prototypeIndex * 0.013, 1);
            dither.needsUpdate = true;
          }
          const morphology = mesh.geometry.getAttribute('instanceMorphology');
          if (morphology) {
            const useStressedProxyMorphology = (
              isTree && options.representation === 'proxy'
            );
            morphology.setXYZ(
              0,
              useStressedProxyMorphology ? 0.55 : 1,
              1,
              useStressedProxyMorphology ? 0.94 : 1,
            );
            morphology.needsUpdate = true;
          }
          const tint = mesh.geometry.getAttribute('instanceLeafTint');
          if (tint) {
            tint.setXYZ(0, 1, 1, 1);
            tint.needsUpdate = true;
          }
          // Gallery matrices intentionally replace only the first active
          // instance. Avoid scanning untouched capacity slots for a temporary
          // aggregate bound; fixed QA framing makes culling unnecessary.
          mesh.frustumCulled = false;
        }
      }

      const editorCamera = editor.controller.editorCamera;
      editorCamera.controls.enabled = false;
      editorCamera.camera.position.set(0, isTree ? 3.4 : 2.1, 24);
      editorCamera.camera.zoom = isTree ? 3.1 : 5.2;
      editorCamera.camera.updateProjectionMatrix();
      editorCamera.camera.lookAt(0, isTree ? 2.5 : 1.5, 0);
      editorCamera.camera.updateMatrixWorld(true);
    }, {
      layer,
      representation,
      firstPrototype,
      prototypeCount,
    });
    // Give WebGPU/WebGL one frame to compile a representation that was not
    // active in the world, then another to render it.
    await page.waitForTimeout(2_500);
  }

  await arrangeGallery({
    layer: 'bushes',
    representation: 'near',
    firstPrototype: 0,
    prototypeCount: 5,
  });
  await captureCanvas(page, cdp, 'bush-near');
  await arrangeGallery({
    layer: 'bushes',
    representation: 'proxy',
    firstPrototype: 0,
    prototypeCount: 5,
  });
  await captureCanvas(page, cdp, 'bush-proxy');

  for (const firstPrototype of [0, 9]) {
    const suffix = firstPrototype === 0 ? '00-08' : '09-17';
    await arrangeGallery({
      layer: 'trees',
      representation: 'near',
      firstPrototype,
      prototypeCount: 9,
    });
    await captureCanvas(page, cdp, `tree-near-${suffix}`);
    await arrangeGallery({
      layer: 'trees',
      representation: 'proxy',
      firstPrototype,
      prototypeCount: 9,
    });
    await captureCanvas(page, cdp, `tree-proxy-${suffix}`);
  }

  report.url = baseUrl;
  report.screenshots = screenshots;
  report.browserErrors = browserErrors;
  report.passed = report.checks.every((check) => check.passed)
    && browserErrors.length === 0;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const failed = report.checks.filter((check) => !check.passed);
  console.log(
    `vegetation LOD QA: ${report.checks.length - failed.length}/${report.checks.length} checks`,
  );
  for (const check of failed) {
    console.error(`FAIL ${check.id}: ${JSON.stringify(check)}`);
  }
  for (const error of browserErrors) console.error(error);
  console.log(`wrote ${relativeArtifact(reportPath)}`);
  if (!report.passed) process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  await browser.close();
}
