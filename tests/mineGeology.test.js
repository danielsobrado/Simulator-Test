import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { DensityGrid } from '../src/editor/locations/gen/DensityGrid.js';
import { computeFloorContext, createMineGeologyClassifier } from '../src/editor/locations/gen/mineGeology.js';
import { resolveMineGeologyConfig } from '../src/editor/locations/gen/mineGeologyConfig.js';
import { extractSurface } from '../src/editor/locations/gen/SurfaceNets.js';
import { LOCATION_GENERATORS } from '../src/editor/locations/generators/index.js';
import { generateLocation } from '../src/editor/locations/LocationBuilder.js';
import { resolveLocationCatalog } from '../src/editor/locations/LocationCatalog.js';

const source = yaml.load(fs.readFileSync(new URL('../config/instanced-locations.yaml', import.meta.url), 'utf8'));
const catalog = resolveLocationCatalog(source, { generatorKeys: Object.keys(LOCATION_GENERATORS), quality: 'low' });

test('resolveMineGeologyConfig provides defaults and validates bounds', () => {
  const defaults = resolveMineGeologyConfig();
  assert.ok(defaults.zoneScale > 0 && defaults.wallBlendWidth > 0);
  assert.throws(() => resolveMineGeologyConfig({ zoneScale: -1 }), /zoneScale/);
  assert.throws(() => resolveMineGeologyConfig({ wetnessGain: Number.NaN }), /wetnessGain/);
});

test('showcase-deep-workings produces deterministic, bounded geological and ground masks', () => {
  const site = catalog.site('showcase-deep-workings');
  const generator = LOCATION_GENERATORS[site.generatorKey];
  const builderA = generateLocation(site, generator);
  const builderB = generateLocation(site, generator);

  const maskA = new Float32Array(4);
  const maskA2 = new Float32Array(4);
  const maskB = new Float32Array(4);
  const maskB2 = new Float32Array(4);

  const samplePoints = [
    [{ x: 0.6, y: -0.4, z: -15 }, { x: 0, y: 1, z: 0 }],
    [{ x: -0.9, y: -0.5, z: -20 }, { x: 0, y: 1, z: 0 }],
    [{ x: 1.8, y: 1.1, z: -22 }, { x: -1, y: 0, z: 0 }],
    [{ x: -34, y: -2.8, z: -61 }, { x: 0.7, y: 0.7, z: 0 }],
    [{ x: 0, y: -8.6, z: -82 }, { x: 0, y: 1, z: 0 }],
  ];

  for (const [p, n] of samplePoints) {
    builderA.classify(p, n, maskA, maskA2);
    builderB.classify(p, n, maskB, maskB2);
    for (let i = 0; i < 4; i += 1) {
      assert.equal(maskA[i], maskB[i], `mask[${i}] is deterministic at (${p.x}, ${p.y}, ${p.z})`);
      assert.equal(maskA2[i], maskB2[i], `mask2[${i}] is deterministic at (${p.x}, ${p.y}, ${p.z})`);
      assert.ok(Number.isFinite(maskA[i]) && maskA[i] >= 0 && maskA[i] <= 1, `mask[${i}] in [0,1]`);
      assert.ok(Number.isFinite(maskA2[i]) && maskA2[i] >= 0 && maskA2[i] <= 1, `mask2[${i}] in [0,1]`);
    }
  }
});

test('mine floor classification separates rails, walkways, walls, and localized wetness', () => {
  const site = catalog.site('showcase-deep-workings');
  const builder = generateLocation(site, LOCATION_GENERATORS[site.generatorKey]);

  const mask = new Float32Array(4);
  const mask2 = new Float32Array(4);

  // Rail bed in haulage drift should have high gravel/ballast (mask2[2]) and stay mostly dry.
  builder.classify({ x: -0.9, y: -0.45, z: -18 }, { x: 0, y: 1, z: 0 }, mask, mask2);
  const railGravel = mask2[2];
  const driftWetness = mask[1];
  assert.ok(railGravel > 0.35, `rail bed receives ballast mask (got ${railGravel})`);
  assert.ok(driftWetness < 0.25, `upper haulage drift remains predominantly dry (got ${driftWetness})`);

  // Steep wall should receive zero floor gravel (mask2[2] ~ 0).
  builder.classify({ x: 1.85, y: 1.2, z: -18 }, { x: -1, y: 0, z: 0 }, mask, mask2);
  assert.ok(mask2[2] < 0.05, `steep wall does not receive floor gravel (got ${mask2[2]})`);

  // Continuity across the z = -28 chunk boundary for both geological zone and ground masks.
  const zBefore = new Float32Array(4);
  const zAfter = new Float32Array(4);
  const mBefore = new Float32Array(4);
  const mAfter = new Float32Array(4);
  builder.classify({ x: 1.8, y: 1.0, z: -27.95 }, { x: -1, y: 0, z: 0 }, mBefore, zBefore);
  builder.classify({ x: 1.8, y: 1.0, z: -28.05 }, { x: -1, y: 0, z: 0 }, mAfter, zAfter);
  assert.ok(Math.abs(zBefore[0] - zAfter[0]) < 0.05, 'geological zone is continuous across z=-28 chunk boundary');
  builder.classify({ x: 0.7, y: -0.74, z: -27.95 }, { x: 0, y: 1, z: 0 }, mBefore, zBefore);
  builder.classify({ x: 0.7, y: -0.74, z: -28.05 }, { x: 0, y: 1, z: 0 }, mAfter, zAfter);
  for (let i = 0; i < 4; i += 1) {
    assert.ok(Math.abs(zBefore[i] - zAfter[i]) < 0.08, `floor mask2[${i}] is continuous across z=-28 boundary`);
  }

  // Lower flooded level is noticeably damper than upper drift.
  builder.classify({ x: 0, y: -8.8, z: -83 }, { x: 0, y: 1, z: 0 }, mask, mask2);
  assert.ok(mask[1] > 0.45, `flooded lower level is damp (got ${mask[1]})`);

  // Build full mesh and verify surfMask2 and rock_debris prop mesh exist with finite attributes.
  const material = new THREE.MeshBasicMaterial();
  const materials = Object.fromEntries(Object.keys(site.materials).map((key) => [key, { material, ice: 0 }]));
  const group = builder.build({ materials, absorption: site.lighting.absorption });
  let meshCount = 0;
  let hasSurfMask2 = false;
  group.traverse((obj) => {
    if (!obj.geometry) return;
    meshCount += 1;
    const sm2 = obj.geometry.attributes.surfMask2;
    if (sm2) {
      hasSurfMask2 = true;
      for (let i = 0; i < sm2.array.length; i += 1) {
        assert.ok(Number.isFinite(sm2.array[i]), 'surfMask2 attribute contains finite numbers');
      }
    }
  });
  assert.ok(meshCount >= 2 && hasSurfMask2, 'built mine has chunked terrain with surfMask2 and merged props');
});

test('curved lower chamber walls and ore mound crowns stay bare rock while true floor zones differentiate', () => {
  const site = catalog.site('showcase-deep-workings');
  const builder = generateLocation(site, LOCATION_GENERATORS[site.generatorKey]);
  const mask = new Float32Array(4);
  const mask2 = new Float32Array(4);

  // 1. Curved lower walls in hub, stope, and flooded chambers >0.5m above floorY with ny in 0.45..0.70.
  const chamberWallProbes = [
    ['hub', { x: 8.5, y: -0.35, z: -50 }, { x: -0.78, y: 0.62, z: 0 }],
    ['stope', { x: -29.8, y: -2.35, z: -62 }, { x: -0.80, y: 0.60, z: 0 }],
    ['flooded', { x: 6.5, y: -8.35, z: -86 }, { x: -0.82, y: 0.57, z: 0 }],
  ];
  for (const [name, p, n] of chamberWallProbes) {
    builder.classify(p, n, mask, mask2);
    assert.equal(mask2[1], 0, `${name} curved lower wall gets mask2[1] === 0`);
    assert.equal(mask2[2], 0, `${name} curved lower wall gets mask2[2] === 0`);
    assert.equal(mask2[3], 0, `${name} curved lower wall gets mask2[3] === 0`);
  }

  // Also verify every extracted surface vertex on hub/stope/flooded curved lower walls (>0.5m above floorY, ny 0.45..0.70).
  const surface = extractSurface(builder.grid);
  const chambers = [
    { name: 'hub', x: 0, z: -50, rx: 12, rz: 11, floorY: -1 },
    { name: 'stope', x: -36, z: -62, rx: 8, rz: 7, floorY: -3 },
    { name: 'flooded', x: 0, z: -86, rx: 9, rz: 7, floorY: -9 },
  ];
  let checkedChamberWallVerts = 0;
  for (let i = 0; i < surface.positions.length; i += 3) {
    const p = { x: surface.positions[i], y: surface.positions[i + 1], z: surface.positions[i + 2] };
    const n = { x: surface.normals[i], y: surface.normals[i + 1], z: surface.normals[i + 2] };
    if (n.y < 0.45 || n.y > 0.70) continue;
    for (const ch of chambers) {
      if (ch.name === 'hub' && p.x > 6.5 && p.z > -49) continue; // Ascending east tunnel mouth
      const r = Math.hypot((p.x - ch.x) / ch.rx, (p.z - ch.z) / ch.rz);
      if (r <= 1.0 && p.y - ch.floorY > 0.52) {
        checkedChamberWallVerts += 1;
        builder.classify(p, n, mask, mask2);
        assert.equal(mask2[1], 0, `${ch.name} mesh wall vertex mask2[1] === 0 at y=${p.y.toFixed(2)}`);
        assert.equal(mask2[2], 0, `${ch.name} mesh wall vertex mask2[2] === 0 at y=${p.y.toFixed(2)}`);
        assert.equal(mask2[3], 0, `${ch.name} mesh wall vertex mask2[3] === 0 at y=${p.y.toFixed(2)}`);
      }
    }
  }
  assert.ok(checkedChamberWallVerts > 50, `verified ${checkedChamberWallVerts} curved chamber lower wall vertices`);

  // 2. True floor differentiation: rail bed (gravel/ballast) vs walking lane (earth + floor domain) vs wall-base fillet (skirt).
  builder.classify({ x: -0.9, y: -0.52, z: -18 }, { x: 0, y: 1, z: 0 }, mask, mask2);
  const railGravel = mask2[2];
  const railDomain = mask2[3];
  assert.ok(railGravel > 0.45, `rail bed has strong gravel/ballast (got ${railGravel})`);
  assert.ok(railDomain >= 0.5, `rail bed activates floor domain mask2[3] (got ${railDomain})`);

  // Sample walking lane across several z stations to capture non-bedrock earth stretch vs rail bed.
  let maxWalkEarth = 0;
  let minWalkGravel = 1;
  for (let z = -10; z >= -34; z -= 4) {
    const floorY = -(6 - z) / 46;
    builder.classify({ x: 0.75, y: floorY, z }, { x: 0, y: 1, z: 0 }, mask, mask2);
    if (mask2[1] > maxWalkEarth) maxWalkEarth = mask2[1];
    if (mask2[2] < minWalkGravel) minWalkGravel = mask2[2];
    assert.ok(mask2[3] >= 0.5, `walking lane activates floor domain at z=${z} (got ${mask2[3]})`);
  }
  assert.ok(maxWalkEarth > 0.35, `walking lane carries compacted earth cover (got ${maxWalkEarth})`);
  assert.ok(minWalkGravel < railGravel * 0.5, `walking lane gravel (${minWalkGravel}) is much lower than rail bed (${railGravel})`);

  // Wall-base fillet vertices (0.08..0.40m above floor, ny in 0.45..0.70) receive skirt without walking earth.
  let filletHits = 0;
  for (let i = 0; i < surface.positions.length; i += 3) {
    const p = { x: surface.positions[i], y: surface.positions[i + 1], z: surface.positions[i + 2] };
    const n = { x: surface.normals[i], y: surface.normals[i + 1], z: surface.normals[i + 2] };
    if (p.z > -38 && p.z < 2 && n.y >= 0.45 && n.y <= 0.70) {
      const floorY = -(6 - p.z) / 46;
      const above = p.y - floorY;
      if (above >= 0.08 && above <= 0.38) {
        builder.classify(p, n, mask, mask2);
        if (mask2[3] > 0.02) {
          filletHits += 1;
          assert.ok(mask2[1] < mask2[3], 'wall-base fillet stays skirt-dominated rather than flat walking earth');
        }
      }
    }
  }
  assert.ok(filletHits > 10, `wall-base fillets receive skirt accumulation (got ${filletHits})`);

  // 3. Raised ore mound: gravel/talus stays near base while crown suppresses compacted walking earth.
  builder.classify({ x: -33, y: -2.80, z: -59 }, { x: 0, y: 1, z: 0 }, mask, mask2);
  const moundBaseGravel = mask2[2];
  const moundBaseEarth = mask2[1];
  assert.ok(moundBaseGravel > 0.2, `ore mound base apron keeps gravel/talus (got ${moundBaseGravel})`);
  assert.ok(moundBaseEarth < 0.25, `ore mound suppresses compacted earth above 0.14m (got ${moundBaseEarth})`);

  builder.classify({ x: -33, y: -2.35, z: -59 }, { x: 0, y: 1, z: 0 }, mask, mask2);
  assert.equal(mask2[1], 0, 'ore mound crown has zero compacted earth');
  assert.equal(mask2[2], 0, 'ore mound crown has zero gravel');
  assert.equal(mask2[3], 0, 'ore mound crown has zero floor skirt');
});

test('computeFloorContext and classifier support grid-probe fallback when passages and rooms are omitted', () => {
  const grid = new DensityGrid({ min: { x: -4, y: -2, z: -4 }, max: { x: 4, y: 4, z: 4 }, voxel: 0.25 });
  grid.carve({
    box: { min: { x: -3, y: 0, z: -3 }, max: { x: 3, y: 3, z: 3 } },
    air: (x, y, z) => Math.min(2.5 - Math.abs(x), 2.5 - Math.abs(z), y, 2.5 - y),
  });

  const onFloor = computeFloorContext(0, 0.02, 0, grid);
  const highOverhang = computeFloorContext(0, 2.4, 0, grid);
  assert.ok(onFloor.aboveFloor < 0.1, `fallback detects solid floor underneath (got ${onFloor.aboveFloor})`);
  assert.ok(highOverhang.aboveFloor >= 0.6, `fallback detects air gap underneath overhang/ceiling (got ${highOverhang.aboveFloor})`);

  const classify = createMineGeologyClassifier({ seed: 123, grid });
  const m1 = new Float32Array(4);
  const m2 = new Float32Array(4);
  classify({ x: 0, y: 0.02, z: 0 }, { x: 0, y: 1, z: 0 }, m1, m2);
  assert.ok(m2[3] > 0.5, 'fallback classifier still activates true floor domain');
  classify({ x: 0, y: 2.4, z: 0 }, { x: 0, y: 0.7, z: 0.7 }, m1, m2);
  assert.equal(m2[1], 0, 'fallback classifier suppresses floor earth on ceiling/overhang');
});
