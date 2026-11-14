import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { excavatedTunnel } from '../src/editor/locations/gen/excavatedTunnel.js';
import { extractSurface } from '../src/editor/locations/gen/SurfaceNets.js';
import { LOCATION_GENERATORS } from '../src/editor/locations/generators/index.js';
import { generateLocation } from '../src/editor/locations/LocationBuilder.js';
import { resolveLocationCatalog } from '../src/editor/locations/LocationCatalog.js';

const source = yaml.load(fs.readFileSync(new URL('../config/instanced-locations.yaml', import.meta.url), 'utf8'));
const catalog = resolveLocationCatalog(source, { generatorKeys: Object.keys(LOCATION_GENERATORS), quality: 'low' });

function probeWidthAndRoof(shape, x, floorY, z) {
  let left = 0;
  while (left < 5 && shape.air(x - left, floorY + 1.4, z) > 0) left += 0.05;
  let right = 0;
  while (right < 5 && shape.air(x + right, floorY + 1.4, z) > 0) right += 0.05;
  let roof = 0.2;
  while (roof < 6 && shape.air(x, floorY + roof, z) > 0) roof += 0.05;
  return { left, right, roof };
}

test('excavatedTunnel is deterministic and seed-sensitive', () => {
  const pts = [{ x: 0, y: 0, z: 6 }, { x: 0, y: -1, z: -40 }];
  const a = excavatedTunnel(pts, { width: 3.6, height: 3.2, seed: 4107 });
  const b = excavatedTunnel(pts, { width: 3.6, height: 3.2, seed: 4107 });
  const c = excavatedTunnel(pts, { width: 3.6, height: 3.2, seed: 9999 });

  for (let z = -35; z <= 0; z += 3.5) {
    for (const x of [-1.7, -0.5, 0.8, 1.7]) {
      for (const y of [0.2, 1.5, 2.8]) {
        assert.equal(a.air(x, y, z), b.air(x, y, z));
      }
    }
  }
  let diffs = 0;
  for (let z = -35; z <= 0; z += 2) {
    if (Math.abs(a.air(1.7, 1.6, z) - c.air(1.7, 1.6, z)) > 0.05) diffs += 1;
  }
  assert.ok(diffs > 3, 'different seeds produce different wall profiles');
});

test('longitudinal cross-sections vary with asymmetric walls and independent ceiling', () => {
  const shape = excavatedTunnel(
    [{ x: 0, y: 0, z: 6 }, { x: 0, y: -1, z: -40 }],
    { width: 3.6, height: 3.2, seed: 4208, clearance: { left: 1.82, right: 1.48, height: 2.45 } },
  );
  const samples = [];
  for (let i = 0; i < 8; i += 1) {
    const z = -4 - i * 4;
    const floorY = -1 * ((6 - z) / 46);
    samples.push(probeWidthAndRoof(shape, 0, floorY, z));
  }

  let asymmetricCount = 0;
  const roofs = samples.map((s) => s.roof);
  const rights = samples.map((s) => s.right);
  for (const s of samples) {
    if (Math.abs(s.left - s.right) > 0.12) asymmetricCount += 1;
  }
  assert.ok(asymmetricCount >= 3, `walls are asymmetric along the tunnel (got ${asymmetricCount}/8)`);
  assert.ok(Math.max(...roofs) - Math.min(...roofs) > 0.25, 'ceiling height varies meaningfully');
  assert.ok(Math.max(...rights) - Math.min(...rights) > 0.25, 'tunnel width varies meaningfully');
});

test('showcase-deep-workings respects rail/nav clearances, curved bends, and watertight winding', () => {
  const site = catalog.site('showcase-deep-workings');
  const builder = generateLocation(site, LOCATION_GENERATORS[site.generatorKey]);

  // 1. Haulage drift rail & walker clearance from z = 4 down to z = -39
  for (let z = -39; z <= 4; z += 1.5) {
    const t = (6 - z) / 46;
    const floorY = -t;
    for (const x of [-1.6, -0.9, -0.2, 0.5, 1.2]) {
      for (const dy of [0.35, 1.2, 2.0]) {
        assert.ok(
          builder.grid.sample(x, floorY + dy, z) > 0,
          `haulage clearance violated at (${x}, ${(floorY + dy).toFixed(2)}, ${z})`,
        );
      }
    }
    assert.ok(builder.nav.surfaceAt(0, z, floorY + 0.4) !== null, `haulage nav connected at z=${z}`);
  }

  // 2. Curved west gallery bend stays walkable and open
  for (const p of [{ x: -12, y: -1.3, z: -49 }, { x: -20, y: -2, z: -52 }, { x: -26, y: -2.6, z: -57 }]) {
    assert.ok(builder.grid.sample(p.x, p.y + 1.2, p.z) > 0, `west bend open at (${p.x}, ${p.z})`);
    assert.ok(builder.nav.surfaceAt(p.x, p.z, p.y + 0.5) !== null, `west bend walkable at (${p.x}, ${p.z})`);
  }

  // 3. Mesh topology, non-NaN vertices, and consistent inward-facing normals
  const surface = extractSurface(builder.grid);
  const { positions: p, normals: n, indices: idx } = surface;
  for (let i = 0; i < p.length; i += 1) {
    assert.ok(Number.isFinite(p[i]) && Number.isFinite(n[i]), 'vertex attributes are finite');
  }
  let badWinding = 0;
  let degenerate = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < 1e-8) degenerate += 1;
    const dot = cx * (n[a] + n[b] + n[c]) + cy * (n[a + 1] + n[b + 1] + n[c + 1]) + cz * (n[a + 2] + n[b + 2] + n[c + 2]);
    if (dot < 0) badWinding += 1;
  }
  assert.equal(badWinding, 0, 'all triangles are wound toward their normals');
  assert.equal(degenerate, 0, 'no degenerate zero-area triangles');
});
