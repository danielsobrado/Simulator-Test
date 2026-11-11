import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareVisualPose } from './lib/world-visual-prepare-pose.mjs';
import { captureWorldCanvas } from './lib/world-visual-canvas.mjs';
import { createBrowserErrorMonitor } from './lib/perf-browser-errors.mjs';
import { waitForPerfRunLock } from './perf-run-lock.mjs';
import { lookMetrics, checkGates } from './lib/look-metrics.mjs';
import { compareRenderedImages } from './lib/rendered-image-metrics.mjs';
import { captureVisualSource } from './lib/world-visual-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values: args } = parseArgs({ options: {
  url: { type: 'string', default: 'http://localhost:5174' },
  out: { type: 'string', default: `docs/qa/environment-look/${new Date().toISOString().slice(0, 10)}` },
  only: { type: 'string' }, 'no-gates': { type: 'boolean', default: false },
} });
const fixture = JSON.parse(await readFile(new URL('./fixtures/environment-look-shots.json', import.meta.url), 'utf8'));
const poses = new Map(fixture.poses.map(pose => [pose.id, pose]));
for (const pose of fixture.poses.filter(pose => pose.canopy)) {
  poses.set(`${pose.id}-air`, { ...pose, id: `${pose.id}-air`, mode: 'fly', heightAboveGround: 45, pitch: -0.45, fov: 60 });
}
const nameOf = shot => `${shot.pose}-${shot.weather}-${shot.hour}`;
const requested = args.only?.split(',');
const selected = new Set(requested ?? fixture.shots.map(nameOf));
for (const name of selected) if (!fixture.shots.some(shot => nameOf(shot) === name)) throw new Error(`Unknown shot: ${name}`);
// A selected relational gate always gets its reference, even in a partial run.
for (const shot of fixture.shots) if (selected.has(nameOf(shot))) {
  for (const reference of [shot.gates?.against, shot.gates?.distinctFrom]) if (reference) selected.add(reference);
}
const shots = fixture.shots.filter(shot => selected.has(nameOf(shot)));
const out = path.resolve(root, args.out);
await mkdir(out, { recursive: true });
await mkdir(path.join(root, 'tmp'), { recursive: true });
const report = { startedAt: new Date().toISOString(), viewport: { width: 1600, height: 900 },
  noGates: args['no-gates'], shots: [] };
const save = () => writeFile(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const images = new Map(), resolvedCanopies = new Map();
let browser, monitor, source;
const release = await waitForPerfRunLock(path.join(root, 'tmp', `perf-browser-${process.platform}.lock`));
try {
  source = await captureVisualSource(args.url, root);
  report.source = source;
  browser = await chromium.launch({ headless: false, args: [
    '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default',
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  ] });
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  monitor = createBrowserErrorMonitor(page);
  await page.goto(`${args.url}/?qaVisual=1`, { waitUntil: 'domcontentloaded', timeout: 600000 });
  await page.waitForFunction(() => !!window.__worldVisualQa, null, { timeout: 600000 });
  report.adapter = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' });
    return { vendor: adapter?.info.vendor, architecture: adapter?.info.architecture, description: adapter?.info.description,
      fallback: !!(adapter?.info.isFallbackAdapter ?? adapter?.isFallbackAdapter), backend: window.__editor.terrainView.rendererBackendStatus.mode };
  });
  if (report.adapter.backend !== 'webgpu' || report.adapter.fallback
    || /swiftshader|lavapipe|llvmpipe|warp|basic render/i.test(JSON.stringify(report.adapter))) throw new Error('Hardware WebGPU required.');
  let world = 'procedural';
  for (const shot of shots) {
    const name = nameOf(shot), result = { name, requestedPose: poses.get(shot.pose), gates: [] };
    report.shots.push(result);
    console.log(`Capture ${name}`);
    try {
      let pose = { ...result.requestedPose };
      if (pose.world !== world) { await page.evaluate(world => window.__worldVisualQa.loadWorld(world), pose.world); world = pose.world; }
      await page.evaluate(shot => window.__worldVisualQa.setLighting(shot), shot);
      if (pose.canopy) {
        const key = pose.id.replace(/-air$/, '');
        if (!resolvedCanopies.has(key)) {
          await prepareVisualPose(page, { ...pose, mode: 'player', heightAboveGround: 1.7 }, { minimumMs: 6000 });
          const found = await page.evaluate(pose => window.__worldVisualQa.findCanopyPose(pose), pose);
          if (!found) throw new Error('no closed canopy within 480 m');
          resolvedCanopies.set(key, found);
        }
        pose = { ...pose, ...resolvedCanopies.get(key) };
      }
      result.pose = pose;
      result.preparation = await prepareVisualPose(page, pose, { minimumMs: 6000 });
      await page.evaluate(shot => window.__worldVisualQa.setLighting(shot), shot);
      if (shot.weather !== 'off') result.weatherWarmup = await page.evaluate(() => window.__worldVisualQa.warmWeather(8));
      await page.evaluate(() => { window.__worldVisualQa.setCaptureUi(true); window.__worldVisualQa.setAvatarVisible(false); });
      await page.waitForTimeout(1500);
      Object.assign(result, await page.evaluate(async ({ x, z }) => {
        const { stormSnowCoverUniform } = await import('/src/editor/weather/storm/stormGroundUniforms.js');
        const qa = window.__worldVisualQa, d = qa.diagnostics(), e = window.__editor, look = d.sky;
        return { actualBiomeId: d.actualBiomeId, habitat: qa.habitatAt(x, z), cameraHeight: d.camera[1],
          storm: e.weatherController?.storm, snowCover: e.snowCover?.value, stormSnowCoverUniform: stormSnowCoverUniform.value,
          sky: { fogColor: look?.fogColor, groundLightColor: look?.groundLightColor,
            mist: look?.mist, nightness: look?.nightness }, readiness: d.readiness, assetIntegrity: d.assetIntegrity };
      }, pose));
      if (pose.tileId !== undefined && result.actualBiomeId !== pose.tileId) result.failure = `Expected biome ${pose.tileId}, got ${result.actualBiomeId}`;
      if (!result.assetIntegrity?.ready) result.failure = `Tree assets incomplete: ${JSON.stringify(result.assetIntegrity)}`;
      if (pose.canopy && !(result.habitat?.patchCoverage >= 0.75)) result.failure = 'Resolved pose lost closed canopy';
      const png = path.join(out, `${name}.png`);
      await captureWorldCanvas(page, png);
      await sharp(png).resize(960, 540).jpeg({ quality: 82 }).toFile(path.join(out, `${name}.jpg`));
      const { data, info } = await sharp(png).removeAlpha().resize(480, 270, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      images.set(name, { data, width: info.width, height: info.height, channels: info.channels });
      result.metrics = lookMetrics(data, info.width, info.height);
    } catch (error) { result.failure = error.stack; }
    await save();
  }
  for (const result of report.shots) {
    const shot = shots.find(shot => nameOf(shot) === result.name), gates = { ...fixture.gates, ...shot.gates };
    result.gates = checkGates(result.metrics, gates, report.shots.find(other => other.name === gates.against)?.metrics);
    if (gates.distinctFrom) {
      const reference = images.get(gates.distinctFrom), actual = images.get(result.name);
      const value = reference && actual ? compareRenderedImages(reference, actual).meanColorError : null;
      result.gates.push({ gate: 'meanColorErrorMin', against: gates.distinctFrom, value, limit: gates.meanColorErrorMin,
        passed: Number.isFinite(value) && value >= gates.meanColorErrorMin });
    }
    result.passed = !result.failure && result.gates.every(gate => gate.passed);
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name} ${result.failure ?? result.gates.filter(gate => !gate.passed).map(gate => `${gate.gate}=${gate.value} (limit ${gate.limit})`).join(', ')}`);
  }
  const tiles = [];
  for (let i = 0; i < report.shots.length; i++) {
    const { name } = report.shots[i];
    if (!images.has(name)) continue;
    const tile = await sharp(path.join(out, `${name}.png`)).resize(400, 225).toBuffer();
    const left = (i % 4) * 400, top = Math.floor(i / 4) * 245;
    const label = Buffer.from(`<svg width="400" height="20"><text x="5" y="15" fill="white" font-size="13">${name}</text></svg>`);
    tiles.push({ input: label, left, top }, { input: tile, left, top: top + 20 });
  }
  await sharp({ create: { width: 1600, height: Math.ceil(report.shots.length / 4) * 245, channels: 3, background: '#15191d' } })
    .composite(tiles).jpeg({ quality: 85 }).toFile(path.join(out, 'contact-sheet.jpg'));
  report.sourceAfterCapture = await captureVisualSource(args.url, root);
} catch (error) { report.failure = error.stack; }
finally {
  report.errors = monitor?.snapshot() ?? { count: 0, errors: [] };
  try { await browser?.close(); } finally { release(); }
  report.finishedAt = new Date().toISOString();
  report.passed = !report.failure && report.errors.count === 0
    && report.shots.length === shots.length && report.shots.every(shot => shot.passed);
  await save();
  console.log(JSON.stringify({ passed: report.passed, shots: report.shots.length, errors: report.errors.count, failure: report.failure, report: path.join(out, 'report.json') }));
  if (!report.passed && !args['no-gates']) process.exitCode = 1;
}
