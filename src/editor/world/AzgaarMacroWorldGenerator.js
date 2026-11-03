import {
  decodeGuidanceField,
  hasGuidanceField,
} from '../import/AzgaarMacroWorldSource.js';
import { WorldGuidanceField } from './WorldGuidanceField.js';
import { ridgeFineHeight, ridgeHeight, validateMountainRidges } from './MountainRidges.js';
import { landformRelief } from './TerrainLandforms.js';
import { canyonRelief } from './CanyonRelief.js';
import { valueNoise } from './valueNoise2d.js';
import { createBiomeBoundaryWarp } from './BiomeBoundaryWarp.js';
import { TrailGrading, validateTrailGrading } from './TrailGrading.js';
import { validateRouteMetadata } from '../import/AzgaarRoutes.js';
import { SettlementField } from './settlements/SettlementField.js';
import { settlementRegistryKey, validSettlementRegistry } from './settlements/SettlementRegistry.js';
import { validateSettlementMetadata } from './settlements/SettlementData.js';
import { TILE_BY_KEY } from '../tileCatalog.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from './worldConstants.js';

const WATER_TILE_ID = 0;
/** Graded routes draw as the editor's Road tile, whose path shading already exists. */
const PATH_TILE_ID = TILE_BY_KEY.get('road').id;
const LAND_HEIGHT = 20;
const MOUNTAIN_RUGGEDNESS = 0.25;
/** Raw heights over which landforms rise from a coast: much of a map's lowland sits this close. */
const LANDFORM_COAST_RAW = 2.5;
const ridgeHeightWithFine = (...args) => ridgeHeight(...args) + ridgeFineHeight(...args);
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
  if (terrain.ridges !== undefined && terrain.ridges !== null) {
    validateMountainRidges(terrain.ridges, 'Azgaar macro source terrain ridges');
  }
  if (terrain.trails !== undefined && terrain.trails !== null) {
    validateTrailGrading(terrain.trails, 'Azgaar macro source terrain trails');
  }
  if (terrain.canyonBiomes !== undefined
      && (!Array.isArray(terrain.canyonBiomes)
        || terrain.canyonBiomes.some((id) => !Number.isInteger(id) || id < 0 || id > 255))) {
    throw new Error('Azgaar macro source terrain canyonBiomes must list biome source ids.');
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

function validateLakeMetadata(lakes) {
  if (lakes == null) return;
  if (!Array.isArray(lakes)) {
    throw new Error('Azgaar macro source lakes must be an array.');
  }
  for (const lake of lakes) {
    if (!Number.isSafeInteger(lake?.id) || lake.id < 0 || !Number.isFinite(lake.height)
        || !Array.isArray(lake.outline) || lake.outline.length < 3) {
      throw new Error('Azgaar macro source contains invalid lake metadata.');
    }
    for (const point of lake.outline) {
      if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
        throw new Error('Azgaar macro source contains invalid lake coordinates.');
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
    validateLakeMetadata(source.lakes);
    validateRouteMetadata(source.routes);
    validateSettlementMetadata(source.settlements);
    this.source = source;
    this.trailGrading = undefined;
    this.settlementField = undefined;
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
    this.biomeWarp = createBiomeBoundaryWarp({
      seed: this.seed,
      cellsPerTexel: source.bounds.widthCells / source.atlas.width,
    });
    this.biomeWarpScratch = { x: 0, z: 0 };
    // Per texel: 0 unknown, 1 its land neighbours share its biome (no border in
    // warp reach, so the warp is skipped), 2 a border is within reach.
    this.biomeTexelMixed = this.biomeWarp ? new Uint8Array(source.atlas.width * source.atlas.height) : null;
    // 1 where a texel's biome asks for canyon relief; null when none does, so other worlds skip it.
    const canyonBiomes = new Set(source.terrain.canyonBiomes ?? []);
    this.canyonMask = canyonBiomes.size && this.biomeAtlas.some((id) => canyonBiomes.has(id))
      ? Uint8Array.from(this.biomeAtlas, (id) => (canyonBiomes.has(id) ? 1 : 0))
      : null;
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
    return this.sampleAtlasBilinear(this.heights, cellX, cellZ);
  }

  /** 0..1, how far a vertex lies inside canyon country, eased across one atlas texel. */
  canyonWeight(cellX, cellZ) {
    return this.canyonMask ? this.sampleAtlasBilinear(this.canyonMask, cellX, cellZ) : 0;
  }

  sampleAtlasBilinear(values, cellX, cellZ) {
    const { width, height } = this.source.atlas;
    const position = this.toAtlasPosition(cellX, cellZ);
    const fx = clamp(position.x - 0.5, 0, width - 1);
    const fy = clamp(position.y - 0.5, 0, height - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const north = lerp(
      values[this.atlasIndex(x0, y0)],
      values[this.atlasIndex(x1, y0)],
      fx - x0,
    );
    const south = lerp(
      values[this.atlasIndex(x0, y1)],
      values[this.atlasIndex(x1, y1)],
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

  /**
   * The ground, with roads and trails graded into it for worlds imported with
   * trail grading (`import.azgaarTrails`).
   */
  sampleHeight(vertexX, vertexZ) {
    const ground = this.sampleGroundHeight(vertexX, vertexZ);
    const settlements = this.ensureSettlementField();
    return settlements ? settlements.grade(vertexX, vertexZ, ground) : ground;
  }

  /** The ground with paths graded in, before settlement pads are flattened into it. */
  sampleGroundHeight(vertexX, vertexZ) {
    const height = this.sampleTerrainHeight(vertexX, vertexZ);
    const trails = this.ensureTrailGrading();
    return trails ? trails.grade(vertexX, vertexZ, height) : height;
  }

  /**
   * Azgaar burgs planned as settlements (world/settlements). Built on first use;
   * each settlement is planned only when something asks about ground inside it.
   */
  ensureSettlementField() {
    if (this.settlementField !== undefined) return this.settlementField;
    const settlements = this.source.settlements;
    if (!settlements?.length) {
      this.settlementField = null;
      return null;
    }
    if (validSettlementRegistry(this.source.settlementRegistry, this.settlementRegistryKey)) {
      return this.installSettlementRegistry(this.source.settlementRegistry);
    }
    const { bounds, atlas, physical } = this.source;
    const toCell = ([x, y]) => [
      bounds.minCellX + x / atlas.width * bounds.widthCells,
      bounds.minCellZ + y / atlas.height * bounds.heightCells,
    ];
    this.settlementField = new SettlementField({
      settlements,
      tileSize: physical?.widthMeters > 0 ? physical.widthMeters / bounds.widthCells : 2,
      worldSeed: this.seed,
      routes: (this.source.routes ?? []).map((route) => route.points.map(toCell)),
      sampleGround: (cellX, cellZ) => this.sampleGroundHeight(cellX, cellZ),
      isBuildable: (cellX, cellZ) => this.isDryLand(cellX, cellZ),
      landSearchStepCells: bounds.widthCells / atlas.width,
    });
    return this.settlementField;
  }

  // Large source fingerprints belong to import/settlement workers. Direct
  // synchronous callers retain validation, but construction no longer pays it.
  get settlementRegistryKey() {
    return this._settlementRegistryKey ??= this.source.settlements?.length
      ? settlementRegistryKey(this.source, this.seed) : null;
  }

  adoptPreparedSettlementRegistry(registry) {
    // Called only with the response to this world's worker request. Epoch and
    // generator ownership are checked by SettlementRegistryPreparation.
    if (!validSettlementRegistry(registry, registry?.key)) throw new Error('Invalid prepared settlement registry.');
    this._settlementRegistryKey = registry.key;
    return this.installSettlementRegistry(registry);
  }

  installSettlementRegistry(registry) {
    if (!validSettlementRegistry(registry, this.settlementRegistryKey)) throw new Error('Mismatched settlement registry.');
    this.settlementField = SettlementField.fromRegistry(registry, {
      sampleGround: (x, z) => this.sampleGroundHeight(x, z),
      isBuildable: (x, z) => this.isDryLand(x, z),
    });
    return this.settlementField;
  }

  /** Plans of the settlements near a cell, nearest first, for the renderer. */
  settlementsNear(cellX, cellZ, radiusCells) {
    return this.ensureSettlementField()?.near(cellX, cellZ, radiusCells) ?? [];
  }

  /** Inside the map, above the coast and off any river. */
  isDryLand(cellX, cellZ) {
    if (!this.isInside(cellX, cellZ)) return false;
    return this.sampleRawHeight(cellX, cellZ) >= LAND_HEIGHT + 0.5 && !this.isRiver(Math.floor(cellX), Math.floor(cellZ));
  }

  /** Built on first use: indexing the routes is only worth it where heights are asked for. */
  ensureTrailGrading() {
    if (this.trailGrading !== undefined) return this.trailGrading;
    const grading = this.source.terrain.trails;
    this.trailGrading = grading && this.source.routes?.length
      ? new TrailGrading({
        source: this.source,
        sampleTerrainHeight: (x, z) => this.sampleTerrainHeight(x, z),
        grading,
      })
      : null;
    return this.trailGrading;
  }

  /** The ground before any path is graded into it. */
  sampleTerrainHeight(vertexX, vertexZ) {
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
    // Mesas replace the crests: ridged noise over a flat top reads as hills again.
    const canyon = this.canyonWeight(vertexX, vertexZ);
    // The far backdrop skips landforms: it sits heightBias under them, past their reach.
    return base
      + detail * coastFade * ruggedness * this.morphologyScale(vertexX, vertexZ)
      + landformRelief(vertexX, vertexZ, this.seed) * clamp((rawHeight - LAND_HEIGHT) / LANDFORM_COAST_RAW, 0, 1)
      + this.ridgeRelief(vertexX, vertexZ, elevationFraction, ridgeHeightWithFine) * coastFade * (1 - canyon)
      + (canyon > 0 ? canyonRelief(vertexX, vertexZ, this.seed) * canyon * coastFade : 0);
  }

  /**
   * Ridged crests on high ground, for worlds imported with ridges
   * (`import.azgaarRidges`). Mountainness guidance, where a world has it,
   * sharpens true ranges and softens high plateaus.
   */
  ridgeRelief(vertexX, vertexZ, elevationFraction, relief = ridgeHeight) {
    const ridges = this.source.terrain.ridges;
    if (!ridges) return 0;
    let scale = 1;
    if (this.hasMorphologyGuidance && elevationFraction > ridges.startRelief) {
      const mountainness = this.ensureGuidance()
        .sampleContinuous('mountainness', vertexX - 0.5, vertexZ - 0.5) ?? 0.5;
      scale = 0.6 + clamp(mountainness, 0, 1) * 0.6;
    }
    return relief(vertexX, vertexZ, this.seed, elevationFraction, ridges, scale);
  }

  sampleMacroColumn(cellX, cellZ) {
    const rawHeight = this.sampleRawHeight(cellX, cellZ);
    let height = convertHeight(rawHeight, this.source.terrain);
    if (!this.isInside(cellX, cellZ)) {
      const amount = smoothstep(
        this.outsideDistance(cellX, cellZ) / this.source.oceanTransitionCells,
      );
      height = lerp(height, this.source.terrain.minHeight * 0.35, amount);
    } else if (rawHeight >= LAND_HEIGHT) {
      // The far backdrop carries the same crests, so ranges keep their shape
      // where near terrain hands over to it.
      const canyon = this.canyonWeight(cellX, cellZ);
      height += this.ridgeRelief(cellX, cellZ, landReliefFraction(rawHeight, this.source.terrain)) * (1 - canyon)
        + (canyon > 0 ? canyonRelief(cellX, cellZ, this.seed, false) * canyon : 0);
    }
    return { height, tileId: this.sampleTile(cellX, cellZ) };
  }

  /** A lake's surface in metres, by the same mapping as the land around it. */
  lakeSurfaceHeight(lake) {
    return convertHeight(lake.height, this.source.terrain);
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

  /** The Azgaar biome tile id under a cell, ignoring paths, streets and rivers; null outside. */
  sampleBiome(cellX, cellZ) {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) return null;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    return this.biomeBySourceId.get(this.biomeAtlas[this.biomeIndexAt(cellX, cellZ, index)])?.tileId ?? null;
  }

  /**
   * Whether a biome border lies within warp reach of a texel. The warp's
   * octaves sum to under one texel, so only the 3×3 neighbourhood can be read;
   * deep inside a biome — most cells — the warp is skipped entirely.
   */
  biomeBorderNear(index) {
    const cached = this.biomeTexelMixed[index];
    if (cached) return cached === 2;
    const { width, height } = this.source.atlas;
    const tx = index % width;
    const ty = (index - tx) / width;
    const own = this.biomeAtlas[index];
    let mixed = false;
    for (let y = Math.max(0, ty - 1); y <= Math.min(height - 1, ty + 1) && !mixed; y += 1) {
      for (let x = Math.max(0, tx - 1); x <= Math.min(width - 1, tx + 1); x += 1) {
        const neighbour = y * width + x;
        if (this.heights[neighbour] >= LAND_HEIGHT && this.biomeAtlas[neighbour] !== own) {
          mixed = true;
          break;
        }
      }
    }
    this.biomeTexelMixed[index] = mixed ? 2 : 1;
    return mixed;
  }

  /**
   * The atlas texel whose biome a land cell wears: its own texel read through
   * the boundary warp (BiomeBoundaryWarp.js), so borders follow no grid. Water
   * stays where the unwarped heights put it — a warped read that lands in the
   * sea or on a lake keeps the cell's own biome rather than drowning it.
   */
  biomeIndexAt(cellX, cellZ, landIndex) {
    if (!this.biomeWarp || !this.biomeBorderNear(landIndex)) return landIndex;
    const offset = this.biomeWarp(cellX + 0.5, cellZ + 0.5, this.biomeWarpScratch);
    const position = this.toAtlasPosition(cellX + 0.5 + offset.x, cellZ + 0.5 + offset.z);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    if (index === landIndex || this.heights[index] < LAND_HEIGHT) return landIndex;
    const definition = this.biomeBySourceId.get(this.biomeAtlas[index]);
    return definition && definition.tileId !== WATER_TILE_ID ? index : landIndex;
  }

  sampleTile(cellX, cellZ) {
    if (!this.isInside(cellX + 0.5, cellZ + 0.5)) return WATER_TILE_ID;
    const position = this.toAtlasPosition(cellX + 0.5, cellZ + 0.5);
    const index = this.atlasIndex(Math.floor(position.x), Math.floor(position.y));
    const rawHeight = this.heights[index];
    if (rawHeight >= LAND_HEIGHT && this.isRiver(cellX, cellZ)) return WATER_TILE_ID;
    if (rawHeight < LAND_HEIGHT) return WATER_TILE_ID;
    if ((this.ensureTrailGrading()?.pathCover(cellX + 0.5, cellZ + 0.5) ?? 0) >= 0.5) return PATH_TILE_ID;
    if ((this.ensureSettlementField()?.cover(cellX + 0.5, cellZ + 0.5) ?? 0) >= 0.5) return PATH_TILE_ID;
    return this.biomeBySourceId.get(this.biomeAtlas[this.biomeIndexAt(cellX, cellZ, index)]).tileId;
  }
}
