/**
 * Biome surface-response screenshots: one spot inside every biome (standard
 * Azgaar 1–12 in the procedural world, the bog and Stonehold Badlands in
 * Eldara), with prints, a spell crater, ripples and a water spell staged in
 * front of the camera. Shots land in docs/qa/biome-surface/<YYYY-MM-DD>/.
 *
 *   npm run dev                                  # app must already be serving
 *   npm run qa:biome-surface -- --url http://localhost:5174 [--only 1,11,32] [--out DIR]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForPerfRunLock } from './perf-run-lock.mjs';
import { createBrowserErrorMonitor } from './lib/perf-browser-errors.mjs';
import { captureWorldCanvas } from './lib/world-visual-canvas.mjs';
import { prepareVisualPose } from './lib/world-visual-prepare-pose.mjs';

const BIOMES = Object.freeze([
  ...[
    [1, 'hot-desert'], [2, 'cold-desert'], [3, 'savanna'], [4, 'grassland'], [5, 'tropical-seasonal-forest'],
    [6, 'temperate-deciduous-forest'], [7, 'tropical-rainforest'], [8, 'temperate-rainforest'], [9, 'taiga'],
    [10, 'tundra'], [11, 'glacier'], [12, 'wetland'],
  ].map(([id, name]) => ({ id, name, world: 'procedural' })),
  { id: 12, name: 'eldara-bog', world: 'eldara' },
  { id: 32, name: 'stonehold-badlands', world: 'eldara' },
]);
/** Seconds after staging: the prints and ripples have settled, then the sphere hangs. */
const GROUND_SHOT_S = 0.8;
const SPELL_SHOT_S = 3.4;
/** Spots tried per biome before settling for one without a dry ground heading. */
const SPOT_ATTEMPTS = 6;
/** Layers left out of the ground close-up (WorldVisualLayerControls names). */
const GROUND_SHOT_HIDDEN = Object.freeze({ bushes: false, rocks: false });

function parseArguments(argv) {
  const result = { url: 'http://localhost:5173', only: null, out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    if (!['url', 'only', 'out'].includes(key) || argv[i + 1] === undefined) throw new Error(`Invalid argument: ${argv[i]}`);
    result[key] = argv[i + 1];
  }
  return result;
}

const localDate = (date = new Date()) => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
  .map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');

const repo = fileURLToPath(new URL('../', import.meta.url));
const args = parseArguments(process.argv.slice(2));
const out = path.resolve(args.out ?? path.join(repo, 'docs', 'qa', 'biome-surface', localDate()));
const biomes = args.only ? BIOMES.filter((biome) => args.only.split(',').some((key) => key === biome.name || Number(key) === biome.id))
  : BIOMES;
await mkdir(out, { recursive: true });
const release = await waitForPerfRunLock(path.join(repo, 'tmp', `perf-browser-${process.platform}.lock`));
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), url: args.url, viewport: { width: 1600, height: 900 }, biomes: [] };
let browser;
let errors;
try {
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'] });
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  errors = createBrowserErrorMonitor(page);
  await page.goto(new URL('/?qaVisual=1', args.url).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__worldVisualQa, null, { timeout: 180000 });
  report.backend = await page.evaluate(() => window.__editor.terrainView.rendererBackendStatus.mode);
  if (report.backend !== 'webgpu') throw new Error(`Hardware WebGPU required, got ${report.backend}.`);
  await page.evaluate(() => window.__worldVisualQa.setLighting());
  let world = 'procedural';
  for (const biome of biomes) {
    if (biome.world !== world) {
      await page.evaluate((name) => window.__worldVisualQa.loadWorld(name), biome.world);
      world = biome.world;
    }
    console.log(`Biome surface QA: ${biome.name}`);
    const entry = { ...biome, files: [] };
    report.biomes.push(entry);
    // Water the generator cannot see (bog pools) can ring a spot: then the
    // loaded field has no dry heading for the ground shot, and the next seed is tried.
    let spot = null;
    let groundYaw = null;
    for (let attempt = 0; attempt < SPOT_ATTEMPTS && groundYaw === null; attempt += 1) {
      spot = await page.evaluate(({ id, seed }) => window.__worldVisualQa.findBiomeSurfacePose(id, { seed }), { id: biome.id, seed: 20261103 + attempt * 7919 });
      if (!spot) break;
      await prepareVisualPose(page, { x: spot.x, z: spot.z, yaw: spot.yaw, pitch: -0.42, mode: 'player', heightAboveGround: 1.7 },
        { minimumMs: 8000 });
      groundYaw = await page.evaluate(({ yaw }) => window.__worldVisualQa.liveDryHeading(yaw, null), spot);
      entry.attempts = attempt + 1;
    }
    if (!spot) { entry.skipped = 'no spot of this biome in the world'; continue; }
    groundYaw ??= spot.groundYaw;
    entry.spot = spot;
    entry.diagnostics = await page.evaluate(() => window.__worldVisualQa.diagnostics());
    await page.evaluate(() => window.__worldVisualQa.setCaptureUi(true));
    // The player's own body and shadow would otherwise sit in every ground shot.
    await page.evaluate(() => window.__worldVisualQa.setAvatarVisible(false));
    // The prints go on dry ground away from the spell; the spell goes on the water if any.
    entry.groundYaw = groundYaw;
    entry.stage = await page.evaluate((options) => window.__worldVisualQa.stageSurfaceDemo(options), { water: spot.water, groundYaw });
    for (const [shot, seconds, yaw, pitch] of [['ground', GROUND_SHOT_S, groundYaw, -0.42], ['spell', SPELL_SHOT_S, spot.yaw, -0.02]]) {
      await page.evaluate((pose) => window.__worldVisualQa.look(pose), { yaw, pitch });
      // The ground shot is a close-up of the prints: a bush or boulder at the
      // player's feet would fill it, so those layers sit out for that frame only.
      await page.evaluate((layers) => window.__worldVisualQa.setLayers(layers), shot === 'ground' ? GROUND_SHOT_HIDDEN : {});
      await page.waitForTimeout((seconds - (shot === 'spell' ? GROUND_SHOT_S : 0)) * 1000);
      const file = `${biome.name}-${shot}.png`;
      await captureWorldCanvas(page, path.join(out, file));
      entry.files.push(file);
    }
    await page.evaluate(() => window.__worldVisualQa.setCaptureUi(false));
    await page.evaluate(() => window.__worldVisualQa.setAvatarVisible(true));
  }
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.errors = errors?.snapshot() ?? { count: 0, errors: [] };
  report.finishedAt = new Date().toISOString();
  await browser?.close();
  release();
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, biomes: report.biomes.map((b) => `${b.name}: ${b.skipped ?? b.files.length}`), failure: report.failure }, null, 2));
}
