// QA-only: tree scene stills and motion recordings for a revision A/B through the existing __worldVisualQa controls.
// node scripts/run-world-visual-tree-scenes-qa.mjs --url <frozen-server> --out <dir> --poses <manifest.json>
// The first run writes the pose manifest; later runs reuse it so both revisions share identical poses.
import { chromium } from 'playwright';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureVisualSource, visualSourceStayedFixed } from './lib/world-visual-source.mjs';
import { captureVisualHarness } from './lib/world-visual-harness.mjs';
import { captureWorldCanvas } from './lib/world-visual-canvas.mjs';
import { fileHash } from './lib/world-visual-report.mjs';
import { waitForPerfRunLock } from './perf-run-lock.mjs';
import { createBrowserErrorMonitor } from './lib/perf-browser-errors.mjs';

const option = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const repo = fileURLToPath(new URL('../', import.meta.url));
const url = option('--url', 'http://localhost:5173'), out = path.resolve(option('--out', 'tmp/tree-scenes'));
const posesFile = path.resolve(option('--poses', path.join(out, 'poses.json')));
const origin = { x: Number(option('--x', 2005)), z: Number(option('--z', 2941)) };
// --motion a,b: record only those motion clips (no stills), e.g. to repeat one clip into a separate --out.
const motionOnly = option('--motion', '') ? option('--motion', '').split(',') : null;
const VIEWPORT = { width: 1600, height: 900 };
// The sky preset drives the lights; a paused clock's hour alone never rewrites them (dayNightCycle.update).
const DRY_LIGHTS = { day: { preset: 'highfield', hour: 12 }, 'low-sun': { preset: 'emberfall', hour: 19 },
  overcast: { preset: 'highfield', hour: 12, weather: 'overcast' }, night: { preset: 'moonrise', hour: 21 } };
const WEATHER_PASSES = [['rain', { preset: 'highfield', hour: 12, weather: 'rain' }], ['snow', { preset: 'highfield', hour: 12, weather: 'snow' }]];
const WEATHER_WARM_SECONDS = 30;
const BROWSER_ARGS = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'];
await mkdir(out, { recursive: true });

const qa = (page, fn, arg) => page.evaluate(fn, arg);
const snapshot = page => qa(page, () => {
  const d = window.__worldVisualQa.diagnostics();
  const counters = Object.fromEntries(Object.entries(d.counters ?? {}).filter(([k]) => /tree|impostor/i.test(k)));
  return { canonical: d.canonical, origin: d.origin, yaw: d.yaw, pitch: d.pitch, actualBiomeId: d.actualBiomeId,
    assetIntegrity: d.assetIntegrity, ready: d.readiness.ready, sky: d.sky, wind: d.wind, weather: d.weather,
    backend: d.backend, clock: d.clock, treeCounters: counters, treePlacements: d.placements.tree.length };
});

async function openApp(browser, contextOptions = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...contextOptions });
  const page = await context.newPage(), errors = createBrowserErrorMonitor(page);
  await page.goto(new URL('/?qaVisual=1', url).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__worldVisualQa, null, { timeout: 180000 });
  const adapter = await qa(page, async () => {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance', featureLevel: 'compatibility' });
    return { vendor: a?.info.vendor, architecture: a?.info.architecture, description: a?.info.description,
      fallback: !!(a?.info.isFallbackAdapter ?? a?.isFallbackAdapter), backend: window.__editor.terrainView.rendererBackendStatus.mode };
  });
  if (adapter.backend !== 'webgpu' || adapter.fallback || /swiftshader|lavapipe|llvmpipe|warp|basic render/i.test(JSON.stringify(adapter)))
    throw new Error(`Hardware WebGPU required: ${JSON.stringify(adapter)}`);
  await qa(page, () => window.__worldVisualQa.setAvatarVisible(false));
  return { context, page, errors, adapter };
}

async function cutAndSettle(page, pose) {
  await qa(page, p => window.__worldVisualQa.cut(p), pose);
  return qa(page, () => window.__worldVisualQa.settle({ minimumMs: 16000, timeoutMs: 180000 }));
}

const YAW_CONVENTIONS = [(dx, dz) => Math.atan2(-dx, -dz), (dx, dz) => Math.atan2(dx, dz), (dx, dz) => Math.atan2(-dx, dz), (dx, dz) => Math.atan2(dx, -dz)];
/** The yaw convention that faces a canonical point, verified against the engine's own projection of that tree. */
async function facingConvention(page, from, target) {
  for (const convention of YAW_CONVENTIONS) {
    await qa(page, p => window.__worldVisualQa.cut(p), { ...from, yaw: convention(target.x - from.x, target.z - from.z), pitch: 0, mode: 'player' });
    const tree = (await qa(page, () => window.__worldVisualQa.vegetation({ radius: 80, limit: 256 }))).trees.find(t => t.stableId === target.stableId);
    if (tree && tree.screen.x > .4 && tree.screen.x < .6) return convention;
  }
  throw new Error('No yaw convention centred the target tree.');
}

async function buildPoses(page) {
  await cutAndSettle(page, { ...origin, yaw: 0, pitch: 0, mode: 'player' });
  const start = await snapshot(page), vegetation = await qa(page, () => window.__worldVisualQa.vegetation({ radius: 60, limit: 64 }));
  const target = vegetation.trees.find(t => t.distance > 6) ?? vegetation.trees[0];
  if (!target) throw new Error(`No tree within 60 m of ${JSON.stringify(origin)}.`);
  const at = (distance, angle) => ({ x: target.x + Math.sin(angle) * distance, z: target.z + Math.cos(angle) * distance });
  const bearing = Math.atan2(origin.x - target.x, origin.z - target.z);
  const poses = [], convention = await facingConvention(page, at(Math.max(18, target.distance), bearing), target);
  const add = async (id, distance, pitch, extra = {}) => {
    const from = at(distance, bearing), yaw = convention(target.x - from.x, target.z - from.z);
    poses.push({ id, ...from, yaw: yaw + (extra.turn ?? 0), pitch, mode: extra.mode ?? 'player', ...(extra.mode === 'fly' ? { heightAboveGround: extra.height, fov: 60 } : {}), targetDistance: distance });
  };
  await add('forest-wide', Math.max(18, target.distance), -0.02);
  await add('forest-wide-reverse', Math.max(18, target.distance), -0.02, { turn: Math.PI });
  await add('bark-close', 2.2, -0.12);
  await add('tree-base', 3.2, -0.5);
  await add('crown-under', 4, 0.75);
  await add('crown-mid', 9, 0.3);
  await add('transition-overview', 70, -0.3, { mode: 'fly', height: 30 });
  await add('distance-impostors', 260, -0.18, { mode: 'fly', height: 60 });
  // Understory: the bush placement nearest the origin pose, seen front- and back-lit.
  const bush = await qa(page, o => (window.__editor.stylizedSurface.bushView?.placements ?? [])
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.z))
    .map(p => ({ x: p.x, z: p.z, stableId: p.stableId ?? null, asset: p.asset ?? p.variant ?? p.prototype ?? null, distance: Math.hypot(p.x - o.x, p.z - o.z) }))
    .sort((a, b) => a.distance - b.distance)[0] ?? null, origin);
  if (bush) {
    const from = { x: bush.x + 3.2, z: bush.z + 0.8 }, yaw = convention(bush.x - from.x, bush.z - from.z);
    poses.push({ id: 'understory', ...from, yaw, pitch: -0.32, mode: 'player', bush });
    poses.push({ id: 'understory-reverse', x: bush.x - 3.2, z: bush.z - 0.8, yaw: yaw + Math.PI, pitch: -0.32, mode: 'player', bush });
  }
  const world = await qa(page, () => { const e = window.__editor, store = e.terrainView.worldStore;
    return { source: 'default procedural world (/?qaVisual=1)', seed: store.generator?.seed ?? e.config.map?.seed ?? null, tileSize: store.tileSize, chunkSize: store.chunkSize }; });
  return { schemaVersion: 1, createdAt: new Date().toISOString(), world,
    origin, originBiomeId: start.actualBiomeId, target, poses, viewport: VIEWPORT, deviceScaleFactor: 1,
    lights: DRY_LIGHTS, weatherPasses: WEATHER_PASSES, weatherWarmSeconds: WEATHER_WARM_SECONDS, sky: 'highfield preset, day/night clock paused' };
}

async function still(page, file, report, meta) {
  if (!await qa(page, () => window.__worldVisualQa.setCaptureUi(true))) throw new Error('Clean capture mode was blocked.');
  await captureWorldCanvas(page, path.join(out, 'stills', file));
  await qa(page, () => window.__worldVisualQa.setCaptureUi(false));
  report.stills.push({ path: `stills/${file}`, sha256: await fileHash(path.join(out, 'stills', file)), ...meta, state: await snapshot(page) });
}

async function setLight(page, light) {
  await qa(page, l => window.__worldVisualQa.setLighting(l), { preset: light.preset, hour: light.hour, weather: light.weather ?? 'off' });
  return qa(page, () => window.__worldVisualQa.settleLighting());
}

async function recordFlyOut(page, pose) {
  // Free flight disables the player motor: prepare destination collision on the ground first (prepareVisualPose).
  await cutAndSettle(page, { x: pose.x, z: pose.z, yaw: pose.yaw, pitch: 0, mode: 'player' });
  await cutAndSettle(page, { ...pose, heightAboveGround: 8 });
  await setLight(page, DRY_LIGHTS.day);
  return qa(page, async () => {
    const e = window.__editor, camera = e.viewModeController.freeFly.camera, samples = [];
    const back = { x: Math.sin(camera.rotation.y), z: Math.cos(camera.rotation.y) };
    const start = e.terrainView.floatingOrigin.toCanonical(camera.position.x, camera.position.z);
    let last = performance.now(), elapsed = 0, frames = 0;
    while (elapsed < 20) {
      const now = await new Promise(r => requestAnimationFrame(r)), dt = Math.min(.05, (now - last) / 1000); last = now; elapsed += dt; frames++;
      camera.position.x += back.x * 16 * dt; camera.position.z += back.z * 16 * dt; camera.position.y += 2.5 * dt; camera.updateMatrixWorld();
      if (frames % 30 === 0) {
        const d = window.__worldVisualQa.diagnostics();
        samples.push({ elapsed, canonical: d.canonical, origin: d.origin, counters: Object.fromEntries(Object.entries(d.counters).filter(([k]) => /tree|impostor/i.test(k))) });
      }
    }
    const end = e.terrainView.floatingOrigin.toCanonical(camera.position.x, camera.position.z);
    return { durationSeconds: elapsed, frames, travelledMetres: Math.hypot(end.x - start.x, end.z - start.z), start, end, samples };
  });
}

const release = await waitForPerfRunLock(path.join(repo, 'tmp', `perf-browser-${process.platform}.lock`));
const report = { schemaVersion: 1, ...await captureVisualSource(url, repo), harness: await captureVisualHarness(import.meta.url, repo),
  startedAt: new Date().toISOString(), viewport: VIEWPORT, stills: [], motion: {}, failures: [] };
let browser;
try {
  if (report.dirtyFiles.length) throw new Error(`Frozen snapshot server required; dirty: ${report.dirtyFiles.join(', ')}`);
  browser = await chromium.launch({ headless: false, args: BROWSER_ARGS });
  await mkdir(path.join(out, 'stills'), { recursive: true });
  const { page, errors, adapter, context } = await openApp(browser);
  report.adapter = adapter;
  report.browser = { version: browser.version(), userAgent: await page.evaluate(() => navigator.userAgent), devicePixelRatio: await page.evaluate(() => devicePixelRatio) };
  let manifest;
  if (existsSync(posesFile)) manifest = JSON.parse(await readFile(posesFile, 'utf8'));
  else { manifest = await buildPoses(page); await writeFile(posesFile, JSON.stringify(manifest, null, 2)); }
  report.poseManifest = { path: posesFile, sha256: await fileHash(posesFile) };
  for (const pose of motionOnly ? [] : manifest.poses) {
    console.log(`Tree scenes: ${pose.id}`);
    try {
      const readiness = await cutAndSettle(page, pose);
      for (const [name, light] of Object.entries(DRY_LIGHTS)) {
        const lighting = await setLight(page, light);
        await still(page, `${pose.id}-${name}.png`, report, { pose: pose.id, light: name, readinessWaitMs: readiness.waitedMs, lightingStableFrames: lighting.stableFrames });
      }
    } catch (error) { report.failures.push({ pose: pose.id, error: error.message }); }
  }
  for (const [name, light] of motionOnly ? [] : WEATHER_PASSES) {
    console.log(`Tree scenes: weather ${name}`);
    try {
      await setLight(page, light);
      report.motion[`${name}-warm`] = await qa(page, s => window.__worldVisualQa.warmWeather(s), WEATHER_WARM_SECONDS);
      for (const pose of manifest.poses.filter(p => ['forest-wide', 'bark-close', 'crown-mid', 'transition-overview', 'understory'].includes(p.id))) {
        await cutAndSettle(page, pose);
        await still(page, `${pose.id}-${name}.png`, report, { pose: pose.id, light: name, weatherOrder: WEATHER_PASSES.map(([n]) => n) });
      }
    } catch (error) { report.failures.push({ pose: `weather-${name}`, error: error.message }); }
  }
  report.errors = errors.snapshot();
  await context.close();

  // Motion is recorded in its own context; recordings are never timing evidence.
  await mkdir(path.join(out, 'motion'), { recursive: true });
  const record = async (id, run) => {
    if (motionOnly && !motionOnly.includes(id)) return;
    console.log(`Tree scenes: motion ${id}`);
    const session = await openApp(browser, { recordVideo: { dir: path.join(out, 'motion'), size: VIEWPORT } });
    try { report.motion[id] = await run(session.page); }
    catch (error) { report.failures.push({ pose: `motion-${id}`, error: error.message }); }
    finally {
      report.motion[id] = { ...report.motion[id], errors: session.errors.snapshot() };
      const video = session.page.video(); await session.context.close();
      const file = path.join(out, 'motion', `${id}.webm`); await rename(await video.path(), file);
      report.motion[id].video = { path: `motion/${id}.webm`, sha256: await fileHash(file) };
    }
  };
  const byId = id => manifest.poses.find(p => p.id === id);
  await record('wind-crown', async page => {
    await cutAndSettle(page, byId('crown-mid')); await setLight(page, DRY_LIGHTS.day);
    await mkdir(path.join(out, 'motion', 'wind-crown-frames'), { recursive: true });
    const frames = [];
    for (let i = 1; i <= 16; i++) {
      const file = `motion/wind-crown-frames/${String(i).padStart(3, '0')}.png`;
      await captureWorldCanvas(page, path.join(out, file)); frames.push({ path: file, state: await snapshot(page) });
      await page.waitForTimeout(250);
    }
    return { frames };
  });
  await record('wind-bark', async page => {
    await cutAndSettle(page, byId('bark-close')); await setLight(page, DRY_LIGHTS['low-sun']);
    await mkdir(path.join(out, 'motion', 'wind-bark-frames'), { recursive: true });
    const frames = [];
    for (let i = 1; i <= 16; i++) {
      const file = `motion/wind-bark-frames/${String(i).padStart(3, '0')}.png`;
      await captureWorldCanvas(page, path.join(out, file)); frames.push({ path: file, state: await snapshot(page) });
      await page.waitForTimeout(250);
    }
    return { frames };
  });
  await record('walk', async page => {
    await setLight(page, DRY_LIGHTS.day);
    const startPose = { ...byId('forest-wide'), mode: 'player' }; delete startPose.targetDistance;
    const result = await qa(page, p => window.__worldVisualQa.runMotion({ startPose: p }), startPose);
    const frames = result.frames ?? [];
    const origins = [...new Set(frames.map(f => JSON.stringify(f.origin)))].length;
    return { frameCount: frames.length, distinctOriginStates: origins, first: frames[0], last: frames.at(-1), summary: { ...result, frames: undefined } };
  });
  // floatingOriginThreshold is 4096 m: start 56 m short of it and retreat along +x (yaw π/2) so the origin rebases mid-clip.
  await record('rebase-fly', page => recordFlyOut(page, { x: 4040, z: origin.z, yaw: Math.PI / 2, pitch: -0.15, mode: 'fly', fov: 60 }));
  await record('fly-out', page => recordFlyOut(page, byId('crown-mid').mode === 'fly' ? byId('crown-mid') : { ...byId('crown-mid'), mode: 'fly', fov: 60 }));
  const end = await captureVisualSource(url, repo);
  report.sourceStable = visualSourceStayedFixed(report, end);
} catch (error) { report.failure = error.stack; process.exitCode = 1; }
finally {
  await browser?.close(); release(); report.finishedAt = new Date().toISOString();
  report.passed = !report.failure && report.failures.length === 0 && report.sourceStable === true && (report.errors?.count ?? 0) === 0;
  if (!report.passed) process.exitCode = 1;
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, stills: report.stills.length, failures: report.failures, failure: report.failure }, null, 2));
}
