import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=default',
    '--enable-gpu-rasterization', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const pipelineErrors = [];
const nanErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('vertex buffers')) pipelineErrors.push(t);
  else if (t.includes('NaN')) nanErrors.push(t);
});
page.on('pageerror', (e) => nanErrors.push(`PAGEERROR: ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load', timeout: 120000 });
console.log('loaded, waiting for terrain + vegetation to stream...');
await delay(30000);

const report = await page.evaluate(() => {
  const scene = window.__editor?.stylizedSurface?.root?.parent
    ?? window.__editor?.controller?.scene
    ?? null;
  const out = { meshes: 0, worst: [], nanGeometries: [], nanMatrices: [] };
  const roots = [];
  // Walk from every known scene-ish root we can reach.
  const seen = new Set();
  const visit = (obj) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    if (obj.isMesh && obj.geometry) {
      const attrs = Object.keys(obj.geometry.attributes ?? {});
      const buffers = attrs.length + (obj.isInstancedMesh ? 1 : 0);
      out.meshes += 1;
      out.worst.push({ name: obj.name || obj.type, buffers, attrs });
      const pos = obj.geometry.attributes?.position;
      if (pos && pos.array.some ? false : false) { /* skip */ }
      if (pos) {
        const a = pos.array;
        for (let i = 0; i < a.length; i += 1) {
          if (!Number.isFinite(a[i])) { out.nanGeometries.push(obj.name || obj.type); break; }
        }
      }
      if (obj.isInstancedMesh && obj.instanceMatrix) {
        const a = obj.instanceMatrix.array;
        const limit = Math.min(a.length, obj.count * 16);
        for (let i = 0; i < limit; i += 1) {
          if (!Number.isFinite(a[i])) { out.nanMatrices.push(obj.name || obj.type); break; }
        }
      }
      for (const [key, attr] of Object.entries(obj.geometry.attributes ?? {})) {
        if (!key.startsWith('instance')) continue;
        const a = attr.array;
        const limit = Math.min(a.length, (obj.count ?? 0) * attr.itemSize);
        for (let i = 0; i < limit; i += 1) {
          if (!Number.isFinite(a[i])) { out.nanMatrices.push(`${obj.name || obj.type}.${key}`); break; }
        }
      }
    }
    for (const child of obj.children ?? []) visit(child);
  };
  let node = window.__editor?.stylizedSurface?.root ?? null;
  while (node?.parent) node = node.parent;
  if (node) roots.push(node);
  for (const r of roots) visit(r);
  out.worst.sort((a, b) => b.buffers - a.buffers);
  out.worst = out.worst.slice(0, 6);
  out.nanGeometries = [...new Set(out.nanGeometries)].slice(0, 8);
  out.nanMatrices = [...new Set(out.nanMatrices)].slice(0, 8);
  return out;
});

console.log('meshes walked:', report.meshes);
console.log('highest vertex-buffer users:');
for (const m of report.worst) console.log('  ', m.buffers, m.name, '->', m.attrs.join(','));
console.log('geometries with NaN positions:', report.nanGeometries.length ? report.nanGeometries : 'none');
console.log('instance buffers with NaN:', report.nanMatrices.length ? report.nanMatrices : 'none');
console.log('PIPELINE ERRORS (vertex buffers):', pipelineErrors.length);
console.log('NaN console errors:', nanErrors.length, nanErrors.slice(0, 3));

await browser.close();
process.exit(0);
