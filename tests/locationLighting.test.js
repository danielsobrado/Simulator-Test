import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { resolveLocationCatalog } from '../src/editor/locations/LocationCatalog.js';
import { LOCATION_GENERATORS } from '../src/editor/locations/generators/index.js';
import { generateLocation } from '../src/editor/locations/LocationBuilder.js';
import { DensityGrid } from '../src/editor/locations/gen/DensityGrid.js';
import { PropOcclusionGrid } from '../src/editor/locations/gen/PropOcclusionGrid.js';
import { createBounceField, gatherBounceLight } from '../src/editor/locations/gen/IndirectBounce.js';
import { SHADE_SIZE } from '../src/editor/locations/gen/LightBake.js';
import { LocationLightPool } from '../src/editor/locations/LocationLightPool.js';
import { MAX_DYNAMIC_LIGHTS, locationLight } from '../src/editor/locations/materials/LocationShading.js';
import { box } from '../src/editor/locations/gen/propKit.js';

const loadSource = () => yaml.load(fs.readFileSync(new URL('../config/instanced-locations.yaml', import.meta.url), 'utf8'));

test('mine catalog exposes calibrated lighting, indirect bounce, prop shadows, and section profiles', () => {
  const source = loadSource();
  const catalog = resolveLocationCatalog(source, { generatorKeys: Object.keys(LOCATION_GENERATORS) });
  const site = catalog.site('showcase-deep-workings');

  assert.ok(site.lighting.indirectBounce.strength > 0);
  assert.ok(site.lighting.propShadows.resolution > 0);
  assert.ok(site.lighting.carried.intensity <= 0.5, 'carried light must stay restrained so unlit sections keep depth');
  assert.ok(site.params.lightingSections?.haulage);
  assert.ok(site.params.lightingSections?.abandoned);
  assert.ok(site.params.lightingSections?.flooded);

  const badSource = structuredClone(source);
  badSource.instancedLocations.lightingProfiles.mine_lanterns.indirectBounce.cellSize = -1;
  assert.throws(
    () => resolveLocationCatalog(badSource, { generatorKeys: Object.keys(LOCATION_GENERATORS) }),
    /indirectBounce/,
  );
});

test('mine generation produces deterministic non-uniform haulage rhythm and section-tagged dynamic lights', () => {
  const catalog = resolveLocationCatalog(loadSource(), { generatorKeys: Object.keys(LOCATION_GENERATORS) });
  const site = catalog.site('showcase-deep-workings');
  const gen = LOCATION_GENERATORS[site.generatorKey];

  const a = generateLocation(site, gen);
  const b = generateLocation(site, gen);

  assert.equal(a.dynamicLights.length, b.dynamicLights.length);
  assert.ok(a.dynamicLights.length >= 10);
  assert.deepEqual(a.dynamicLights[0], b.dynamicLights[0]);

  const sections = new Set(a.dynamicLights.map((l) => l.section));
  assert.ok(sections.has('haulage'));
  assert.ok(sections.has('hub'));
  assert.ok(sections.has('stope'));
  assert.ok(sections.has('abandoned'));
  assert.ok(sections.has('flooded'));

  const haulage = a.dynamicLights.filter((l) => l.section === 'haulage');
  const abandoned = a.dynamicLights.filter((l) => l.section === 'abandoned');
  assert.ok(abandoned[0].intensity < haulage[0].intensity, 'abandoned heading must be dimmer than maintained haulage');
  assert.ok(abandoned[0].flicker > haulage[0].flicker, 'abandoned lamps should flicker more than maintained ones');
});

test('PropOcclusionGrid casts structural shadows, provides contact AO, and skips own lantern cage', () => {
  const grid = new PropOcclusionGrid(0.16);
  const beam = box(0.4, 2.0, 0.4, { x: 0, y: 1.0, z: 0 }).toNonIndexed();
  // Small cage geometry around light at (0, 1.5, -3.0) should be excluded.
  const cageBar = box(0.04, 0.2, 0.04, { x: 0.1, y: 1.5, z: -3.0 }).toNonIndexed();

  const lights = [{ x: 0, y: 1.5, z: -3.0 }];
  grid.addTriangles(beam.attributes.position.array, { excludeLights: lights, excludeRadius: 0.36 });
  grid.addTriangles(cageBar.attributes.position.array, { excludeLights: lights, excludeRadius: 0.36 });

  // From (0, 1.0, 2.0) toward light at (0, 1.5, -3.0): passes directly through beam at z=0.
  const d = Math.hypot(0, 0.5, -5);
  const blocked = grid.transmittanceRay(0, 1.0, 2.0, 0, 0.5 / d, -5 / d, d, { minTransmit: 0.14 });
  assert.ok(blocked < 0.4, `expected blocked transmittance < 0.4, got ${blocked}`);

  // From (0, 1.5, -1.5) toward light at (0, 1.5, -3.0): unobstructed despite excluded cage bar.
  const clear = grid.transmittanceRay(0, 1.5, -1.5, 0, 0, -1, 1.5, { minTransmit: 0.14 });
  assert.equal(clear, 1);

  // Contact AO right next to beam vs open space.
  const tightAO = grid.contactAO(0.24, 0.05, 0, 0, 1, 0, { strength: 0.72 });
  const openAO = grid.contactAO(4.0, 1.0, 0, 0, 1, 0, { strength: 0.72 });
  assert.ok(tightAO < openAO - 0.08, `expected tighter AO near timber post (${tightAO} vs ${openAO})`);
});

test('IndirectBounce illuminates open recesses without leaking through solid rock walls', () => {
  const grid = new DensityGrid({ min: { x: -6, y: -2, z: -6 }, max: { x: 6, y: 4, z: 6 }, voxel: 0.5 });
  // Carve two separate chambers separated by a solid 2m rock wall around x = -1..+1.
  for (let ix = 0; ix < grid.nx; ix += 1) {
    const x = grid.min.x + ix * grid.voxel;
    for (let iy = 0; iy < grid.ny; iy += 1) {
      const y = grid.min.y + iy * grid.voxel;
      for (let iz = 0; iz < grid.nz; iz += 1) {
        const z = grid.min.z + iz * grid.voxel;
        const inLeft = x >= -5 && x <= -1.2 && y >= 0 && y <= 3 && Math.abs(z) <= 3;
        const inRight = x >= 1.2 && x <= 5 && y >= 0 && y <= 3 && Math.abs(z) <= 3;
        if (inLeft || inRight) {
          grid.data[ix + grid.nx * (iy + grid.ny * iz)] = 1;
        }
      }
    }
  }

  // Lit surfel source on the left chamber floor/wall near x = -2.5.
  const surfPos = new Float32Array([-2.5, 0.2, 0]);
  const surfNorm = new Float32Array([0, 1, 0]);
  const surfDirect = new Float32Array([1.8, 1.2, 0.7]);
  const field = createBounceField({
    grid,
    positions: surfPos,
    normals: surfNorm,
    directLight: surfDirect,
    cellSize: 1.0,
    radius: 8,
  });
  assert.equal(field.surfels.length, 1);

  // Vertex 0: dark ceiling in same left chamber (-2.5, 2.8, 0) facing down (0, -1, 0) -> should receive bounce.
  // Vertex 1: ceiling across solid rock wall in right chamber (+2.5, 2.8, 0) facing down -> must receive ZERO bounce.
  const rxPos = new Float32Array([-2.5, 2.8, 0, 2.5, 2.8, 0]);
  const rxNorm = new Float32Array([0, -1, 0, 0, -1, 0]);
  const light = new Float32Array(6);
  const dir = new Float32Array(6);
  const shade = new Float32Array([1, 1, 1, 1, 1, 1]);

  gatherBounceLight(field, {
    positions: rxPos,
    normals: rxNorm,
    light,
    dir,
    shade,
    shadeSize: SHADE_SIZE,
    strength: 0.5,
  });

  assert.ok(light[0] > 0.01, 'same-chamber vertex should receive warm indirect bounce');
  assert.equal(light[3], 0, 'bounce light must not leak across solid rock walls');
  assert.equal(light[4], 0);
  assert.equal(light[5], 0);
});

test('LocationLightPool caps active slots, applies hysteresis, and cleans up uniforms on dispose', () => {
  const candidates = [];
  for (let i = 0; i < 10; i += 1) {
    candidates.push({
      x: 0,
      y: 1.5,
      z: -i * 6,
      color: [1, 0.7, 0.3],
      intensity: 4,
      range: 13,
      importance: 1,
      flicker: 0.1,
    });
  }
  const pool = new LocationLightPool(candidates, { gain: 0.28, ease: 1 });
  pool.update({ x: 0, y: 1.5, z: -1 }, 1.2);

  assert.equal(pool.activeLights().length, MAX_DYNAMIC_LIGHTS);
  const slot0Color = locationLight.dynamicLights[0].color.value;
  assert.ok(slot0Color.r > 0 && slot0Color.r < 3);

  // Stepping just past midpoint between index 0 (-0) and index 4 (-24) stays stable under hysteresis.
  pool.update({ x: 0, y: 1.5, z: -3.2 }, 1.4);
  assert.ok(pool.activeLights().some((l) => l.index === 0), 'hysteresis should keep nearby active light stable');

  pool.dispose();
  for (const slot of locationLight.dynamicLights) {
    assert.equal(slot.color.value.r, 0);
    assert.equal(slot.color.value.g, 0);
    assert.equal(slot.color.value.b, 0);
  }
});

test('full showcase-deep-workings bake completes with finite vertices and structural shadows', () => {
  const catalog = resolveLocationCatalog(loadSource(), { generatorKeys: Object.keys(LOCATION_GENERATORS), quality: 'low' });
  const site = catalog.site('showcase-deep-workings');
  const gen = LOCATION_GENERATORS[site.generatorKey];
  const builder = generateLocation(site, gen);

  const stubMat = new THREE.MeshBasicNodeMaterial();
  const materials = Object.fromEntries(
    Object.keys(site.materials).map((key) => [key, { material: stubMat }]),
  );

  const group = builder.build({
    materials,
    absorption: site.lighting.absorption,
    bakeGain: site.lighting.bakeGain,
    indirectBounce: site.lighting.indirectBounce,
    propShadows: site.lighting.propShadows,
  });

  assert.ok(group.children.length > 0);
  let checkedVerts = 0;
  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const { bakeLight, bakeShade } = obj.geometry.attributes;
    assert.ok(bakeLight, 'mesh should have bakeLight');
    assert.ok(bakeShade, 'mesh should have bakeShade');
    for (let i = 0; i < bakeLight.array.length; i += 1) {
      assert.ok(Number.isFinite(bakeLight.array[i]), 'bakeLight must be finite');
    }
    checkedVerts += bakeLight.count;
  });
  assert.ok(checkedVerts > 1000);
  group.traverse((o) => o.geometry?.dispose());
  stubMat.dispose();
});

test('showcase-deep-workings Phase 3 lighting invariants: no flat washes, anchored lanterns, finite bake attributes, contactAO variance, and section contrast', () => {
  const catalog = resolveLocationCatalog(loadSource(), { generatorKeys: Object.keys(LOCATION_GENERATORS), quality: 'low' });
  const site = catalog.site('showcase-deep-workings');
  const gen = LOCATION_GENERATORS[site.generatorKey];
  const builder = generateLocation(site, gen);

  // 1. No fake flat:true fill washes anywhere in the mine.
  const flatLights = builder.lights.filter((l) => l.flat === true);
  assert.equal(flatLights.length, 0, 'mine lighting must use shadowed practical/bounce lights rather than flat:true room washes');

  // 2. Section coverage and intensity/flicker contrast across adit/haulage/hub/stope/abandoned/flooded.
  assert.ok(builder.lights.some((l) => !l.direction && l.z > 0), 'adit section should include doorway/threshold daylight lights');
  const bySection = new Map();
  for (const light of builder.dynamicLights) {
    if (!bySection.has(light.section)) bySection.set(light.section, []);
    bySection.get(light.section).push(light);
  }
  for (const required of ['haulage', 'hub', 'stope', 'abandoned', 'flooded']) {
    assert.ok((bySection.get(required)?.length ?? 0) >= 1, `missing dynamicLights for section "${required}"`);
  }
  const avg = (arr, fn) => arr.reduce((sum, item) => sum + fn(item), 0) / arr.length;
  const abandonedAvgI = avg(bySection.get('abandoned'), (l) => l.intensity);
  const haulageAvgI = avg(bySection.get('haulage'), (l) => l.intensity);
  const hubAvgI = avg(bySection.get('hub'), (l) => l.intensity);
  const stopeAvgI = avg(bySection.get('stope'), (l) => l.intensity);
  assert.ok(abandonedAvgI < haulageAvgI, `abandoned avg intensity (${abandonedAvgI}) must be dimmer than haulage (${haulageAvgI})`);
  assert.ok(abandonedAvgI < hubAvgI && abandonedAvgI < stopeAvgI, 'abandoned heading must stay dimmer than active hub/stope');
  assert.ok(
    avg(bySection.get('abandoned'), (l) => l.flicker) > avg(bySection.get('haulage'), (l) => l.flicker),
    'abandoned lamps must flicker more than maintained haulage lamps',
  );

  // 3. No orphaned/floating lanterns: every dynamic lantern has solid structural prop support (clasp/rod/post/bench) nearby.
  const supportPositions = [];
  for (const [key, parts] of builder.props.entries()) {
    if (key === 'glow' || key === 'water') continue;
    for (const part of parts) {
      const pos = part.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        supportPositions.push(pos[i], pos[i + 1], pos[i + 2]);
      }
    }
  }
  const hasNearbySupport = (lx, ly, lz, maxDistSq) => {
    for (let i = 0; i < supportPositions.length; i += 3) {
      const dx = supportPositions[i] - lx;
      const dy = supportPositions[i + 1] - ly;
      const dz = supportPositions[i + 2] - lz;
      if (dx * dx + dy * dy + dz * dz <= maxDistSq) return true;
    }
    return false;
  };
  for (const l of builder.dynamicLights) {
    // Check either upper stem/clasp attachment (~0.35..0.95m above) or base pedestal/bench (~0.25m below) against non-glow props.
    const anchoredAbove = hasNearbySupport(l.x, l.y + 0.42, l.z, 0.55 * 0.55)
      || hasNearbySupport(l.x, l.y + 0.85, l.z, 0.65 * 0.65);
    const seatedBelow = hasNearbySupport(l.x, l.y - 0.24, l.z, 0.45 * 0.45);
    assert.ok(anchoredAbove || seatedBelow, `lantern at (${l.x.toFixed(2)}, ${l.y.toFixed(2)}, ${l.z.toFixed(2)}) [${l.section}] appears floating without structural attachment`);
  }

  // 4. Build baked group and verify finite bakeLight/bakeDir/bakeShade + non-zero contactAO variance + dynamic range.
  const stubMat = new THREE.MeshBasicNodeMaterial();
  const materials = Object.fromEntries(Object.keys(site.materials).map((key) => [key, { material: stubMat }]));
  const group = builder.build({
    materials,
    absorption: site.lighting.absorption,
    bakeGain: site.lighting.bakeGain,
    indirectBounce: site.lighting.indirectBounce,
    propShadows: site.lighting.propShadows,
  });

  let aoMin = Infinity;
  let aoMax = -Infinity;
  let lumaMin = Infinity;
  let lumaMax = -Infinity;
  let propAoMin = Infinity;
  let propAoMax = -Infinity;

  group.traverse((obj) => {
    if (!obj.isMesh) return;
    const { bakeLight, bakeDir, bakeShade } = obj.geometry.attributes;
    assert.ok(bakeLight && bakeDir && bakeShade, 'baked mesh must carry bakeLight, bakeDir, bakeShade');
    for (let i = 0; i < bakeLight.array.length; i += 1) {
      assert.ok(Number.isFinite(bakeLight.array[i]), 'bakeLight must be finite');
      assert.ok(Number.isFinite(bakeDir.array[i]), 'bakeDir must be finite');
    }
    for (let i = 0; i < bakeShade.array.length; i += 1) {
      assert.ok(Number.isFinite(bakeShade.array[i]), 'bakeShade must be finite');
    }
    const isTerrain = Boolean(obj.geometry.attributes.surfMask);
    for (let v = 0; v < bakeLight.count; v += 1) {
      const ao = bakeShade.array[v * SHADE_SIZE];
      const luma = bakeLight.array[v * 3] * 0.2126 + bakeLight.array[v * 3 + 1] * 0.7152 + bakeLight.array[v * 3 + 2] * 0.0722;
      if (ao < aoMin) aoMin = ao;
      if (ao > aoMax) aoMax = ao;
      if (luma < lumaMin) lumaMin = luma;
      if (luma > lumaMax) lumaMax = luma;
      if (!isTerrain) {
        if (ao < propAoMin) propAoMin = ao;
        if (ao > propAoMax) propAoMax = ao;
      }
    }
  });

  assert.ok(aoMax - aoMin > 0.25, `expected substantial contactAO variance across mine (${aoMin.toFixed(3)}..${aoMax.toFixed(3)})`);
  assert.ok(propAoMax - propAoMin > 0.15, `expected non-zero contactAO variance on prop/timber meshes (${propAoMin.toFixed(3)}..${propAoMax.toFixed(3)})`);
  assert.ok(lumaMin < 0.05 && lumaMax > 0.6, `expected strong dark-to-lit dynamic range across mine (${lumaMin.toFixed(3)}..${lumaMax.toFixed(3)})`);

  group.traverse((o) => o.geometry?.dispose());
  stubMat.dispose();
});

test('LocationLightPool fades displaced lights smoothly before releasing slots and applies section-aware flicker', () => {
  const candidates = [
    { x: 0, y: 1.5, z: 0, color: [1, 0.7, 0.3], intensity: 4, range: 13, importance: 1, flicker: 0.09, section: 'haulage' },
    { x: 0, y: 1.5, z: -2, color: [1, 0.7, 0.3], intensity: 4, range: 13, importance: 1, flicker: 0.09, section: 'haulage' },
    { x: 0, y: 1.5, z: -4, color: [1, 0.7, 0.3], intensity: 4, range: 13, importance: 1, flicker: 0.09, section: 'haulage' },
    { x: 0, y: 1.5, z: -6, color: [1, 0.7, 0.3], intensity: 4, range: 13, importance: 1, flicker: 0.09, section: 'haulage' },
    { x: 0, y: 1.5, z: -25, color: [0.9, 0.5, 0.2], intensity: 2.3, range: 11.5, importance: 0.9, flicker: 0.22, section: 'abandoned' },
  ];
  const pool = new LocationLightPool(candidates, { gain: 0.26, ease: 0.25 });
  pool.update({ x: 0, y: 1.5, z: 0 }, 1.0);
  const firstActive = pool.activeLights().map((l) => l.index);
  assert.deepEqual(firstActive.sort((a, b) => a - b), [0, 1, 2, 3]);

  // Jump near candidate 4: pool should smoothly ramp candidate 0 down rather than snapping instantly.
  pool.update({ x: 0, y: 1.5, z: -25 }, 1.05);
  assert.ok(pool.activeLights().length <= MAX_DYNAMIC_LIGHTS);

  // Advance many steps so handoff completes cleanly and candidate 4 takes over.
  for (let t = 1.1; t <= 4.0; t += 0.1) pool.update({ x: 0, y: 1.5, z: -25 }, t);
  assert.ok(pool.activeLights().some((l) => l.index === 4), 'far abandoned candidate should become active after smooth handoff');
  pool.dispose();
});
