import { createAzgaarBiomeDefinitions } from '../AzgaarBiomeCatalog.js';
import { deriveAzgaarWorldGuidance } from './AzgaarWorldGuidance.js';
import { decodeMacroField, encodeMacroField } from './MacroAtlasCodec.js';

const MACRO_SOURCE_KIND = 'azgaar-macro-v2';
const MACRO_SOURCE_VERSION = 2;
const LEGACY_MACRO_SOURCE_KIND = 'azgaar-macro-v1';
const LEGACY_MACRO_SOURCE_VERSION = 1;
const MAX_MACRO_ATLAS_CELLS = 4_000_000;

const UNIT_METERS = Object.freeze({
  km: 1000,
  mi: 1609.344,
  lg: 4828.032,
  vr: 1066.8,
  nmi: 1852,
  nlg: 5556,
});

const LEGACY_FIELD_NAMES = Object.freeze({
  elevation: 'heightData',
  biomeId: 'biomeData',
  featureId: 'featureData',
});

const GUIDANCE_FIELD_TYPES = Object.freeze({
  elevation: 'u8',
  temperature: 'i8',
  precipitation: 'u8',
  waterDistance: 'i8',
  biomeId: 'u8',
  featureId: 'u32',
  riverId: 'u32',
  riverFlux: 'u32',
  confluenceFlux: 'u32',
  population: 'u32',
  settlementScore: 'u16',
  harborScore: 'u8',
  havenId: 'u32',
  coastDistance: 'i16',
  riverDistance: 'u16',
  moisture: 'u8',
  continentalness: 'u8',
  wetness: 'u8',
  mountainness: 'u8',
  ruggedness: 'u8',
  valleyness: 'u8',
  snowPotential: 'u8',
  forestPotential: 'u8',
  agriculturalPotential: 'u8',
  harborPotential: 'u8',
});

const COMPATIBLE_FIELD_TYPES = Object.freeze({
  featureId: Object.freeze(['u32', 'u16']),
  settlementScore: Object.freeze(['u16', 'i16']),
});

const BASIC_FIELDS = Object.freeze(['elevation', 'biomeId', 'featureId']);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function resolvePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function validateAtlasDimensions(atlas) {
  const width = atlas?.width;
  const height = atlas?.height;
  const length = width * height;
  if (!Number.isInteger(width) || width < 1
      || !Number.isInteger(height) || height < 1
      || !Number.isSafeInteger(length)
      || length > MAX_MACRO_ATLAS_CELLS) {
    throw new Error(
      `Azgaar macro atlas dimensions must contain 1–${MAX_MACRO_ATLAS_CELLS} cells.`,
    );
  }
  return { width, height, length };
}

function resolveAtlasDimensions(document, config) {
  const sourceWidth = Number(document.info?.width);
  const sourceHeight = Number(document.info?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error('Azgaar Full JSON must include positive map dimensions.');
  }
  const configuredLongEdge = config.import?.azgaarAtlasLongEdge;
  let atlas;
  if (Number.isInteger(configuredLongEdge) && configuredLongEdge > 0) {
    if (sourceWidth >= sourceHeight) {
      atlas = {
        width: configuredLongEdge,
        height: Math.max(1, Math.round(configuredLongEdge * sourceHeight / sourceWidth)),
      };
    } else {
      atlas = {
        width: Math.max(1, Math.round(configuredLongEdge * sourceWidth / sourceHeight)),
        height: configuredLongEdge,
      };
    }
  } else {
    const width = config.import?.azgaarTargetWidth;
    const height = config.import?.azgaarTargetHeight;
    if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
      throw new Error('Azgaar import requires a positive atlas long edge or target dimensions.');
    }
    atlas = { width, height };
  }
  validateAtlasDimensions(atlas);
  return atlas;
}

function resolvePhysicalDimensions(document, options = {}) {
  const sourceWidth = Number(document.info.width);
  const sourceHeight = Number(document.info.height);
  const distanceScale = Number(document.settings?.distanceScale ?? 1);
  const distanceUnit = String(document.settings?.distanceUnit ?? 'km');
  const unitMeters = UNIT_METERS[distanceUnit] ?? 1000;
  const defaultWidthMeters = sourceWidth * distanceScale * unitMeters;
  const physicalWidthMeters = Number(options.physicalWidthMeters ?? defaultWidthMeters);
  if (!Number.isFinite(physicalWidthMeters) || physicalWidthMeters <= 0) {
    throw new Error('Azgaar physical width override must be positive.');
  }
  return {
    widthMeters: physicalWidthMeters,
    heightMeters: physicalWidthMeters * sourceHeight / sourceWidth,
    distanceScale,
    distanceUnit,
    usedCustomUnitFallback: !(distanceUnit in UNIT_METERS),
  };
}

function buildGridCellLookup(grid) {
  return new Map(grid.cells.map((cell) => [cell.i, cell]));
}

function sourceGridCellAt(document, lookup, normalizedX, normalizedY) {
  const column = clamp(Math.floor(normalizedX * document.grid.cellsX), 0, document.grid.cellsX - 1);
  const row = clamp(Math.floor(normalizedY * document.grid.cellsY), 0, document.grid.cellsY - 1);
  const id = row * document.grid.cellsX + column;
  return lookup.get(id) ?? document.grid.cells[clamp(id, 0, document.grid.cells.length - 1)];
}

function buildPackByGrid(pack) {
  const result = new Map();
  for (const cell of pack?.cells ?? []) {
    if (!Number.isInteger(cell?.g)) continue;
    const cells = result.get(cell.g) ?? [];
    cells.push(cell);
    result.set(cell.g, cells);
  }
  return result;
}

function sourcePackCellAt(cells, sourceX, sourceY) {
  if (!cells?.length) return null;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const cell of cells) {
    const x = Number(cell.p?.[0]);
    const y = Number(cell.p?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const distance = (x - sourceX) ** 2 + (y - sourceY) ** 2;
    if (distance < nearestDistance
        || (distance === nearestDistance && Number(cell.i) < Number(nearest?.i))) {
      nearest = cell;
      nearestDistance = distance;
    }
  }
  if (nearest) return nearest;
  return cells.reduce((selected, cell) => (
    !selected || Number(cell.h ?? 0) > Number(selected.h ?? 0) ? cell : selected
  ), null);
}

function createRiverData(document, atlasWidth, atlasHeight, physicalWidthMeters) {
  const sourceWidth = document.info.width;
  const sourceHeight = document.info.height;
  const packById = new Map((document.pack?.cells ?? []).map((cell) => [cell.i, cell]));
  const distanceScale = Number(document.settings?.distanceScale ?? 1);
  const unitMeters = UNIT_METERS[document.settings?.distanceUnit] ?? 1000;
  const metersPerAtlasPixel = physicalWidthMeters / atlasWidth;
  return (document.pack?.rivers ?? []).flatMap((river) => {
    const points = Array.isArray(river.points) && river.points.length > 1
      ? river.points
      : (river.cells ?? []).flatMap((cellId) => {
        const point = packById.get(cellId)?.p;
        return Array.isArray(point) ? [point] : [];
      });
    if (points.length < 2) return [];
    return [{
      id: river.i,
      widthAtlas: Math.max(
        1 / 256,
        Number(river.width ?? 0.1) * distanceScale * unitMeters / metersPerAtlasPixel,
      ),
      points: points.map(([x, y]) => [
        x / sourceWidth * atlasWidth,
        y / sourceHeight * atlasHeight,
      ]),
    }];
  });
}

function withoutType(payload) {
  const { type: _type, ...legacyPayload } = payload;
  return legacyPayload;
}

export function createMacroAtlasPayload({ heights, biomes, features }) {
  return {
    heightData: withoutType(encodeMacroField(heights, 'u8')),
    biomeData: withoutType(encodeMacroField(biomes, 'u8')),
    featureData: withoutType(encodeMacroField(features, 'u16')),
  };
}

function encodeGuidanceFields(raw, derived) {
  const values = { ...raw, ...derived };
  return Object.fromEntries(Object.entries(GUIDANCE_FIELD_TYPES).map(([name, type]) => {
    const metadata = name === 'population'
      ? { scale: 0.01, unit: 'azgaar-population' }
      : name.endsWith('Potential') || [
        'moisture',
        'continentalness',
        'wetness',
        'mountainness',
        'ruggedness',
        'valleyness',
      ].includes(name)
        ? { scale: 1 / 255, unit: 'normalized' }
        : ['coastDistance', 'riverDistance'].includes(name)
          ? { scale: 1, unit: 'atlas-pixels' }
          : {};
    return [name, encodeMacroField(values[name], type, metadata)];
  }));
}

function assertPayloadLength(payload, expected, name) {
  if (payload?.length !== expected) {
    throw new Error(`Macro atlas field ${name} does not match its dimensions.`);
  }
}

function acceptedFieldTypes(name) {
  return COMPATIBLE_FIELD_TYPES[name] ?? [GUIDANCE_FIELD_TYPES[name]];
}

function fieldPayload(source, name) {
  if (source?.kind === MACRO_SOURCE_KIND && source.version === MACRO_SOURCE_VERSION) {
    return source.atlas?.fields?.[name] ?? null;
  }
  if (source?.kind !== LEGACY_MACRO_SOURCE_KIND || source.version !== LEGACY_MACRO_SOURCE_VERSION) {
    return null;
  }
  const legacyName = LEGACY_FIELD_NAMES[name];
  if (legacyName && source.atlas?.[legacyName]) {
    return source.atlas[legacyName];
  }
  return source.terrainGuidance?.fields?.[name] ?? null;
}

export function hasGuidanceField(source, name) {
  return Boolean(fieldPayload(source, name));
}

export function decodeGuidanceField(source, name) {
  const preferredType = GUIDANCE_FIELD_TYPES[name];
  if (!preferredType) throw new Error(`Unknown Azgaar guidance field ${name}.`);
  const payload = fieldPayload(source, name);
  if (!payload) return null;
  const { length } = validateAtlasDimensions(source.atlas);
  assertPayloadLength(payload, length, name);

  const legacyName = LEGACY_FIELD_NAMES[name];
  const legacyCanonical = source.kind === LEGACY_MACRO_SOURCE_KIND
    && legacyName
    && payload === source.atlas?.[legacyName];
  const encodedType = payload.type ?? (legacyCanonical
    ? (name === 'featureId' ? 'u16' : preferredType)
    : preferredType);
  if (!acceptedFieldTypes(name).includes(encodedType)) {
    throw new Error(
      `Macro atlas field ${name} must use ${acceptedFieldTypes(name).join(' or ')} values.`,
    );
  }
  return decodeMacroField(payload, encodedType);
}

function decodeLegacyMacroAtlas(source) {
  const heights = decodeGuidanceField(source, 'elevation');
  const biomes = decodeGuidanceField(source, 'biomeId');
  const features = decodeGuidanceField(source, 'featureId');
  return {
    heights,
    biomes,
    features,
    fields: { elevation: heights, biomeId: biomes, featureId: features },
  };
}

export function decodeMacroAtlas(source, { includeGuidance = false } = {}) {
  if (!isAzgaarMacroWorldSource(source)) {
    throw new Error(`Unsupported base terrain source: ${source?.kind ?? 'unknown'}.`);
  }
  const { length: expected } = validateAtlasDimensions(source.atlas);
  if (source.kind === MACRO_SOURCE_KIND) {
    for (const name of Object.keys(GUIDANCE_FIELD_TYPES)) {
      const payload = source.atlas.fields?.[name];
      assertPayloadLength(payload, expected, name);
      if (!acceptedFieldTypes(name).includes(payload.type)) {
        throw new Error(
          `Macro atlas field ${name} must use ${acceptedFieldTypes(name).join(' or ')} values.`,
        );
      }
    }
  }

  if (source.kind === LEGACY_MACRO_SOURCE_KIND && !includeGuidance) {
    return decodeLegacyMacroAtlas(source);
  }

  const names = source.kind === MACRO_SOURCE_KIND
    ? (includeGuidance ? Object.keys(GUIDANCE_FIELD_TYPES) : BASIC_FIELDS)
    : [...BASIC_FIELDS, ...Object.keys(source.terrainGuidance?.fields ?? {})];
  const fields = {};
  for (const name of names) {
    if (fields[name] !== undefined) continue;
    const values = decodeGuidanceField(source, name);
    if (values) fields[name] = values;
  }
  const heights = fields.elevation;
  const biomes = fields.biomeId;
  const features = fields.featureId;
  if (heights?.length !== expected || biomes?.length !== expected || features?.length !== expected) {
    throw new Error('Macro atlas dimensions do not match its payloads.');
  }
  if (Object.values(fields).some((values) => values.length !== expected)) {
    throw new Error('World guidance fields do not match the macro atlas dimensions.');
  }
  return { heights, biomes, features, fields };
}

export function buildAzgaarImportSummary(document, config, options = {}) {
  const atlas = resolveAtlasDimensions(document, config);
  const physical = resolvePhysicalDimensions(document, options);
  const biomeDefinitions = createAzgaarBiomeDefinitions(document.biomesData);
  return Object.freeze({
    atlasWidth: atlas.width,
    atlasHeight: atlas.height,
    physicalWidthMeters: Math.round(physical.widthMeters),
    physicalHeightMeters: Math.round(physical.heightMeters),
    distanceScale: physical.distanceScale,
    distanceUnit: physical.distanceUnit,
    usedCustomUnitFallback: physical.usedCustomUnitFallback,
    standardBiomeCount: biomeDefinitions.filter((biome) => biome.standard).length,
    customBiomeCount: biomeDefinitions.filter((biome) => !biome.standard).length,
    guidanceFieldCount: Object.keys(GUIDANCE_FIELD_TYPES).length,
    estimatedRawBytes: atlas.width * atlas.height * 46,
  });
}

export function createAzgaarMacroWorldSource(document, config, options = {}) {
  const summary = buildAzgaarImportSummary(document, config, options);
  const length = summary.atlasWidth * summary.atlasHeight;
  const raw = {
    elevation: new Uint8Array(length),
    temperature: new Int8Array(length),
    precipitation: new Uint8Array(length),
    waterDistance: new Int8Array(length),
    biomeId: new Uint8Array(length),
    featureId: new Uint32Array(length),
    riverId: new Uint32Array(length),
    riverFlux: new Uint32Array(length),
    confluenceFlux: new Uint32Array(length),
    population: new Uint32Array(length),
    settlementScore: new Uint16Array(length),
    harborScore: new Uint8Array(length),
    havenId: new Uint32Array(length),
  };
  const observedBiomeIds = new Set();
  const lookup = buildGridCellLookup(document.grid);
  const packByGrid = buildPackByGrid(document.pack);

  for (let y = 0; y < summary.atlasHeight; y += 1) {
    const normalizedY = (y + 0.5) / summary.atlasHeight;
    for (let x = 0; x < summary.atlasWidth; x += 1) {
      const normalizedX = (x + 0.5) / summary.atlasWidth;
      const gridCell = sourceGridCellAt(document, lookup, normalizedX, normalizedY);
      const packCell = sourcePackCellAt(
        packByGrid.get(gridCell.i),
        normalizedX * document.info.width,
        normalizedY * document.info.height,
      );
      const index = y * summary.atlasWidth + x;
      raw.elevation[index] = clamp(Math.round(Number(packCell?.h ?? gridCell.h ?? 0)), 0, 100);
      raw.temperature[index] = clamp(Math.round(Number(gridCell.temp ?? 0)), -128, 127);
      raw.precipitation[index] = clamp(Math.round(Number(gridCell.prec ?? 0)), 0, 255);
      raw.waterDistance[index] = clamp(Math.round(Number(gridCell.t ?? 0)), -128, 127);
      raw.biomeId[index] = clamp(Math.round(Number(packCell?.biome ?? 0)), 0, 255);
      observedBiomeIds.add(raw.biomeId[index]);
      raw.featureId[index] = clamp(Math.round(Number(packCell?.f ?? gridCell.f ?? 0)), 0, 0xffffffff);
      raw.riverId[index] = clamp(Math.round(Number(packCell?.r ?? 0)), 0, 0xffffffff);
      raw.riverFlux[index] = clamp(Math.round(Number(packCell?.fl ?? 0)), 0, 0xffffffff);
      raw.confluenceFlux[index] = clamp(Math.round(Number(packCell?.conf ?? 0)), 0, 0xffffffff);
      raw.population[index] = clamp(Math.round(Number(packCell?.pop ?? 0) * 100), 0, 0xffffffff);
      raw.settlementScore[index] = clamp(Math.round(Number(packCell?.s ?? 0)), 0, 0xffff);
      raw.harborScore[index] = clamp(Math.round(Number(packCell?.harbor ?? 0)), 0, 255);
      raw.havenId[index] = clamp(Math.round(Number(packCell?.haven ?? 0)), 0, 0xffffffff);
    }
  }

  const biomeDefinitions = createAzgaarBiomeDefinitions(document.biomesData, observedBiomeIds);
  const rivers = createRiverData(
    document,
    summary.atlasWidth,
    summary.atlasHeight,
    summary.physicalWidthMeters,
  );
  const derived = deriveAzgaarWorldGuidance({
    raw,
    rivers,
    width: summary.atlasWidth,
    height: summary.atlasHeight,
    physicalWidthMeters: summary.physicalWidthMeters,
    biomes: biomeDefinitions,
    config: config.import.azgaarGuidance,
  });
  const widthCells = Math.max(1, Math.round(summary.physicalWidthMeters / config.map.tileSize));
  const heightCells = Math.max(1, Math.round(summary.physicalHeightMeters / config.map.tileSize));
  const transitionKm = Number(config.import?.azgaarOceanTransitionKilometers ?? 50);
  return {
    kind: MACRO_SOURCE_KIND,
    version: MACRO_SOURCE_VERSION,
    source: {
      version: document.info.version ?? null,
      mapId: document.info.mapId ?? null,
      mapName: document.info.mapName ?? document.settings?.mapName ?? 'Azgaar world',
      seed: document.info.seed ?? document.grid.seed ?? null,
    },
    atlas: {
      width: summary.atlasWidth,
      height: summary.atlasHeight,
      fields: encodeGuidanceFields(raw, derived),
    },
    physical: {
      widthMeters: summary.physicalWidthMeters,
      heightMeters: summary.physicalHeightMeters,
      distanceScale: summary.distanceScale,
      distanceUnit: summary.distanceUnit,
    },
    bounds: {
      minCellX: -Math.floor(widthCells / 2),
      minCellZ: -Math.floor(heightCells / 2),
      widthCells,
      heightCells,
    },
    oceanTransitionCells: Math.max(
      1,
      Math.round(transitionKm * 1000 / config.map.tileSize),
    ),
    terrain: {
      minHeight: config.terrain.minHeight,
      maxHeight: config.terrain.maxHeight,
      seaLevel: config.world.seaLevel,
      verticalExaggeration: resolvePositive(config.import?.azgaarVerticalExaggeration, 1),
      reliefExponent: resolvePositive(config.import?.azgaarReliefExponent, 1),
    },
    biomes: biomeDefinitions,
    rivers,
  };
}

export const AZGAAR_MACRO_SOURCE_KIND = MACRO_SOURCE_KIND;
export const AZGAAR_LEGACY_MACRO_SOURCE_KIND = LEGACY_MACRO_SOURCE_KIND;
export const AZGAAR_GUIDANCE_FIELD_NAMES = Object.freeze(Object.keys(GUIDANCE_FIELD_TYPES));
export function isAzgaarMacroWorldSource(source) {
  return (source?.kind === MACRO_SOURCE_KIND && source.version === MACRO_SOURCE_VERSION)
    || (source?.kind === LEGACY_MACRO_SOURCE_KIND
      && source.version === LEGACY_MACRO_SOURCE_VERSION);
}
