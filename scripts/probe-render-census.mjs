// Diagnostic probe for docs/plans/performance-plan-2026-11-10.md. Needs `npm run dev` serving; not a frame-pacing measurement.
// Usage: node scripts/probe-render-census.mjs <qa-scenario> "<extra query>" <out.json> [baseUrl]
import fs from 'node:fs';
import { chromium } from 'playwright';
const [qa, extra, out, base = 'http://localhost:5173'] = process.argv.slice(2);
const url = `${base}/?qa=${qa}&warmup=900&duration=5&download=0&autostart=1${extra ?? ''}`;
const browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(240000);
await page.goto(url, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__perfQa != null && window.__editor?.terrainView?.renderer);
await page.waitForTimeout(75000);
const result = await page.evaluate(async () => {
  const tv = window.__editor.terrainView; const r = tv.renderer;
  const g = new Map(); let frames = 0;
  const orig = r._renderObjectDirect;
  r._renderObjectDirect = function (object, material, scene, camera, lightsNode, clippingContext, group, passId) {
    const rt = r.getRenderTarget();
    const pass = `${rt ? (rt.texture?.name || rt.name || 'rt') + ' ' + rt.width + 'x' + rt.height : 'canvas'}|${passId ?? ''}|${camera?.isOrthographicCamera ? 'ortho' : 'persp'}`;
    const geo = object.geometry; const n = geo?.index ? geo.index.count : (geo?.attributes?.position?.count ?? 0);
    const dr = geo?.drawRange; const cnt = Math.min(n, dr && Number.isFinite(dr.count) ? dr.count : n);
    const inst = object.isInstancedMesh ? object.count : (geo?.isInstancedBufferGeometry && Number.isFinite(geo.instanceCount) ? geo.instanceCount : 1);
    let o = object; let nm = '';
    for (let i = 0; i < 4 && o && !nm; i++, o = o.parent) nm = o.name;
    nm = (nm || material?.name || object.constructor.name).replace(/[-_:\s]?-?\d+([,.:_-]-?\d+)*/g, '').slice(0, 44);
    const key = pass + ' :: ' + nm;
    const e = g.get(key) ?? { draws: 0, tris: 0, uniforms: 0 };
    e.draws++; e.tris += cnt / 3 * inst; g.set(key, e);
    return orig.apply(this, arguments);
  };
  await new Promise(res => { const t0 = performance.now(); const tick = () => { frames++; performance.now() - t0 < 3000 ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); });
  r._renderObjectDirect = orig;
  const rows = [...g].map(([k, v]) => ({ k, draws: +(v.draws / frames).toFixed(2), ktris: Math.round(v.tris / frames / 1000) })).sort((a, b) => b.draws - a.draws);
  const byPass = {};
  for (const row of rows) { const p = row.k.split(' :: ')[0]; const e = byPass[p] ??= { draws: 0, ktris: 0 }; e.draws += row.draws; e.ktris += row.ktris; }
  const tree=window.__editor.stylizedSurface.treeView;
  const records=[...(tree.manifestStore?.cache.values()??[])].flatMap(entry=>entry.placements??[]);
  const residentPrototypeIndices=[...new Set(records.map(record=>tree.resolvePalettePrototypeIndex(record)))].sort((a,b)=>a-b);
  const byTileId={};
  for(const record of records) {
    const tile=tree.tileIdAt(record.x,record.z),index=tree.resolvePalettePrototypeIndex(record);
    const entry=byTileId[tile]??={records:0,prototypeIndices:[]};entry.records++;
    if(!entry.prototypeIndices.includes(index))entry.prototypeIndices.push(index);
  }
  for(const entry of Object.values(byTileId))entry.prototypeIndices.sort((a,b)=>a-b);
  const trees={prototypeCount:tree.prototypes.length,residentRecords:records.length,residentPrototypeIndices,
    byTileId,byAsset:Object.fromEntries(tree.prototypeIndicesByAsset),impostors:tree.impostorAtlases.length};
  return { frames, mode: window.__editor.viewModeController.mode, status: window.__perfQa.status, info: { ...r.info.render }, trees, byPass, rows };
});
fs.writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ frames: result.frames, mode: result.mode, status: result.status, info: result.info, byPass: result.byPass }, null, 1));
for (const row of result.rows.slice(0, 70)) console.log(String(row.draws).padStart(7), String(row.ktris).padStart(7) + 'k', row.k);
await browser.close();
