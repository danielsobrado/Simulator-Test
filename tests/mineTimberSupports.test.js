import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import {
  DEFAULT_MINE_TIMBER_CONFIG,
  resolveMineTimberConfig,
  setDefaultMineTimberConfig,
} from '../src/editor/locations/gen/mineTimberConfig.js';
import {
  TimberGeometryCache,
  createTimberBeam,
  createTimberBoard,
  createTimberWedge,
} from '../src/editor/locations/gen/timberGeometry.js';
import {
  buildMineTunnelSupports,
  buildStandaloneTimberSet,
  buildTimberSupportFrame,
} from '../src/editor/locations/gen/timberSupportBuilder.js';
import { planTunnelSupports } from '../src/editor/locations/gen/tunnelTimberPlanner.js';
import { LOCATION_GENERATORS } from '../src/editor/locations/generators/index.js';
import { LocationBuilder, generateLocation } from '../src/editor/locations/LocationBuilder.js';
import { resolveLocationCatalog } from '../src/editor/locations/LocationCatalog.js';

const timberYaml = yaml.load(fs.readFileSync(new URL('../config/mine-timber.yaml', import.meta.url), 'utf8'));
const catalogYaml = yaml.load(fs.readFileSync(new URL('../config/instanced-locations.yaml', import.meta.url), 'utf8'));

function assertFiniteGeometry(geometry, label) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  assert.ok(pos && pos.count >= 12, `${label}: has vertices`);
  assert.ok(norm && norm.count === pos.count, `${label}: has normals matching vertex count`);
  for (let i = 0; i < pos.count; i += 1) {
    assert.ok(
      Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)),
      `${label}: finite position at vertex ${i}`,
    );
    const nx = norm.getX(i);
    const ny = norm.getY(i);
    const nz = norm.getZ(i);
    const nLen = Math.hypot(nx, ny, nz);
    assert.ok(Number.isFinite(nLen) && Math.abs(nLen - 1) < 1e-2, `${label}: unit normal at vertex ${i}`);
  }
}

test('mine-timber.yaml matches DEFAULT_MINE_TIMBER_CONFIG and validates overrides', () => {
  const parsed = resolveMineTimberConfig(timberYaml.mineTimber, DEFAULT_MINE_TIMBER_CONFIG);
  assert.deepEqual(parsed, DEFAULT_MINE_TIMBER_CONFIG);
  setDefaultMineTimberConfig(timberYaml);

  assert.throws(() => resolveMineTimberConfig({ beamDimensions: { postWidth: -0.1 } }), /postWidth/);
  assert.throws(() => resolveMineTimberConfig({ placement: { minSpacing: 99 } }), /minSpacing/);
});

test('procedural timber beams preserve longitudinal grain UVs, end-grain masks, and miter planes', () => {
  const beamDiag = createTimberBeam(
    { x: 0, y: 0, z: 0 },
    { x: 1.2, y: 1.2, z: 0 },
    0.12,
    0.13,
    {
      startCutNormal: { x: -1, y: 0, z: 0 },
      endCutNormal: { x: 0, y: 1, z: 0 },
      seed: 42,
    },
  );
  assertFiniteGeometry(beamDiag, 'diagonal-brace');

  const uv = beamDiag.attributes.uv;
  const mask = beamDiag.attributes.woodMask;
  const pos = beamDiag.attributes.position;
  assert.ok(uv && mask, 'beam exposes uv and woodMask attributes');

  let hasEndCap = false;
  let hasSideFace = false;
  let maxAlong = -Infinity;
  let maxV = -Infinity;
  let minStartX = Infinity;
  let maxEndY = -Infinity;
  const axisX = Math.SQRT1_2;
  const axisY = Math.SQRT1_2;

  for (let i = 0; i < pos.count; i += 1) {
    assert.equal(mask.getW(i), 1, 'hasWoodUv flag is active');
    if (mask.getX(i) > 0.9) hasEndCap = true;
    else {
      hasSideFace = true;
      const along = pos.getX(i) * axisX + pos.getY(i) * axisY;
      if (along > maxAlong) maxAlong = along;
      if (uv.getY(i) > maxV) maxV = uv.getY(i);
    }
    if (pos.getX(i) < minStartX) minStartX = pos.getX(i);
    if (pos.getY(i) > maxEndY) maxEndY = pos.getY(i);
  }
  assert.ok(hasEndCap && hasSideFace, 'separates end-grain caps from longitudinal bark/grain faces');
  assert.ok(maxV > 0.5 && maxAlong > 1.0, 'UV V advances cleanly along the diagonal beam axis');
  assert.ok(Math.abs(minStartX - 0) < 0.08, 'start miter stays flush against vertical post inner plane x=0');
  assert.ok(Math.abs(maxEndY - 1.2) < 0.08, 'end miter stays flush against horizontal cap soffit plane y=1.2');

  const wedge = createTimberWedge({ x: 0, y: 0, z: 0 }, { x: 0.35, y: 0, z: 0 }, 0.14, 0.08, 0.015);
  assertFiniteGeometry(wedge, 'timber-wedge');
  const board = createTimberBoard({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: -2.4 }, { x: 1, y: 0, z: 0 }, 0.2, 0.04);
  assertFiniteGeometry(board, 'lagging-board');
});

test('TimberGeometryCache reuses templates cleanly and supports all 6 archetypes & 5 conditions', () => {
  const archetypes = ['standard', 'heavy', 'light', 'repaired', 'aged', 'partial'];
  const conditions = ['new', 'maintained', 'aged', 'neglected', 'repaired'];
  const cache = new TimberGeometryCache();

  for (let i = 0; i < archetypes.length; i += 1) {
    const archetype = archetypes[i];
    const condition = conditions[i % conditions.length];
    const builder = new LocationBuilder({
      seed: 900 + i * 17,
      bounds: { min: { x: -8, y: -4, z: -8 }, max: { x: 8, y: 6, z: 8 } },
      voxel: 0.35,
    });
    const plan = {
      index: i,
      s: i * 3,
      seed: 1200 + i * 31,
      center: { x: 0, y: 0, z: 0 },
      dir: { x: 0, y: 0, z: -1 },
      right: { x: 1, y: 0, z: 0 },
      archetype,
      condition,
      jointStyle: ['housed', 'notched', 'bolster', 'collared'][i % 4],
      partialSide: archetype === 'partial' ? 'left' : null,
      postWidth: 0.18,
      postDepth: 0.18,
      capWidth: 0.19,
      capHeight: 0.21,
      braceWidth: 0.11,
      braceDepth: 0.12,
      leftPostOffset: -1.65,
      rightPostOffset: 1.65,
      floorLeftY: 0,
      floorRightY: 0,
      capSoffitY: 2.55,
      capTopY: 2.76,
      roofLeftY: 2.9,
      roofCenterY: 3.12,
      roofRightY: 2.92,
      wallLeft: 1.76,
      wallRight: 1.78,
      leftShoulder: 1.68,
      rightShoulder: 1.85,
      hasLeftBrace: archetype !== 'partial',
      hasRightBrace: true,
      dropL: 0.72,
      reachL: 0.62,
      dropR: 0.68,
      reachR: 0.58,
      hasHardware: i % 2 === 0,
      instability: 0.35,
      isPortal: false,
    };
    const built = buildTimberSupportFrame(builder, cache, plan, DEFAULT_MINE_TIMBER_CONFIG);
    assert.ok(built.capStart && built.capEnd, `frame ${archetype} built cap endpoints`);
    const timberParts = builder.props.get('timber') ?? [];
    const ironParts = builder.props.get('iron') ?? [];
    assert.ok(timberParts.length >= 2, `frame ${archetype} emitted timber parts`);
    for (const part of timberParts) {
      assertFiniteGeometry(part, `${archetype}/${condition}-timber`);
    }
    for (const part of ironParts) {
      assertFiniteGeometry(part, `${archetype}/${condition}-iron`);
    }
  }

  assert.ok(cache.templates.size >= 2, 'shared hardware template cache populated');

  const tunnelBuilder = new LocationBuilder({
    seed: 1337,
    bounds: { min: { x: -8, y: -4, z: -24 }, max: { x: 8, y: 6, z: 6 } },
    voxel: 0.35,
  });
  const shape = tunnelBuilder.minePassage([{ x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: -20 }], {
    width: 3.5,
    height: 3.1,
    seedOffset: 7,
  });
  const supported = buildMineTunnelSupports(tunnelBuilder, { shape, width: 3.5, height: 3.1, cache });
  assert.ok(supported.frames.length >= 3, 'buildMineTunnelSupports places multiple frames along passage');
  for (const part of tunnelBuilder.props.get('timber') ?? []) {
    assertFiniteGeometry(part, 'tunnel-supports-timber');
  }

  const standaloneBuilder = new LocationBuilder({
    seed: 77,
    bounds: { min: { x: -6, y: -2, z: -6 }, max: { x: 6, y: 5, z: 6 } },
    voxel: 0.35,
  });
  const portal = buildStandaloneTimberSet(standaloneBuilder, { x: 0, y: 0, z: 0 }, 0, 2.8, 2.5);
  assert.ok(portal.capStart.y > 2.4 && (standaloneBuilder.props.get('timber')?.length ?? 0) >= 4);
});

test('showcase-deep-workings integrates varied geology-adapted timber supports with rail clearance', () => {
  const catalog = resolveLocationCatalog(catalogYaml, {
    generatorKeys: Object.keys(LOCATION_GENERATORS),
    quality: 'low',
  });
  const site = catalog.showcaseSites().find((entry) => entry.id === 'showcase-deep-workings');
  assert.ok(site, 'showcase-deep-workings exists in catalog');

  const builder = generateLocation(site, LOCATION_GENERATORS[site.generatorKey]);
  const materials = Object.fromEntries(
    Object.entries(site.materials).map(([key, def]) => [
      key,
      { material: new THREE.MeshBasicMaterial(), ice: 0, woodGrain: key === 'timber' },
    ]),
  );
  const group = builder.build({ materials, absorption: site.lighting.absorption });

  let timberMeshCount = 0;
  group.traverse((obj) => {
    if (obj.isMesh && obj.geometry?.attributes.woodMask) {
      timberMeshCount += 1;
      assertFiniteGeometry(obj.geometry, 'batched-mine-timber');
      assert.ok(obj.geometry.attributes.uv, 'batched mine timber retains UV coordinates');
    }
  });
  assert.ok(timberMeshCount >= 1, 'built timber mesh has harmonized woodMask + uv attributes');

  // Verify haulage drift planner produces non-uniform spacing, multiple archetypes, and rail clearance.
  const haulPlan = planTunnelSupports(builder, {
    points: [{ x: 0, y: 0, z: 6 }, { x: 0, y: -1, z: -40 }],
    width: site.params.drift.width,
    height: site.params.drift.height,
    seedOffset: 101,
    entranceOffset: 5.4,
    endMargin: 2.8,
    rail: { offset: -0.9 },
    avoidZones: [{ x: 0, y: -1, z: -50, radius: 9.2, height: 6 }],
  }, site.params.timber);

  assert.ok(haulPlan.plans.length >= 8, `haulage drift places >= 8 frames (got ${haulPlan.plans.length})`);
  const archetypesSeen = new Set(haulPlan.plans.map((p) => p.archetype));
  assert.ok(archetypesSeen.size >= 2, `haulage drift uses varied archetypes (got ${[...archetypesSeen].join(', ')})`);

  const steps = [];
  for (let i = 1; i < haulPlan.plans.length; i += 1) {
    steps.push(haulPlan.plans[i].s - haulPlan.plans[i - 1].s);
  }
  const minStep = Math.min(...steps);
  const maxStep = Math.max(...steps);
  assert.ok(maxStep - minStep > 0.25, `frame spacing varies naturally (${minStep.toFixed(2)}m..${maxStep.toFixed(2)}m)`);

  for (const p of haulPlan.plans) {
    const leftInner = p.leftPostOffset + p.postWidth * 0.5;
    const rightInner = p.rightPostOffset - p.postWidth * 0.5;
    assert.ok(leftInner <= -1.61, `frame ${p.index} clears rail envelope on left (leftInner=${leftInner.toFixed(3)})`);
    assert.ok(rightInner >= 1.04, `frame ${p.index} clears walkway on right (rightInner=${rightInner.toFixed(3)})`);
  }

  // Entry spawn must remain clear and walkable.
  const spawn = builder.spawns.entry;
  assert.ok(builder.nav.surfaceAt(spawn.x, spawn.z, spawn.y + 0.3) !== null, 'entry spawn walkable');
});
