import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = 'docs/screenshots/locations';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [site id, file prefix, poses as [x, y, z, yaw, pitch]]
const SITES = [
  ['showcase-frostgard-glacier', 'front', [[0,3,24,0,0.08],[4,3,9,0,0.16],[4,2,-13,0.1,0.3],[-4,2,-22,1.25,0.22],[11,2,-46,3.1416,0.08],[36,3,6,0.95,0.28]]],
  ['showcase-frostgard-refuge', 'glacier', [[0,4.2,17,0,-0.1],[0,0,-2,3.1416,0.15],[-4.6,-0.8,-15,0.08,0],[-6.75,-2,-39.5,-0.52,0.2],[-0.87,-2,-46,-1.07,0.6],[-30,-1,-64,0.74,0.05],[6,-3,-87,0,0.1]]],
  ['showcase-frostgard-hold', 'frosthold', [[0,3,31,0,0.1],[0,3,9,0,0.14],[9,2,3,0.7,0.15],[0,1.6,-8,0,0],[0,1.4,-16,0,0.06],[0,1.4,-31,3.1416,0.04],[-8,1,-46.5,0.9,0],[-15,0.6,-55,0.75,0.1]]],
  ['showcase-deep-workings', 'mine', [[0,0,3,0,0],[0,-1,-40,0,0],[-3,-1,-46,-0.9,0.1],[-30,-3,-60,1.25,0],[0,-9,-80.5,0,-0.1],[0.25,-0.25,-7.6,0.51,0.32],[0,-0.3,-8.5,3.1416,0.02],[26.2,0.5,-37.5,-2.42,0.04]]],
  ['showcase-stonehold-hall', 'hold', [[0,0,0,0,0.1],[0,0,-24,0,0.25],[19,7,-50,0.3,-0.1],[0,0,-62,0,0.05],[6,0,-84,0.48,0.3],[0,0,-124,0,0.1]]],
  ['showcase-umbrakor-cavern', 'drow', [[0,16,-20,0,-0.05],[0,12.5,-40,0,0.15],[2,8,-55,0.1,0.3],[-36,14,-60,-1.5708,-0.1],[10,-6,-108,1.5708,0.05],[38,2,-70,1.2,0.2]]],
];

// Usage: node scripts/capture-locations.mjs [prefix[,prefix...]] [exit]
// `exit` also leaves the first and last site, to capture the return to the surface.
const only = process.argv[2]?.split(',');
const leave = process.argv[3] === 'exit';
if (only) SITES.splice(0, SITES.length, ...SITES.filter((site) => only.includes(site[1])));

const errors = new Set();
const report = [];
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default'] });

for (let i = 0; i < SITES.length; i++) {
  const [id, short, poses] = SITES[i];
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.add(`[${short}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.add(`[${short}] pageerror: ${e.message}`));
  const shot = (name) => page.screenshot({ path: `${OUT}/${short}-${name}.jpg`, quality: 85 });
  const overlayHidden = 'document.querySelector(".loading-overlay")?.hidden === true || !document.querySelector(".loading-overlay")';
  const t0 = Date.now();
  page.goto(`http://localhost:5174/?location=${id}`).catch(() => {});

  try {
    await page.waitForFunction(() => document.querySelector('.loading-overlay')?.dataset.theme, null, { timeout: 180000, polling: 100 });
    await sleep(1500);
    await shot('loading');
  } catch { console.log(`${short}: loading shot skipped`); }

  const info = { site: id, seconds: null, error: null, exit: null };
  report.push(info);
  try {
    await page.waitForFunction(`window.__editor?.locations?.state === 'inside' && (${overlayHidden})`, null, { timeout: 240000, polling: 500 });
  } catch (e) {
    info.error = 'timeout waiting for inside: ' + (await page.evaluate(() => document.querySelector('.loading-overlay [data-role=error]')?.textContent || '').catch(() => ''));
    await page.close();
    continue;
  }
  info.seconds = (Date.now() - t0) / 1000;
  const err = await page.evaluate(() => document.querySelector('.loading-overlay [data-role=error]')?.textContent?.trim() || '');
  if (err) { info.error = err; await page.close(); continue; }

  for (let n = 0; n < poses.length; n++) {
    const [x, y, z, yaw, pitch] = poses[n];
    await page.evaluate((p) => window.__editor.playerController.placeAt(p), { x, y, z, yaw, pitch });
    await sleep(700);
    await shot(String(n + 1));
  }

  if (leave && (i === 0 || i === SITES.length - 1)) {
    await page.evaluate(() => { window.__editor.locations.exit(); });
    await sleep(800);
    await shot('exit-loading');
    try {
      await page.waitForFunction(`window.__editor.locations.state === 'idle' && (${overlayHidden})`, null, { timeout: 240000, polling: 500 });
      await sleep(3000);
      await shot('returned');
      info.exit = await page.evaluate(() => ({ mode: window.__editor.viewModeController.mode, activeSiteId: window.__editor.locations.activeSiteId }));
    } catch { info.exit = 'timeout'; }
  }
  await page.context().close();
}

await browser.close();
console.log(JSON.stringify({ report, errors: [...errors] }, null, 1));
if (errors.size > 0 || report.some((entry) => entry.error)) {
  process.exitCode = 1;
}
