// Diagnostic probe for docs/plans/performance-plan-2026-11-10.md. Needs `npm run dev` serving; not a frame-pacing measurement.
// Usage: node scripts/probe-render-uniforms.mjs <qa-scenario> "<extra query>" <out.json> [baseUrl]
import fs from 'node:fs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePerfRunLock } from './perf-run-lock.mjs';
import { focusPerfBrowser } from './lib/perf-browser-focus.mjs';
import { createBrowserErrorMonitor } from './lib/perf-browser-errors.mjs';
const [qa, extra, out, base = 'http://localhost:5173'] = process.argv.slice(2);
if (!qa || !out) throw new Error('Usage: probe-render-uniforms.mjs <qa-scenario> "<extra query>" <out.json> [baseUrl]');
const root = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
const release = acquirePerfRunLock(path.join(root, 'tmp', `perf-browser-${process.platform}.lock`));
let browser;
try {
const url = `${base}/?qa=${qa}&warmup=900&duration=5&download=0&autostart=1${extra ?? ''}`;
browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const browserErrors = createBrowserErrorMonitor(page);
page.setDefaultTimeout(240000);
const startupFocus = await focusPerfBrowser(browser, page, { headed: true });
assert.equal((await startupFocus()).passed, true);
await page.goto(url, { waitUntil: 'commit' });
const captureFocus = await focusPerfBrowser(browser, page, { headed: true });
await page.waitForFunction(() => window.__perfQa != null && window.__editor?.terrainView?.renderer);
await page.waitForTimeout(75000);
await page.waitForFunction(() => window.__editor.stylizedSurface.getPreparationStatus().ready);
const result = await page.evaluate(async () => {
  const r = window.__editor.terrainView.renderer; const b = r._bindings; const nodes = r._nodes;
  if (!b || !nodes) return { error: 'no _bindings/_nodes', keys: Object.keys(r).filter(k => k.startsWith('_')) };
  const mats = new Map(); let cur = null; let frames = 0;
  const key = ro => (ro.material?.name || ro.object?.name || ro.material?.type || '?').replace(/[-_:\s]?-?\d+([,.:_-]-?\d+)*/g, '').slice(0, 40);
  const oUFR = b.updateForRender, oU = b._update, oN = nodes.updateForRender;
  b.updateForRender = function (ro) {
    cur = mats.get(key(ro)); if (!cur) mats.set(key(ro), cur = { draws: 0, t: 0, nodeT: 0, updateNodes: 0, groups: {}, objU: new Map() });
    cur.draws++; const t0 = performance.now(); const res = oUFR.apply(this, arguments); cur.t += performance.now() - t0; cur = null; return res;
  };
  b._update = function (bindGroup) {
    if (cur) {
      const g = cur.groups[bindGroup.name] ??= { checks: 0, bindings: 0, uniforms: 0, textures: 0 };
      g.checks++;
      for (const binding of bindGroup.bindings) {
        g.bindings++;
        if (binding.isUniformBuffer) {
          g.uniforms += binding.uniforms?.length ?? 0;
          if (bindGroup.name === 'object' || binding.name === 'object') for (const u of binding.uniforms ?? []) {
            const n = u.nodeUniform?.node; const label = `${u.name}:${n?.name || ''}:${n?.nodeType || u.constructor.name}:${n?.updateType || ''}:${n?.constructor?.name || ''}`;
            cur.objU.set(label, (cur.objU.get(label) ?? 0) + 1);
          }
        } else if (binding.isSampledTexture) g.textures++;
      }
    }
    return oU.apply(this, arguments);
  };
  nodes.updateForRender = function (ro) {
    const m = mats.get(key(ro)); const t0 = performance.now(); const res = oN.apply(this, arguments);
    if (m) { m.nodeT += performance.now() - t0; m.updateNodes += this.getForRender?.(ro)?.updateNodes?.length ?? 0; }
    return res;
  };
  await new Promise(res => { const t0 = performance.now(); const tick = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
  b.updateForRender = oUFR; b._update = oU; nodes.updateForRender = oN;
  const rows = [...mats].map(([k, v]) => ({
    k, draws: +(v.draws / frames).toFixed(1), bindMsPerFrame: +(v.t / frames).toFixed(3), nodeMsPerFrame: +(v.nodeT / frames).toFixed(3),
    updateNodesPerDraw: +(v.updateNodes / Math.max(1, v.draws)).toFixed(1),
    groups: Object.fromEntries(Object.entries(v.groups).map(([g, e]) => [g, { checksPerDraw: +(e.checks / v.draws).toFixed(2), uniformsPerCheck: +(e.uniforms / e.checks).toFixed(1), texturesPerCheck: +(e.textures / e.checks).toFixed(1) }])),
    objectUniforms: [...v.objU].map(([l, c]) => `${l} x${(c / v.draws).toFixed(2)}`),
  })).sort((a, b2) => (b2.bindMsPerFrame + b2.nodeMsPerFrame) - (a.bindMsPerFrame + a.nodeMsPerFrame));
  const { treeImpostorIntegrity } = await import('/src/editor/stylized/impostor/TreeImpostorIntegrity.js');
  return { frames, rows, backend: window.__editor.terrainView.rendererBackendStatus.mode,
    readiness: window.__editor.stylizedSurface.getPreparationStatus(),
    assetIntegrity: treeImpostorIntegrity(window.__editor.stylizedSurface.treeView) };
});
result.capture = { focus: await captureFocus(), browserErrors: browserErrors.snapshot() };
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1));
assert.equal(result.backend, 'webgpu');
assert.equal(result.readiness.ready, true);
assert.equal(result.assetIntegrity.ready, true);
assert.equal(result.capture.browserErrors.count, 0);
assert.equal(result.capture.focus.passed, true);
if (result.error) { console.log(JSON.stringify(result)); } else {
  console.log('frames', result.frames);
  for (const row of result.rows.slice(0, 40)) console.log(`${row.k.padEnd(40)} draws ${String(row.draws).padStart(6)} bind ${row.bindMsPerFrame} node ${row.nodeMsPerFrame} updNodes/draw ${row.updateNodesPerDraw} ${JSON.stringify(row.groups)}`);
}
} finally {
  try { await browser?.close(); } finally { release(); }
}
