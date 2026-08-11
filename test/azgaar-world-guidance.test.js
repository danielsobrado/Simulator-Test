import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import {
  createAzgaarMacroWorldSource,
  decodeMacroAtlas,
  isAzgaarMacroWorldSource,
} from '../src/editor/import/AzgaarMacroWorldSource.js';
import { deriveAzgaarWorldGuidance } from '../src/editor/import/AzgaarWorldGuidance.js';
import { decodeMacroField, encodeMacroField } from '../src/editor/import/MacroAtlasCodec.js';
import { AzgaarMacroWorldGenerator } from '../src/editor/world/AzgaarMacroWorldGenerator.js';
import { createTerrainWorkerBaseTerrain } from '../src/editor/world/TerrainWorkerBaseTerrain.js';
import { WorldGuidanceField } from '../src/editor/world/WorldGuidanceField.js';

const guidanceConfig = yaml.load(readFileSync(
  new URL('../config/azgaar-guidance.yaml', import.meta.url),
  'utf8',
));

const config = Object.freeze({
  import: Object.freeze({
    azgaarAtlasLongEdge: 4,
    azgaarOceanTransitionKilometers: 1,
    azgaarVerticalExaggeration: 2,
    azgaarReliefExponent: 1.2,
    azgaarGuidance: guidanceConfig,
  }),
  map: Object.freeze({ tileSize: 1000 }),
  terrain: Object.freeze({ minHeight: -20, maxHeight: 80 }),
  world: Object.freeze({ seaLevel: 0 }),
});

function createDocument() {
  return {
    info: {
      width: 4,
      height: 4,
      version: 'test',
      mapId: 17,
      mapName: 'Guidance fixture',
      seed: '42',
    },
    settings: { distanceScale: 1, distanceUnit: 'km' },
    grid: {
      cellsX: 2,
      cellsY: 2,
      cells: [
        { i: 0, h: 5, f: 1, temp: -10, prec: 80, t: -3 },
        { i: 1, h: 5, f: 1, temp: 5, prec: 20, t: -2 },
        { i: 2, h: 45, f: 2, temp: 8, prec: 75, t: 1 },
        { i: 3, h: 75, f: 2, temp: -5, prec: 45, t: 1 },
      ],
    },
    pack: {
      cells: [
        { i: 0, g: 0, p: [1, 1], h: 5, f: 1, biome: 0 },
        { i: 1, g: 1, p: [3, 1], h: 5, f: 1, biome: 0 },
        {
          i: 2,
          g: 2,
          p: [1, 3],
          h: 45,
          f: 2,
          biome: 4,
          r: 7,
          fl: 120,
          conf: 8,
          pop: 3.25,
          s: 60,
          harbor: 1,
          haven: 1,
        },
        {
          i: 3,
          g: 3,
          p: [3, 3],
          h: 75,
          f: 2,
          biome: 6,
          pop: 1.5,
          s: 20,
        },
      ],
      rivers: [{ i: 7, width: 0.1, points: [[0, 3], [4, 3]] }],
    },
    biomesData: {},
  };
}

function cellAtAtlas(source, atlasX, atlasY) {
  return {
    x: source.bounds.minCellX
      + (atlasX + 0.5) / source.atlas.width * source.bounds.widthCells
      - 0.5,
    z: source.bounds.minCellZ
      + (atlasY + 0.5) / source.atlas.height * source.bounds.heightCells
      - 0.5,
  };
}

test('macro atlas codec round-trips signed and unsigned typed fields', () => {
  for (const [type, values] of [
    ['u8', Uint8Array.from([0, 0, 255, 2])],
    ['i8', Int8Array.from([-128, -3, -3, 127])],
    ['u16', Uint16Array.from([0, 65535, 42, 42])],
    ['u32', Uint32Array.from([0, 65536, 4_000_000_000, 4_000_000_000])],
    ['i16', Int16Array.from([-32768, -8, 12, 32767])],
  ]) {
    const payload = encodeMacroField(values, type);
    assert.deepEqual(decodeMacroField(payload, type), values);
  }
});

test('macro atlas codec protects schema metadata and rejects oversized payloads', () => {
  const encoded = encodeMacroField(Uint8Array.of(7), 'u8', {
    type: 'i16',
    encoding: 'invalid',
    data: 'invalid',
    length: 99,
    unit: 'test',
  });
  assert.equal(encoded.type, 'u8');
  assert.equal(encoded.length, 1);
  assert.equal(encoded.unit, 'test');
  assert.deepEqual(decodeMacroField(encoded), Uint8Array.of(7));
  assert.throws(
    () => decodeMacroField({ ...encoded, data: 'AAAAAAAA' }),
    /larger than its declared length/,
  );
});

test('Azgaar macro v2 persists raw and derived world guidance fields', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  assert.equal(source.kind, 'azgaar-macro-v2');
  assert.equal(source.version, 2);

  const decoded = decodeMacroAtlas(source, { includeGuidance: true });
  assert.deepEqual(decoded.fields.temperature, Int8Array.from([
    -10, -10, 5, 5,
    -10, -10, 5, 5,
    8, 8, -5, -5,
    8, 8, -5, -5,
  ]));
  assert.equal(decoded.fields.riverFlux[8], 120);
  assert.equal(decoded.fields.population[8], 325);
  assert.ok(decoded.fields.coastDistance[0] < 0);
  assert.ok(decoded.fields.coastDistance[12] >= 0);
  assert.ok(decoded.fields.moisture[8] > decoded.fields.moisture[10]);
  assert.ok(decoded.fields.mountainness[10] > decoded.fields.mountainness[8]);
});

test('macro sampling preserves multiple packed cells inside one Azgaar grid cell', () => {
  const document = {
    info: { width: 4, height: 1, mapName: 'Packed cells' },
    settings: { distanceScale: 1, distanceUnit: 'km' },
    grid: {
      cellsX: 1,
      cellsY: 1,
      cells: [{ i: 0, h: 30, f: 1, temp: 10, prec: 50, t: 1 }],
    },
    pack: {
      cells: [
        { i: 10, g: 0, p: [0.5, 0.5], h: 30, f: 1, biome: 4 },
        { i: 11, g: 0, p: [3.5, 0.5], h: 80, f: 1, biome: 6, r: 9, fl: 200 },
      ],
      rivers: [],
    },
    biomesData: {},
  };
  const source = createAzgaarMacroWorldSource(document, config);
  const fields = decodeMacroAtlas(source, { includeGuidance: true }).fields;
  assert.deepEqual(fields.elevation, Uint8Array.from([30, 30, 80, 80]));
  assert.deepEqual(fields.biomeId, Uint8Array.from([4, 4, 6, 6]));
  assert.deepEqual(fields.riverId, Uint32Array.from([0, 0, 9, 9]));
});

test('macro atlas validation rejects corrupt optional fields before decoding', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const corrupt = structuredClone(source);
  corrupt.atlas.fields.wetness.length -= 1;
  assert.throws(() => decodeMacroAtlas(corrupt), /wetness does not match its dimensions/);

  const oversized = structuredClone(source);
  oversized.atlas.width = 4_000_001;
  oversized.atlas.height = 1;
  assert.throws(() => decodeMacroAtlas(oversized), /1–4000000 cells/);
});

test('macro source detection preserves v1 and v2 runtime support', () => {
  const current = createAzgaarMacroWorldSource(createDocument(), config);
  assert.equal(isAzgaarMacroWorldSource(current), true);
  assert.equal(isAzgaarMacroWorldSource({ kind: 'azgaar-macro-v1', version: 1 }), true);
  assert.equal(isAzgaarMacroWorldSource({ kind: 'azgaar-macro-v1', version: 2 }), false);
});

test('original v2 feature and settlement encodings remain readable', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const decoded = decodeMacroAtlas(source, { includeGuidance: true }).fields;
  const legacy = structuredClone(source);
  legacy.atlas.fields.featureId = encodeMacroField(
    Uint16Array.from(decoded.featureId),
    'u16',
  );
  legacy.atlas.fields.settlementScore = encodeMacroField(
    Int16Array.from(decoded.settlementScore),
    'i16',
  );
  const compatible = decodeMacroAtlas(legacy, { includeGuidance: true }).fields;
  assert.deepEqual(compatible.featureId, Uint16Array.from(decoded.featureId));
  assert.deepEqual(compatible.settlementScore, Int16Array.from(decoded.settlementScore));
});

test('coast water does not make flat coastal land rugged or mountainous', () => {
  const width = 5;
  const height = 5;
  const length = width * height;
  const elevation = new Uint8Array(length).fill(40);
  elevation.fill(5, 0, width);
  const raw = {
    elevation,
    temperature: new Int8Array(length).fill(10),
    precipitation: new Uint8Array(length).fill(50),
    biomeId: new Uint8Array(length).fill(4),
    riverId: new Uint32Array(length),
    settlementScore: new Uint16Array(length),
    harborScore: new Uint8Array(length),
  };
  const derived = deriveAzgaarWorldGuidance({
    raw,
    rivers: [],
    width,
    height,
    physicalWidthMeters: 5_000,
    biomes: [],
    config: guidanceConfig,
  });
  const coastalLand = 2 * width + 2;
  assert.equal(derived.ruggedness[coastalLand], 0);
  assert.equal(derived.mountainness[coastalLand], 0);
});

test('world guidance decodes individual fields only when requested', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const guidance = new WorldGuidanceField(source);
  assert.deepEqual(guidance.decodedFieldNames(), []);

  const boundary = cellAtAtlas(source, 1.5, 2);
  guidance.sampleBiomeBlend(boundary.x, boundary.z);
  assert.deepEqual(guidance.decodedFieldNames(), ['biomeId']);

  guidance.sampleContinuous('mountainness', boundary.x, boundary.z);
  assert.deepEqual(guidance.decodedFieldNames(), ['biomeId', 'mountainness']);
});

test('world guidance exposes scaled samples and continuous biome weights', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const guidance = new WorldGuidanceField(source);
  const wetLand = cellAtAtlas(source, 0, 2);
  const sample = guidance.sample(wetLand.x, wetLand.z);

  assert.equal(sample.inside, true);
  assert.equal(sample.biomeId, 4);
  assert.equal(sample.riverId, 7);
  assert.equal(sample.population, 3.25);
  assert.ok(sample.moisture > 0.7);
  assert.ok(Number.isFinite(sample.coastDistanceMeters));
  assert.ok(Number.isFinite(sample.riverDistanceMeters));

  const boundary = cellAtAtlas(source, 1.5, 2);
  const blend = guidance.sampleBiomeBlend(boundary.x, boundary.z);
  assert.deepEqual(blend.weights.map(({ sourceId }) => sourceId), [4, 6]);
  assert.ok(Math.abs(blend.weights.reduce((sum, entry) => sum + entry.weight, 0) - 1) < 1e-12);
  assert.equal(blend.canonicalTileId, 6);

  assert.deepEqual(
    guidance.sampleBiomeBlend(source.bounds.minCellX - 1, source.bounds.minCellZ).weights,
    [{ sourceId: 0, tileId: 0, weight: 1 }],
  );
});

test('outside-world guidance returns explicit ocean defaults instead of edge values', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const guidance = new WorldGuidanceField(source);
  const sample = guidance.sample(source.bounds.minCellX - 100, source.bounds.minCellZ - 100);
  assert.equal(sample.inside, false);
  assert.equal(sample.biomeId, 0);
  assert.equal(sample.population, 0);
  assert.equal(sample.wetness, 1);
  assert.equal(sample.temperature, null);
  assert.equal(sample.coastDistanceMeters, null);
});

test('terrain worker source carries only canonical and morphology guidance', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const workerSource = createTerrainWorkerBaseTerrain(source);
  assert.equal(workerSource.kind, 'azgaar-macro-v2');
  assert.equal(workerSource.profile, 'terrain-worker');
  assert.deepEqual(
    Object.keys(workerSource.atlas.fields).sort(),
    ['biomeId', 'elevation', 'featureId', 'mountainness', 'ruggedness', 'valleyness'],
  );
  assert.equal(workerSource.atlas.fields.population, undefined);

  const generator = new AzgaarMacroWorldGenerator(workerSource, {
    seed: 42,
    version: 1,
    heightScale: 12,
    seaLevel: 0,
  });
  assert.equal(generator.hasMorphologyGuidance, true);
  const position = cellAtAtlas(workerSource, 0, 2);
  assert.ok(Number.isFinite(generator.morphologyScale(position.x, position.z)));
  assert.deepEqual(
    generator.guidance.decodedFieldNames(),
    ['biomeId', 'elevation', 'featureId', 'mountainness', 'ruggedness', 'valleyness'],
  );
});

test('macro generation decodes optional guidance only when queried', () => {
  const source = createAzgaarMacroWorldSource(createDocument(), config);
  const generator = new AzgaarMacroWorldGenerator(source, {
    seed: 42,
    version: 1,
    heightScale: 12,
    seaLevel: 0,
  });
  assert.equal(generator.guidance, null);

  const position = cellAtAtlas(source, 0, 2);
  assert.equal(generator.sampleGuidance(position.x, position.z).riverId, 7);
  assert.ok(generator.guidance instanceof WorldGuidanceField);
});
