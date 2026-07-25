/**
 * Deterministic browser QA for the procedural object workshop.
 *
 * The runner starts its own strict-port Vite server, drives the real workshop
 * DOM and pointer handlers in Chromium, and writes screenshots plus a machine
 * readable report to tmp/workshop-qa.
 *
 * Usage:
 *   npm run qa:workshop
 *   npm run qa:workshop -- --headed
 *   npm run qa:workshop -- --port 4174
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { terminateChildProcess } from './lib/processLifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'tmp', 'workshop-qa');

function readArgument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const timeoutMs = Number(readArgument('timeoutMs', '120000'));
const requestedPort = process.argv.includes('--port')
  ? Number(readArgument('port', '4174'))
  : null;
const runCount = Number(readArgument('runs', '3'));
let port = 0;
let baseUrl = '';

async function preflightPort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      reject(new Error(`Workshop QA port ${preferredPort} is unavailable: ${error.message}`));
    });
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' ? address.port : preferredPort;
      server.close((error) => {
        if (error) reject(error);
        else resolve(selectedPort);
      });
    });
  });
}

function startServer() {
  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [viteEntry, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
}

async function buildProductionBundle() {
  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = spawn(process.execPath, [viteEntry, 'build'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  build.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  build.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    build.once('error', reject);
    build.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Workshop QA production build failed:\n${output}`);
  return output;
}

async function waitForServer(server) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Workshop QA Vite server exited with code ${server.exitCode}.`);
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

function attachmentEntries(document) {
  return Object.entries(document ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

async function workshopState(page) {
  return page.evaluate(() => {
    const workshop = window.__editor?.proceduralWorkshop;
    const controller = workshop?.componentController;
    const input = workshop?.readInput();
    return {
      archetype: input?.recipe?.archetype ?? null,
      attachments: input?.recipe?.openingAttachments ?? {},
      componentIds: controller ? [...controller.groups.keys()].sort() : [],
      selectedComponentId: controller?.selectedComponentId ?? null,
      selectedParentId: controller?.selectedGroup()?.parent?.userData?.workshopComponent?.id ?? null,
      attachmentMode: controller?.attachmentMode ?? false,
      attachmentPreview: controller?.attachmentPreview
        ? {
          valid: controller.attachmentPreview.valid,
          componentId: controller.attachmentPreview.componentId,
          attachment: controller.attachmentPreview.attachment,
        }
        : null,
      placementHelperVisible: controller?.placementHelper?.visible ?? false,
      placementHelperColor: controller?.placementHelper?.material?.color?.getHexString?.() ?? null,
      material: workshop?.materialController
        ? {
          active: workshop.materialController.active,
          hoverRegionId: workshop.materialController.hoverRegionId,
          selectedRegionId: workshop.materialController.selectedRegionId,
          paletteOpen: !workshop.materialController.palette.hidden,
          inspectorOpen: !workshop.materialController.inspector.hidden,
          overrides: input?.recipe?.materialAreaOverrides ?? {},
          favorites: input?.recipe?.materialFavorites ?? [],
          sources: input?.recipe?.materialLibrary?.sources ?? {},
        }
        : null,
      status: workshop?.status?.textContent ?? '',
      statusIsError: workshop?.status?.classList?.contains('is-error') ?? true,
      canvas: workshop?.renderer?.domElement
        ? {
          width: workshop.renderer.domElement.width,
          height: workshop.renderer.domElement.height,
          clientWidth: workshop.renderer.domElement.clientWidth,
          clientHeight: workshop.renderer.domElement.clientHeight,
        }
        : null,
    };
  });
}

async function waitForFinalPreview(page, archetype) {
  await page.waitForFunction((expectedArchetype) => {
    const workshop = window.__editor?.proceduralWorkshop;
    const controller = workshop?.componentController;
    return workshop?.form?.elements?.archetype?.value === expectedArchetype
      && controller?.groups?.size > 0
      && workshop?.status?.textContent?.startsWith('Final preview')
      && !workshop.status.classList.contains('is-error');
  }, archetype, { timeout: timeoutMs });
}

async function setArchetype(page, archetype) {
  await page.locator('select[name="archetype"]').selectOption(archetype);
  await waitForFinalPreview(page, archetype);
  await page.evaluate(() => {
    window.__editor.proceduralWorkshop.framePreview();
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  )));
  const coverage = await visibleHostCoverage(page);
  assert.ok(
    coverage >= 0.08,
    `Framing failure: ${archetype} visible host coverage ${coverage.toFixed(3)} is below 0.08.`,
  );
}

async function setQaCamera(page, position, target = [0, 3, 0]) {
  await page.evaluate(({ nextPosition, nextTarget }) => {
    const workshop = window.__editor.proceduralWorkshop;
    const bounds = new window.__THREE_QA__.Box3().setFromObject(workshop.previewRoot);
    const center = bounds.getCenter(new window.__THREE_QA__.Vector3());
    const size = bounds.getSize(new window.__THREE_QA__.Vector3());
    const direction = new window.__THREE_QA__.Vector3(...nextPosition)
      .sub(new window.__THREE_QA__.Vector3(...nextTarget))
      .normalize();
    const distance = Math.max(size.x, size.y, size.z) * 2.65;
    workshop.camera.position.copy(center).addScaledVector(direction, Math.max(7, distance));
    workshop.controls.target.copy(center);
    workshop.camera.updateProjectionMatrix();
    workshop.controls.update();
  }, { nextPosition: position, nextTarget: target });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  )));
  const coverage = await visibleHostCoverage(page);
  assert.ok(coverage >= 0.08, `Framing failure: visible host coverage is ${coverage.toFixed(3)}.`);
}

async function visibleHostCoverage(page) {
  return page.evaluate(() => {
    const workshop = window.__editor.proceduralWorkshop;
    const controller = workshop.componentController;
    const canvas = workshop.renderer.domElement;
    const points = [];
    for (const mesh of controller.meshes) {
      const group = controller.groups.get(mesh.userData.workshopComponentId);
      if (group?.userData?.workshopComponent?.kind !== 'structure') continue;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            points.push(new window.__THREE_QA__.Vector3(x, y, z)
              .applyMatrix4(mesh.matrixWorld)
              .project(workshop.camera));
          }
        }
      }
    }
    if (points.length === 0 || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return 0;
    const minX = Math.max(-1, Math.min(...points.map(({ x }) => x)));
    const maxX = Math.min(1, Math.max(...points.map(({ x }) => x)));
    const minY = Math.max(-1, Math.min(...points.map(({ y }) => y)));
    const maxY = Math.min(1, Math.max(...points.map(({ y }) => y)));
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY) / 4;
  });
}

async function clickDom(page, selector) {
  await page.locator(selector).evaluate((element) => {
    if (element.disabled) {
      throw new Error(`Cannot click disabled QA control: ${element.textContent?.trim() ?? element.tagName}`);
    }
    element.click();
  });
}

async function selectOpening(page, { kind = null, id = null } = {}) {
  const componentId = await page.evaluate(({ requestedKind, requestedId }) => {
    const controller = window.__editor.proceduralWorkshop.componentController;
    if (requestedId && controller.groups.has(requestedId)) return requestedId;
    for (const [candidateId, group] of controller.groups) {
      const candidateKind = group.userData?.workshopComponent?.kind;
      if (
        (requestedKind ? candidateKind === requestedKind : ['door', 'window', 'arch'].includes(candidateKind))
      ) {
        return candidateId;
      }
    }
    return null;
  }, { requestedKind: kind, requestedId: id });
  assert.ok(componentId, `Expected an editable ${kind ?? 'architectural opening'}.`);
  await page.locator('[data-role="workshop-component-select"]').selectOption(componentId);
  await page.waitForFunction((expectedId) => (
    window.__editor.proceduralWorkshop.componentController.selectedComponentId === expectedId
  ), componentId);
  return componentId;
}

async function waitForAttachmentCount(page, expectedCount) {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  let state = null;
  while (Date.now() < deadline) {
    state = await workshopState(page);
    if (
      Object.keys(state.attachments).length === expectedCount
      && state.status.startsWith('Final preview')
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `Expected ${expectedCount} opening attachments; observed ${JSON.stringify(state)}.`,
  );
}

async function waitForAttachmentHost(page, componentId, hostId) {
  const deadline = Date.now() + Math.min(timeoutMs, 15_000);
  let state = null;
  while (Date.now() < deadline) {
    state = await workshopState(page);
    if (
      state.attachments[componentId]?.hostId === hostId
      && state.selectedParentId === hostId
      && state.status.startsWith('Final preview')
    ) {
      return;
    }
    await delay(50);
  }
  throw new Error(
    `Expected ${componentId} on ${hostId}; observed ${JSON.stringify(state)}.`,
  );
}

function candidateRatios() {
  const candidates = [];
  const horizontal = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.05, 0.95];
  const vertical = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.125, 0.875];
  for (const y of vertical) {
    for (const x of horizontal) {
      candidates.push({ x, y });
    }
  }
  return candidates;
}

async function findPlacementPoint(page, predicate, description) {
  const canvas = page.locator('[data-role="workshop-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds?.width > 0 && bounds?.height > 0, 'Workshop render canvas must have visible bounds.');
  for (const candidate of candidateRatios()) {
    const point = {
      x: bounds.x + bounds.width * candidate.x,
      y: bounds.y + bounds.height * candidate.y,
    };
    await page.mouse.move(point.x, point.y);
    await delay(18);
    const preview = await page.evaluate(() => {
      const controller = window.__editor.proceduralWorkshop.componentController;
      return controller.attachmentPreview
        ? {
          valid: controller.attachmentPreview.valid,
          attachment: controller.attachmentPreview.attachment,
          visible: controller.placementHelper.visible,
          color: controller.placementHelper.material.color.getHexString(),
        }
        : null;
    });
    if (predicate(preview)) return { point, preview };
  }
  throw new Error(`Could not find ${description} by scanning the visible workshop surfaces.`);
}

async function beginPlacement(page) {
  await clickDom(page, '[data-component-action="attach"]');
  await page.waitForFunction(() => (
    window.__editor.proceduralWorkshop.componentController.attachmentMode
  ));
}

async function captureCheckpoint(page, report, name) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  )));
  const screenshotPath = path.join(outputDirectory, `${report.run}-${name}.png`);
  const buffer = await page.locator('[data-role="workshop-overlay"]').screenshot({
    path: screenshotPath,
    animations: 'disabled',
    timeout: 30_000,
  });
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${name} must be a PNG screenshot.`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.ok(width >= 1200 && height >= 700, `${name} screenshot is unexpectedly small.`);
  assert.ok(buffer.byteLength >= 25_000, `${name} screenshot appears blank or corrupt.`);
  const state = await workshopState(page);
  assert.ok(state.canvas?.width > 0 && state.canvas?.height > 0, 'WebGPU canvas has no backing pixels.');
  assert.ok(
    state.canvas?.clientWidth > 0 && state.canvas?.clientHeight > 0,
    'WebGPU canvas has no visible dimensions.',
  );
  assert.equal(state.statusIsError, false, `Workshop reported an error: ${state.status}`);
  report.checkpoints.push({
    name,
    screenshot: path.relative(root, screenshotPath).replaceAll('\\', '/'),
    bytes: buffer.byteLength,
    width,
    height,
    state,
  });
}

async function runPlanarScenario(page, report) {
  console.log('Workshop QA · planar · generating square keep');
  await setArchetype(page, 'square-tower');
  await setQaCamera(page, [0, 6.5, 19]);
  const sourceId = await selectOpening(page, { kind: 'window' });

  console.log('Workshop QA · planar · scanning and committing pointer placement');
  await beginPlacement(page);
  const placement = await findPlacementPoint(
    page,
    (preview) => preview?.visible
      && preview.valid
      && preview.attachment.hostId === 'structure-main',
    'a valid planar wall placement',
  );
  assert.equal(placement.preview.color, '7de0cf', 'Valid planar placement ghost should be green.');
  await page.mouse.click(placement.point.x, placement.point.y);
  await waitForAttachmentHost(page, sourceId, 'structure-main');
  await captureCheckpoint(page, report, '01-planar-attached');

  console.log('Workshop QA · planar · duplicate');
  await clickDom(page, '[data-component-action="duplicate"]');
  await waitForAttachmentCount(page, 2);
  const afterDuplicate = await workshopState(page);
  const duplicatedId = afterDuplicate.selectedComponentId;
  assert.ok(duplicatedId?.startsWith('copy-'), 'Duplicate should select its generated copy.');

  console.log('Workshop QA · planar · repeat row');
  await clickDom(page, '[data-component-action="repeat"]');
  await waitForAttachmentCount(page, 4);
  await captureCheckpoint(page, report, '02-planar-repeat');

  console.log('Workshop QA · planar · undo, redo, delete, and restore');
  await clickDom(page, '[data-component-action="undo"]');
  await waitForAttachmentCount(page, 2);
  await clickDom(page, '[data-component-action="redo"]');
  await waitForAttachmentCount(page, 4);

  const beforeDelete = await workshopState(page);
  const selectedCopy = Object.keys(beforeDelete.attachments)
    .filter((componentId) => componentId.startsWith('copy-'))
    .sort()
    .at(-1);
  assert.ok(selectedCopy, 'Repeat should create a generated copy that can be selected.');
  await selectOpening(page, { id: selectedCopy });
  await clickDom(page, '[data-component-action="delete-opening"]');
  await waitForAttachmentCount(page, 3);
  await clickDom(page, '[data-component-action="undo"]');
  await waitForAttachmentCount(page, 4);

  console.log('Workshop QA · planar · regenerate and bake persistence');
  const beforeRegenerate = await workshopState(page);
  await clickDom(page, '[data-workshop-action="preview"]');
  await waitForFinalPreview(page, 'square-tower');
  const afterRegenerate = await workshopState(page);
  assert.deepEqual(
    attachmentEntries(afterRegenerate.attachments),
    attachmentEntries(beforeRegenerate.attachments),
    'Opening attachments must survive explicit regeneration.',
  );

  await page.locator('input[name="label"]').fill('Automated Workshop QA Wall');
  await page.locator('[data-role="workshop-form"]').evaluate((form) => form.requestSubmit());
  await page.waitForFunction(() => (
    window.__editor.proceduralWorkshop.manager.store.list()
      .some((record) => record.label === 'Automated Workshop QA Wall')
  ));
  const bakedAttachments = await page.evaluate(() => (
    window.__editor.proceduralWorkshop.manager.store.list()
      .find((record) => record.label === 'Automated Workshop QA Wall')
      ?.recipe?.openingAttachments
  ));
  assert.deepEqual(
    attachmentEntries(bakedAttachments),
    attachmentEntries(beforeRegenerate.attachments),
    'Baked asset must preserve the canonical wall-attachment document.',
  );

  report.assertions.push(
    'planar pointer placement committed to structure-main',
    'duplicate and repeat created deterministic copies',
    'undo, redo, and delete-copy restored the expected attachment counts',
    'explicit regeneration and bake preserved attachment documents',
  );
}

async function runRadialScenario(page, report) {
  console.log('Workshop QA · radial · generating gatehouse');
  await setArchetype(page, 'gatehouse');
  await setQaCamera(page, [0, 7.5, 22]);
  const sourceId = await selectOpening(page, { id: 'window-1' });
  console.log('Workshop QA · radial · scanning and committing tower placement');
  await beginPlacement(page);
  const placement = await findPlacementPoint(
    page,
    (preview) => preview?.visible
      && preview.valid
      && ['structure-left', 'structure-right'].includes(preview.attachment.hostId),
    'a valid radial tower placement',
  );
  const radialHostId = placement.preview.attachment.hostId;
  assert.equal(placement.preview.color, '7de0cf', 'Valid radial placement ghost should be green.');
  await page.mouse.click(placement.point.x, placement.point.y);
  await waitForAttachmentHost(page, sourceId, radialHostId);

  const radialAttachment = (await workshopState(page)).attachments[sourceId];
  assert.equal(radialAttachment.hostId, radialHostId);
  assert.ok(
    Number.isFinite(radialAttachment.position[0]),
    'Pointer placement on a round tower should resolve a finite surface coordinate.',
  );
  await captureCheckpoint(page, report, '03-radial-attached');

  console.log('Workshop QA · radial · duplicate on tower');
  await clickDom(page, '[data-component-action="duplicate"]');
  await waitForAttachmentCount(page, 2);
  const duplicated = await workshopState(page);
  const copyId = duplicated.selectedComponentId;
  assert.ok(copyId?.startsWith('copy-'), 'Radial duplicate should select a generated copy.');
  assert.equal(
    duplicated.attachments[copyId]?.hostId,
    radialHostId,
    'Radial duplicate must keep the round tower host.',
  );

  console.log('Workshop QA · radial · projecting rejected collision placement');
  await beginPlacement(page);
  await page.keyboard.down('Shift');
  await page.evaluate((openingId) => {
    const controller = window.__editor.proceduralWorkshop.componentController;
    const opening = controller.groups.get(openingId);
    const host = opening.parent;
    const component = opening.userData.workshopComponent;
    const surface = host.userData.workshopComponent.attachmentSurface;
    const angle = component.attachmentPosition[0] / surface.radius;
    const localPoint = opening.position.clone().set(
      Math.sin(angle) * surface.radius,
      component.attachmentPosition[1] + component.attachmentSize[1] / 2,
      Math.cos(angle) * surface.radius,
    );
    const hostMesh = controller.meshes.find((mesh) => (
      mesh.userData.workshopComponentId === host.userData.workshopComponent.id
    ));
    controller.updateAttachmentPreview({
      object: hostMesh,
      point: host.localToWorld(localPoint),
      face: null,
    });
  }, sourceId);
  await delay(50);
  const rejected = await workshopState(page);
  assert.equal(rejected.attachmentPreview?.valid, false, 'Overlapping radial socket must be rejected.');
  assert.equal(
    rejected.attachmentPreview?.attachment?.hostId,
    radialHostId,
    'Rejected collision must be evaluated against the same radial host.',
  );
  assert.equal(rejected.placementHelperColor, 'ef6f68', 'Rejected placement ghost should be red.');
  await captureCheckpoint(page, report, '04-radial-collision-rejected');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => (
    !window.__editor.proceduralWorkshop.componentController.attachmentMode
  ));

  console.log('Workshop QA · radial · regenerate persistence');
  const beforeRegenerate = await workshopState(page);
  await clickDom(page, '[data-workshop-action="preview"]');
  await waitForFinalPreview(page, 'gatehouse');
  const afterRegenerate = await workshopState(page);
  assert.deepEqual(
    attachmentEntries(afterRegenerate.attachments),
    attachmentEntries(beforeRegenerate.attachments),
    'Round-host attachments must survive regeneration.',
  );
  assert.equal(
    afterRegenerate.selectedParentId,
    radialHostId,
    'Regenerated radial copy must remain parented to its tower.',
  );
  await captureCheckpoint(page, report, '05-radial-regenerated');

  report.assertions.push(
    'window pointer placement committed to a radial tower surface',
    'radial duplicate retained its tower host',
    'collision/edge rejection rendered a red ghost without committing',
    'radial host ownership survived regeneration',
  );
}

async function findMaterialPoint(page) {
  const canvas = page.locator('[data-role="workshop-canvas"] canvas');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds?.width > 0 && bounds?.height > 0, 'Material QA canvas must be visible.');
  for (const candidate of candidateRatios()) {
    const point = {
      x: bounds.x + bounds.width * candidate.x,
      y: bounds.y + bounds.height * candidate.y,
    };
    await page.mouse.move(point.x, point.y);
    await delay(18);
    const state = await workshopState(page);
    if (state.material?.hoverRegionId) return { point, regionId: state.material.hoverRegionId };
  }
  throw new Error('Pointer hit-testing failure: no semantic material region was found.');
}

async function runMaterialScenario(page, report) {
  console.log('Workshop QA · materials · semantic hover and radial palette');
  await setArchetype(page, 'manor');
  await setQaCamera(page, [12, 9, 18], [0, 3, 0]);
  await clickDom(page, '[data-workshop-action="material"]');
  await page.waitForFunction(() => (
    window.__editor.proceduralWorkshop.materialController.active
  ));
  const target = await findMaterialPoint(page);
  const before = await workshopState(page);
  await page.mouse.click(target.point.x, target.point.y);
  await page.waitForFunction(() => (
    !window.__editor.proceduralWorkshop.materialController.palette.hidden
  ));
  const paletteBounds = await page.locator('[data-role="material-palette"]').boundingBox();
  const canvasBounds = await page.locator('[data-role="workshop-canvas"]').boundingBox();
  assert.ok(paletteBounds && canvasBounds, 'Radial palette and canvas must have visible bounds.');
  assert.ok(
    paletteBounds.x >= canvasBounds.x
      && paletteBounds.y >= canvasBounds.y
      && paletteBounds.x + paletteBounds.width <= canvasBounds.x + canvasBounds.width
      && paletteBounds.y + paletteBounds.height <= canvasBounds.y + canvasBounds.height,
    'Radial palette positioning failure: palette clipped outside the viewport.',
  );
  await captureCheckpoint(page, report, '06-material-radial-palette');

  const firstPreset = page.locator('[data-role="material-palette"] [data-preset-id]').first();
  await firstPreset.hover();
  await delay(40);
  const afterHover = await workshopState(page);
  assert.deepEqual(
    afterHover.material.overrides,
    before.material.overrides,
    'Hover preview must not mutate the recipe.',
  );
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForFinalPreview(page, 'manor');
  const committed = await workshopState(page);
  assert.ok(
    committed.material.overrides[target.regionId],
    'Radial palette commit must store one semantic-area override.',
  );
  await captureCheckpoint(page, report, '07-material-area-override');

  console.log('Workshop QA · materials · advanced inspector and imported normal map');
  const inspectorTarget = await findMaterialPoint(page);
  await page.mouse.click(inspectorTarget.point.x, inspectorTarget.point.y);
  await page.waitForFunction(() => (
    !window.__editor.proceduralWorkshop.materialController.palette.hidden
  ));
  await clickDom(page, '[data-material-action="more"]');
  await page.waitForFunction(() => (
    !window.__editor.proceduralWorkshop.materialController.inspector.hidden
  ));
  await captureCheckpoint(page, report, '08-material-inspector');
  await page.locator('[data-material-source-file="normal"]').setInputFiles({
    name: 'qa-normal.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await waitForFinalPreview(page, 'manor');
  const imported = await workshopState(page);
  assert.ok(
    Object.values(imported.material.sources).some(({ kind }) => kind === 'normal'),
    'Imported PBR normal source must be persisted in the canonical material library.',
  );

  console.log('Workshop QA · materials · reset and keyboard cancellation');
  const secondTarget = await findMaterialPoint(page);
  await page.mouse.click(secondTarget.point.x, secondTarget.point.y);
  await page.waitForFunction(() => (
    !window.__editor.proceduralWorkshop.materialController.palette.hidden
  ));
  const beforeCancel = await workshopState(page);
  await page.locator('[data-role="material-palette"] [data-preset-id]').nth(2).hover();
  await page.keyboard.press('Escape');
  const afterCancel = await workshopState(page);
  assert.equal(afterCancel.material.paletteOpen, false);
  assert.deepEqual(
    afterCancel.material.overrides,
    beforeCancel.material.overrides,
    'Escape must restore the authored appearance without mutation.',
  );
  report.assertions.push(
    'material hover selected a complete semantic region',
    'radial palette stayed within viewport bounds',
    'favorite hover previewed without recipe mutation',
    'keyboard navigation committed one undoable full-PBR override',
    'advanced inspector persisted an imported linear normal source',
    'Escape cancelled preview without mutation',
  );
}

async function runBrowserQa(run) {
  const report = {
    run,
    startedAt: new Date().toISOString(),
    url: baseUrl,
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
    assertions: [],
    checkpoints: [],
    startupConsoleErrors: [],
    consoleErrors: [],
    pageErrors: [],
  };
  const browser = await chromium.launch({
    headless: !hasFlag('headed'),
    args: [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=swiftshader',
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') report.consoleErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/workshop-qa.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__editor?.proceduralWorkshop, null, {
      timeout: timeoutMs,
    });
    await clickDom(page, '[data-tool="workshop"]');
    await waitForFinalPreview(page, 'manor');
    report.startupConsoleErrors = [...report.consoleErrors];
    report.consoleErrors.length = 0;

    await runPlanarScenario(page, report);
    await runRadialScenario(page, report);
    await runMaterialScenario(page, report);

    assert.deepEqual(report.pageErrors, [], 'Browser page errors were emitted.');
    assert.deepEqual(report.consoleErrors, [], 'Browser console errors were emitted.');
    report.completedAt = new Date().toISOString();
    report.passed = true;
    return report;
  } finally {
    await browser.close();
  }
}

function classifyFailure(error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  if (/port|Vite server|process|ECONNREFUSED/i.test(message)) return 'lifecycle';
  if (/framing|visible host coverage/i.test(message)) return 'framing';
  if (/pointer|scanning|placement point|semantic material region/i.test(message)) return 'pointer-hit-testing';
  if (/screenshot|PNG|blank|canvas/i.test(message)) return 'screenshot';
  if (/persist|regenerat|baked|document/i.test(message)) return 'persistence';
  if (/console|page errors|status/i.test(message)) return 'browser-runtime';
  return 'state';
}

await mkdir(outputDirectory, { recursive: true });
let buildOutput = '';
const suiteReport = {
  startedAt: new Date().toISOString(),
  requiredConsecutiveRuns: runCount,
  runs: [],
  passed: false,
};
let terminalError = null;
try {
  assert.ok(Number.isInteger(runCount) && runCount >= 1 && runCount <= 10, 'QA runs must be 1-10.');
  console.log('Workshop QA · building immutable production bundle');
  buildOutput = await buildProductionBundle();
  for (let run = 1; run <= runCount; run += 1) {
    let server = null;
    let serverOutput = '';
    let runReport = null;
    try {
      port = await preflightPort(requestedPort ?? 0);
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Workshop QA · run ${run}/${runCount} · isolated port ${port}`);
      server = startServer();
      server.stdout.on('data', (chunk) => {
        serverOutput += chunk.toString();
      });
      server.stderr.on('data', (chunk) => {
        serverOutput += chunk.toString();
      });
      await waitForServer(server);
      runReport = await runBrowserQa(run);
      runReport.serverOutput = serverOutput;
      suiteReport.runs.push(runReport);
      console.log(`Workshop QA run ${run} passed with ${runReport.assertions.length} assertions.`);
      for (const checkpoint of runReport.checkpoints) {
        console.log(`  ${checkpoint.name}: ${checkpoint.screenshot} (${checkpoint.bytes} bytes)`);
      }
    } catch (error) {
      runReport = {
        run,
        url: baseUrl,
        completedAt: new Date().toISOString(),
        passed: false,
        failureCategory: classifyFailure(error),
        error: error instanceof Error ? error.stack : String(error),
        serverOutput,
      };
      suiteReport.runs.push(runReport);
      terminalError = error;
      break;
    } finally {
      await terminateChildProcess(server);
      try {
        await preflightPort(port);
        if (runReport) runReport.lifecycleTeardown = 'clean';
      } catch (error) {
        if (runReport) {
          runReport.lifecycleTeardown = 'failed';
          runReport.failureCategory = 'lifecycle';
          runReport.teardownError = error instanceof Error ? error.message : String(error);
          runReport.passed = false;
        }
        terminalError ??= error;
      }
    }
    if (terminalError) break;
  }
  suiteReport.passed = !terminalError
    && suiteReport.runs.length === runCount
    && suiteReport.runs.every((run) => run.passed && run.lifecycleTeardown === 'clean');
  if (!suiteReport.passed) {
    throw terminalError ?? new Error('Workshop QA did not complete the required clean runs.');
  }
  console.log(`Workshop QA passed ${runCount} consecutive clean runs.`);
} catch (error) {
  terminalError = error;
} finally {
  suiteReport.completedAt = new Date().toISOString();
  suiteReport.buildOutput = buildOutput;
  await writeFile(
    path.join(outputDirectory, 'report.json'),
    `${JSON.stringify(suiteReport, null, 2)}\n`,
  );
}
if (terminalError) throw terminalError;
