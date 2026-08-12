import {
  decodeGuidanceField,
  hasGuidanceField,
} from '../import/AzgaarMacroWorldSource.js';
import { WorldGuidanceField } from './WorldGuidanceField.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from './worldConstants.js';

const WATER_TILE_ID = 0;
const LAND_HEIGHT = 20;
const MOUNTAIN_RUGGEDNESS = 0.25;
const LEGACY_DETAIL_GUIDANCE = Object.freeze({
  baseScale: 0.75,
  mountainWeight: 0.35,
  ruggednessWeight: 0.35,
  valleyPenalty: 0.25,
  minimumScale: 0.45,
  maximumScale: 1.5,
});
const GUIDANCE_DETAIL_FIELDS = Object.freeze([
  'baseScale',
  'mountainWeight',
  'ruggednessWeight',
  'valleyPenalty',
  'minimumScale',
  'maximumScale',
]);

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2d(x, z, seed) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const north = lerp(hash2d(x0, z0, seed), hash2d(x0 + 1, z0, seed), tx);
  const south = lerp(hash2d(x0, z0 + 1, seed), hash2d(x0 + 1, z0 + 1, seed), tx);
  return lerp(north, south, tz) * 2 - 1;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const amount = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + dx * amount), py - (ay + dy * amount));
}

function landReliefFraction(rawHeight, terrain) {
  const normalized = clamp((rawHeight - LAND_HEIGHT) / (100 - LAND_HEIGHT), 0, 1);
  const exponent = terrain.reliefExponent ?? 1;
  return exponent === 1 ? normalized : normalized ** exponent;
}

function convertHeight(rawHeight, terrain) {
  if (rawHeight < LAND_HEIGHT) {
    return terrain.minHeight * clamp((LAND_HEIGHT - rawHeight) / LAND_HEIGHT, 0, 1) * 0.35;
  }
  const exaggeration = terrain.verticalExaggeration ?? 1;
  return landReliefFraction(rawHeight, terrain) * terrain.maxHeight * 0.85 * exaggeration;
}

function createRiverIndex(rivers, width, height) {
  const buckets = new Map();
  for (const river of rivers ?? []) {
    for (let index = 1; index < river.points.length; index += 1) {
      const [ax, ay] = river.points[index - 1];
      const [bx, by] = river.points[index];
      const segment = { ax, ay, bx, by, width: river.widthAtlas };
      const margin = Math.max(0.5, river.widthAtlas);
      const minX = clamp(Math.floor(Math.min(ax, bx) - margin), 0, width - 1);
      const maxX = clamp(Math.floor(Math.max(ax, bx) + margin), 0, width - 1);
      const minY = clamp(Math.floor(Math.min(ay, by) - margin), 0, height - 1);
      const maxY = clamp(Math.floor(Math.max(ay, by) + margin), 0, height - 1);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const key = `${x}:${y}`;
          const entries = buckets.get(key) ?? [];
          entries.push(segment);
          buckets.set(key, entries);
        }
      }
    }
  }
  return buckets;
}

function validateBiomeDefinitions(definitions) {
  if (!Array.isArray(definitions) || definitions.length < 13) {
    throw new Error('Azgaar macro source must include its biome definitions.');
  }
  const sourceIds = new Set();
  const tileIds = new Set();
  for (const definition of definitions) {
    if (
      !Number.isInteger(definition?.sourceId)
      || definition.sourceId < 0
      || definition.sourceId > 255
      || sourceIds.has(definition.sourceId)
    ) {
      throw new Error('Azgaar macro source has invalid or duplicate biome source ids.');
    }
    if (
      !Number.isInteger(definition.tileId)
      || definition.tileId < 0
      || definition.tileId > 254
      || (definition.sourceId >= 13 && definition.tileId < 32)
      || tileIds.has(definition.tileId)
    ) {
      throw new Error('Azgaar macro source has invalid or duplicate biome terrain ids.');
    }
    if (
      typeof definition.name !== 'string'
      || definition.name.trim() === ''
      || typeof definition.color !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(definition.color)
    ) {
      throw new Error(`Azgaar macro source has invalid metadata for biome ${definition.sourceId}.`);
    }
    sourceIds.add(definition.sourceId);
    tileIds.add(definition.tileId);
  }
  for (let sourceId = 0; sourceId < 13; sourceId += 1) {
    const definition = definitions.find((entry) => entry.sourceId === sourceId);
    if (!definition || definition.tileId !== sourceId || definition.standard !== true) {
      throw new Error('Azgaar standard biome ids must map directly to terrain ids 0–12.');
    }
  }
}

function validateBounds(bounds) {
  const minCellX = bounds?.minCellX;
  const minCellZ = bounds?.minCellZ;
  const widthCells = bounds?.widthCells;
  const heightCells = bounds?.heightCells;
  if (!Number.isSafeInteger(minCellX) || !Number.isSafeInteger(minCellZ)
      || !Number.isSafeInteger(widthCells) || widthCells < 1
      || !Number.isSafeInteger(heightCells) || heightCells < 1) {
    throw new Error('Azgaar macro source has invalid world bounds.');
  }
  const maxCellX = minCellX + widthCells - 1;
  const maxCellZ = minCellZ + heightCells - 1;
  if (!Number.isSafeInteger(maxCellX) || !Number.isSafeInteger(maxCellZ)
      || Math.abs(minCellX) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(maxCellX) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(minCellZ) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(maxCellZ) > WORLD_MAX_SAFE_CELL_COORDINATE) {
    throw new Error('Azgaar macro source world bounds exceed the engine coordinate limit.');
  }
}

function validateTerrainMetadata(terrain, oceanTransitionCells) {
  if (!terrain
      || !Number.isFinite(terrain.minHeight)
      || !Number.isFinite(terrain.maxHeight)
      || !Number.isFinite(terrain.seaLevel)
      || terrain.maxHeight <= terrain.minHeight) {
    throw new Error('Azgaar macro source has invalid terrain height metadata.');
  }
  for (const name of ['verticalExaggeration', 'reliefExponent']) {
    if (terrain[name] !== undefined
        && (!Number.isFinite(terrain[name]) || terrain[name] <= 0)) {
      throw new Error(`Azgaar macro source terrain ${name} must be positive.`);
    }
  }
  if (!Number.isFinite(oceanTransitionCells) || oceanTransitionCells <= 0) {
    throw new Error('Azgaar macro source ocean transition must be positive.');
  }
  const detail = terrain.guidanceDetail;
  if (detail === undefined) return;
  if (!detail || GUIDANCE_DETAIL_FIELDS.some((name) => !Number.isFinite(detail[name]))) {
    throw new Error('Azgaar macro source has invalid terrain guidance detail metadata.');
  }
  if (detail.minimumScale <= 0 || detail.maximumScale < detail.minimumScale) {
    throw new Error('Azgaar macro source terrain guidance detail scale range is invalid.');
  }
}

function validateRiverMetadata(rivers) {
  if (rivers == null) return;
  if (!Array.isArray(rivers)) {
    throw new Error('Azgaar macro source rivers must be an array.');
  }
  for (const river of rivers) {
    if (!Number.isFinite(river?.widthAtlas) || river.widthAtlas <= 0
        || !Array.isArray(river.points) || river.points.length < 2) {
      throw new Error('Azgaar macro source contains invalid river metadata.');
    }
    for (const point of river.points) {
      if (!Array.isArray(point) || point.length < 2
          || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        throw new Error('Azgaar macro source contains invalid river coordinates.');
      }
    }
  }
}

export class AzgaarMacroWorldGenerator {
  constructor(source, proceduralMetadata) {
    validateBounds(source.bounds);
    validateTerrainMetadata(source.terrain, source.oceanTransitionCells);
    validateBiomeDefinitions(source.biomes);
    validateRiverMetadata(source.rivers);
    this.source = source;
    this.heights = decodeGuidanceField(source, 'elevation');
    this.biomeAtlas = decodeGuidanceField(source, 'biomeId');
    this.features = hasGuidanceField(source, 'featureId')
      ? decodeGuidanceField(source, 'featureId')
      : null;
    if (!this.heights || !this.biomeAtlas) {
      throw new Error('Azgaar macro source is missing required terrain fields.');
    }
    this.guidance = null;
    this.hasMorphologyGuidance = ['mountainness', 'ruggedness', 'valleyness']
      .every((name) => hasGuidanceField(source, name));
    this.biomeBySourceId = new Map(
      source.biomes.map((definition) => [definition.sourceId, definition]),
    );
    this.tileDefinitionById = new Map(source.biomes.map((definition) => [
      definition.tileId,
      Object.freeze({
        id: definition.tileId,
        key: definition.key,
        label: definition.name,
        color: definition.color,
        icon: definition.icon,
        terrainClass: definition.terrainClass,
        supportsGrass: definition.supportsGrass,
        supportsTrees: definition.supportsTrees,
        azgaarSourceId: definition.sourceId,
      }),
    ]));
    for (const sourceId of new Set(this.biomeAtlas)) {
      if (!this.biomeBySourceId.has(sourceId)) {
        throw new Error(`Azgaar macro source has no definition for biome ${sourceId}.`);
      }
    }
    this.seed = proceduralMetadata.seed;
    this.version = proceduralMetadata.version;
    this.heightScale = proceduralMetadata.heightScale;
    this.seaLevel = proceduralMetadata.seaLevel;
    this.riverIndex = createRiverIndex(
      source.rivers,
      source.atlas.width,
      source.atlas.height,
    );
  }

  ensureGuidance() {
    const fields = {
      elevation: this.heights,
      biomeId: this.biomeAtlas,
    };
    if (this.features) fields.featureId = this.features;
    this.guidance ??= new WorldGuidanceField(this.source, { fields });
    return this.guidance;
  }

  toMetadata() {
    return Object.freeze({
      seed: this.seed,
      version: this.version,
      heightScale: this.heightScale,
      seaLevel: this.seaLevel,
    });
  }

  toBaseTerrain() {
    return structuredClone(this.source);
  }

  getTileDefinition(tileId) {
    return this.tileDefinitionById.get(tileId) ?? null;
  }

  sampleGuidance(cellX, cellZ) {
    return this.ensureGuidance().sample(cellX, cellZ);
  }

  sampleBiomeBlend(cellX, cellZ) {
    return this.ensureGuidance().sampleBiomeBlend(cellX, cellZ);
  }

  getSurfaceMaskConfig(maskConfig) {
    return {
      ...maskConfig,
      waterTileId: WATER_TILE_ID,
      grassTileIds: this.source.biomes
        .filter((definition) => definition.supportsGrass)
        .map((definition) => definition.tileId),
    };
  }

  toAtlasPosition(cellX, cellZ) {
    const { bounds, atlas } = this.source;
    return {
      x: (cellX - bounds.minCellX) / bounds.widthCells * atlas.width,
      y: (cellZ - bounds.minCellZ) / bounds.heightCells * atlas.height,
    };
  }

  isInside(cellX, cellZ) {
    const { bounds } = this.source;
    return cellX >= bounds.minCellX
      && cellZ >= bounds.minCellZ
      && cellX < bounds.minCellX + bounds.widthCells
      && cellZ < bounds.minCellZ + bounds.heightCells;
  }

  atlasIndex(x, y) {
    const { width, height } = this.source.atlas;
    const clampedX = clamp(x, 0, width - 1);
    const clampedY = clamp(y, 0, height - 1);
    return clampedY * width + clampedX;
  }

  sampleRawHeight(cellX, cellZ) {
    const { width, height } = this.source.atlas;
    const position = this.toAtlasPosition(cellX, cellZ);
    const fx = clamp(position.x - 0.5, 0, width - 1);
    const fy = clamp(position.y - 0.5, 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const north = lerp(
      this.heights[this.atlasIndex(x0, y0)],
      this.heights[this.atlasIndex(x1, y0)],
      fx - x0,
    );
    const south = lerp(
      this.heights[this.atlasIndex(x0, y1)],
      this.heights[this.atlasIndex(x1, y1)],
      fx - x0,
    );
    return lerp(north, south, fy - y0);
  }

  outsideDistance(cellX, cellZ) {
    const { bounds } = this.source;
    const maxX = bounds.minCellX + bounds.widthCells;
    const maxZ = bounds.minCellZ + bounds.heightCells;
    return Math.hypot(
      Math.max(bounds.minCellX - cellX, 0, cellX - maxX),
      Math.max(bounds.minCellZ - cellZ, 0, cellZ - maxZ),
    );
  }

  morphologyScale(vertexX, vertexZ) {
    if (!this.hasMorphologyGuidance) return 1;
    const guidance = this.ensureGuidance();
    const mountainness = guidance.sampleContinuous('mountainness', vertexX - 0.5, vertexZ - 0.5) ?? 0;
    const ruggedness = guidance.sampleContinuous('ruggedness', vertexX - 0.5, vertexZ - 0.5) ?? 0;
    const valleyness = guidance.sampleContinuous('valleyness', vertexX - 0.5, vertexZ - 0.5) ?? 0;
    const tuning = this.source.terrain.guidanceDetail ?? LEGACY_DETAIL_GUIDANCE;
    return clamp(
      tuning.baseScale
        + mountainness * tuning.mountainWeight
        + ruggedness * tuning.ruggednessWeight
        - valleyness * tuning.valleyPenalty,
      tuning.minimumScale,
      tuning.maximumScale,
    );
  }

  sampleHeight(vertexX, vertexZ) {
    const rawHeight = this.sampleRawHeight(vertexX, vertexZ);
    const base = convertHeight(rawHeight, this.source.terrain);
    if (!this.isInside(vertexX, vertexZ)) {
      const amount = smoothstep(
        this.outsideDistance(vertexX, vertexZ) / this.source.oceanTransitionCells,
      );
      return lerp(base, this.source.terrain.minHeight * 0.35, amount);
    }
    if (rawHeight < LAND_HEIGHT) return base;
    const coastFade = clamp((rawHeight - LAND_HEIGHT) / 10, 0, 1);
    const exaggeration = this.source.terrain.verticalExaggeration ?? 1;
    const elevationFraction = landReliefFraction(rawHeight, this.source.terrain);
    const ruggedness = 1 + (exaggeration - 1) * elevationFraction * MOUNTAIN_RUGGEDNESS;
    const detail = (
      valueNoise(vertexX / 96, vertexZ / 96, this.seed + 1709) * 1.4
      + valueNoise(vertexX / 24, vertexZ / 24, this.seed + 1877) * 0.35
    );
    return base + detail * coastFade * ruggedness * this.morphologyScale(vertexX, vertexZ);
  }

  sampleMacroColumn(cellX, cellZ) {
    const rawHeight = this.sampleRawHeight(cellX, cellZ);
    let height = convertHeight(rawHeight, this.source.terrain);
    if (!this.isInside(cellX, cellZ)) {
      const amount = smoothstep(
        this.outsideDistance(cellX, cellZ) / this.source.oceanTransitionCells,
      );
      height = lerp(height, this.source.terrain.minHeight * 0.35, amount);
    }
    return { height, tileId: this.sampleTile(cellX, cellZ) };
  }

  isRiver(cellX, cellZ) {
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const key = `${Math.floor(position.x)}:${Math.floor(position.y)}`;
    const segments = this.riverIndex.get(key);
    if (!segments) return false;
    return segments.some((segment) => pointSegmentDistance(
      position.x,
      position.y,
      segment.ax,
      segment.ay,
      segment.bx,
      segment.by,
    ) <= segment.width * 0.5);
  }

  sampleTile(cellX, cellZ) {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) return WATER_TILE_ID;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    const rawHeight = this.heights[index];
    if (rawHeight >= LAND_HEIGHT && this.isRiver(cellX, cellZ)) return WATER_TILE_ID;
    if (rawHeight < LAND_HEIGHT) return WATER_TILE_ID;
    return this.biomeBySourceId.get(this.biomeAtlas[index]).tileId;
  }
}
