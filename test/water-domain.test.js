import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WATER_DOMAIN_VERSION,
  WATER_KIND_NONE,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from '../src/editor/water/WaterConstants.js';
import { createNoWaterSample, createWaterSample } from '../src/editor/water/WaterSample.js';
import {
  applyWaterDomainConfig,
  assertCompatibleWaterDomainMetadata,
  resolvePersistedWaterDomainVersion,
  resolveWaterDomainConfig,
  resolveWaterDomainVersion,
  validateWaterDomainConfig,
  waterDomainConfigsEqual,
} from '../src/editor/water/WaterConfig.js';
import { ensureWaterDomainGenerator } from '../src/editor/water/GeneratorWaterAdapter.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

const waterConfig = Object.freeze({
  waterDomain: Object.freeze({
    version: WATER_DOMAIN_VERSION,
    shoreDistanceMeters: 48,
    ocean: Object.freeze({
      coastalShelfMeters: 20,
      shelfDepth: 4,
      maximumDepth: 24,
      maximumBedSlope: 0.75,
    }),
    river: Object.freeze({
      minimumDepth: 0.8,
      maximumDepth: 8,
      widthDepthRatio: 0.18,
      bankExponent: 1.8,
      minimumGradient: 0.0002,
    }),
  }),
  player: Object.freeze({
    water: Object.freeze({
      wadeDepth: 0.7,
      swimDepth: 1.35,
      transitionHysteresis: 0.12,
      wadeDrag: 0.35,
      swimSpeed: 5,
      verticalSwimSpeed: 3,
      buoyancy: 18,
      swimDrag: 4,
    }),
  }),
});

test('water samples are immutable and enforce domain invariants', () => {
  const sample = createWaterSample({
    kind: WATER_KIND_OCEAN,
    bodyId: 1,
    surfaceHeight: 4,
    bedHeight: -2,
    shoreDistance: 12,
    flowX: 3,
    flowZ: 4,
  });
  assert.equal(sample.depth, 6);
  assert.equal(sample.coverage, 1);
  assert.equal(sample.flowX, 0.6);
  assert.equal(sample.flowZ, 0.8);
  assert.equal(Object.isFrozen(sample), true);
  assert.throws(() => createWaterSample({
    kind: WATER_KIND_NONE,
    coverage: 1,
    surfaceHeight: 0,
    bedHeight: 0,
  }), /zero coverage/);
});

test('non-water samples retain ground height with zero semantic depth', () => {
  const sample = createNoWaterSample(7.25);
  assert.equal(sample.kind, WATER_KIND_NONE);
  assert.equal(sample.depth, 0);
  assert.equal(sample.bedHeight, 7.25);
});

test('procedural water queries are deterministic and use heightfield interpolation', () => {
  const generator = new ProceduralWorldGenerator({ seed: 918273, seaLevel: 100 });
  const coordinate = { x: 12.5, z: -8.5 };
  const expectedBed = (
    generator.sampleHeight(12, -9)
    + generator.sampleHeight(13, -9)
    + generator.sampleHeight(12, -8)
    + generator.sampleHeight(13, -8)
  ) * 0.25;
  const first = generator.sampleWater(coordinate.x, coordinate.z);
  assert.deepEqual(first, generator.sampleWater(coordinate.x, coordinate.z));
  assert.equal(first.kind, WATER_KIND_OCEAN);
  assert.equal(first.bedHeight, expectedBed);
  assert.equal(generator.toMetadata().waterDomainVersion, WATER_DOMAIN_VERSION);
  assert.equal(ensureWaterDomainGenerator(generator), generator);
});

test('transient unversioned generators adopt the current water-domain contract', () => {
  const generator = {
    seed: 1,
    seaLevel: -1.5,
    sampleHeight: () => 3,
    sampleTile: () => 4,
    toMetadata: () => Object.freeze({ seed: 1, version: 1, heightScale: 24, seaLevel: -1.5 }),
  };
  ensureWaterDomainGenerator(generator, generator.toMetadata());
  assert.equal(generator.sampleWater(0, 0).kind, WATER_KIND_NONE);
  assert.equal(generator.toMetadata().waterDomainVersion, WATER_DOMAIN_VERSION);
  assert.equal(resolveWaterDomainVersion(undefined), WATER_DOMAIN_VERSION);
  assert.throws(() => resolveWaterDomainVersion(99), /Unsupported water-domain version/);
});

test('un-carved imported rivers are marked incomplete', () => {
  const generator = {
    seed: 1,
    seaLevel: -1.5,
    sampleHeight: () => 12,
    sampleTile: () => 0,
    isRiver: () => true,
    toMetadata: () => Object.freeze({ seed: 1, version: 1, heightScale: 24, seaLevel: -1.5 }),
  };
  ensureWaterDomainGenerator(generator);
  const sample = generator.sampleWater(10, 10);
  assert.equal(sample.kind, WATER_KIND_RIVER);
  assert.equal(sample.depth, 0);
  assert.equal(sample.flags & WATER_SAMPLE_FLAG_INCOMPLETE_BED, WATER_SAMPLE_FLAG_INCOMPLETE_BED);
});

test('water-domain and player thresholds are validated separately from visuals', () => {
  const editorConfig = { map: { tileSize: 2 }, player: {} };
  applyWaterDomainConfig(editorConfig, waterConfig);
  assert.equal(editorConfig.waterDomain.cellSizeMeters, 2);
  assert.equal(validateWaterDomainConfig(editorConfig), editorConfig);
  editorConfig.player.water.swimDepth = 0.5;
  assert.throws(() => validateWaterDomainConfig(editorConfig), /swimDepth must exceed wadeDepth/);
});


test('persisted water versions require an explicit terrain migration', () => {
  assert.equal(resolvePersistedWaterDomainVersion(undefined), 0);
  assert.equal(resolvePersistedWaterDomainVersion(WATER_DOMAIN_VERSION), WATER_DOMAIN_VERSION);
  assert.throws(() => resolveWaterDomainVersion(WATER_DOMAIN_VERSION - 1), /Unsupported/);
});

test('water-domain equality is stable across object property order', () => {
  const left = resolveWaterDomainConfig({ cellSizeMeters: 2 });
  const right = {
    river: { ...left.river },
    ocean: { ...left.ocean },
    shoreDistanceMeters: left.shoreDistanceMeters,
    cellSizeMeters: left.cellSizeMeters,
    version: left.version,
  };
  assert.equal(waterDomainConfigsEqual(left, right), true);
});

test('shore distance must extend beyond the coastal shelf', () => {
  assert.throws(
    () => resolveWaterDomainConfig({
      shoreDistanceMeters: 20,
      ocean: { coastalShelfMeters: 20 },
    }),
    /must exceed coastalShelfMeters/,
  );
});


test('save metadata rejects legacy and mismatched water terrain contracts', () => {
  const current = {
    waterDomainVersion: WATER_DOMAIN_VERSION,
    waterDomain: resolveWaterDomainConfig({ cellSizeMeters: 2 }),
  };
  assert.throws(
    () => assertCompatibleWaterDomainMetadata({}, current),
    /requires migration/,
  );
  assert.throws(
    () => assertCompatibleWaterDomainMetadata({
      waterDomainVersion: WATER_DOMAIN_VERSION,
      waterDomain: resolveWaterDomainConfig({ cellSizeMeters: 1 }),
    }, current),
    /settings do not match/,
  );
  assert.doesNotThrow(() => assertCompatibleWaterDomainMetadata({
    waterDomainVersion: WATER_DOMAIN_VERSION,
    waterDomain: {
      river: { ...current.waterDomain.river },
      ocean: { ...current.waterDomain.ocean },
      shoreDistanceMeters: current.waterDomain.shoreDistanceMeters,
      cellSizeMeters: current.waterDomain.cellSizeMeters,
      version: current.waterDomain.version,
    },
  }, current));
});

test('macro columns use the same transformed water terrain contract', () => {
  const generator = {
    seed: 3,
    seaLevel: 0,
    sampleHeight: () => -2,
    sampleTile: () => 0,
    sampleMacroColumn: () => ({ height: -2, tileId: 0, rawHeight: 10 }),
    toMetadata: () => Object.freeze({ seed: 3, version: 1, heightScale: 24, seaLevel: 0 }),
  };
  ensureWaterDomainGenerator(generator);

  const column = generator.sampleMacroColumn(48, 48);
  assert.equal(column.tileId, 0);
  assert.equal(column.rawHeight, 10);
  assert.ok(column.height < -2);
});
