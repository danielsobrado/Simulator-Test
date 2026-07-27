import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WATER_DOMAIN_VERSION,
  WATER_KIND_NONE,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from '../src/editor/water/WaterConstants.js';
import {
  createNoWaterSample,
  createWaterSample,
} from '../src/editor/water/WaterSample.js';
import {
  applyWaterDomainConfig,
  resolveWaterDomainVersion,
  validateWaterDomainConfig,
} from '../src/editor/water/WaterConfig.js';
import { ensureWaterDomainGenerator } from '../src/editor/water/GeneratorWaterAdapter.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';

const waterConfig = Object.freeze({
  waterDomain: Object.freeze({
    version: WATER_DOMAIN_VERSION,
    shoreDistanceMeters: 48,
    ocean: Object.freeze({
      coastalShelfMeters: 32,
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
  assert.deepEqual(sample, {
    kind: WATER_KIND_NONE,
    bodyId: 0,
    coverage: 0,
    surfaceHeight: 7.25,
    bedHeight: 7.25,
    depth: 0,
    shoreDistance: 0,
    flowX: 0,
    flowZ: 0,
    flags: 0,
  });
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
  const second = generator.sampleWater(coordinate.x, coordinate.z);
  assert.deepEqual(first, second);
  assert.equal(first.kind, WATER_KIND_OCEAN);
  assert.equal(first.surfaceHeight, generator.seaLevel);
  assert.equal(first.bedHeight, expectedBed);
  assert.equal(generator.toMetadata().waterDomainVersion, WATER_DOMAIN_VERSION);
});

test('legacy generator metadata migrates to the current water-domain version', () => {
  const generator = {
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
  const editorConfig = { player: {} };
  applyWaterDomainConfig(editorConfig, waterConfig);
  assert.equal(validateWaterDomainConfig(editorConfig), editorConfig);

  editorConfig.player.water.swimDepth = 0.5;
  assert.throws(
    () => validateWaterDomainConfig(editorConfig),
    /swimDepth must exceed wadeDepth/,
  );
});
