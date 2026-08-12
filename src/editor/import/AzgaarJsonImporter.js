import {
  INFINITE_WORLD_FORMAT_VERSION,
  WORLD_MAX_SAFE_CELL_COORDINATE,
} from '../world/worldConstants.js';
import { createAzgaarCartographySource } from './AzgaarCartographySource.js';
import {
  buildAzgaarImportSummary,
  createAzgaarMacroWorldSource,
} from './AzgaarMacroWorldSource.js';

function assertFinitePoint(point, fieldName) {
  if (!Array.isArray(point)
      || point.length < 2
      || !Number.isFinite(Number(point[0]))
      || !Number.isFinite(Number(point[1]))) {
    throw new Error(`Azgaar Full JSON ${fieldName} must contain finite x/y coordinates.`);
  }
}

function assertPackedCells(document, gridIds) {
  const cells = document?.pack?.cells;
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new Error('Azgaar Full JSON must include non-empty packed cells.');
  }
  const ids = new Set();
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell?.i) || cell.i < 0) {
      throw new Error('Azgaar Full JSON packed cells must have non-negative safe-integer ids.');
    }
    if (ids.has(cell.i)) {
      throw new Error(`Azgaar Full JSON contains duplicate packed cell id ${cell.i}.`);
    }
    ids.add(cell.i);
    if (!Number.isSafeInteger(cell.g) || !gridIds.has(cell.g)) {
      throw new Error(`Azgaar packed cell ${cell.i} references an invalid grid cell.`);
    }
    if (cell.p !== undefined) {
      assertFinitePoint(cell.p, `packed cell ${cell.i} position`);
    }
  }
  return ids;
}

function assertRivers(document, packedCellIds) {
  const rivers = document?.pack?.rivers;
  if (rivers === undefined) return;
  if (!Array.isArray(rivers)) {
    throw new Error('Azgaar Full JSON pack.rivers must be an array when present.');
  }
  const ids = new Set();
  for (const river of rivers) {
    if (!Number.isSafeInteger(river?.i) || river.i < 0 || ids.has(river.i)) {
      throw new Error('Azgaar Full JSON rivers must have unique non-negative safe-integer ids.');
    }
    ids.add(river.i);
    if (river.width !== undefined
        && (!Number.isFinite(Number(river.width)) || Number(river.width) < 0)) {
      throw new Error(`Azgaar river ${river.i} width must be a non-negative finite number.`);
    }
    if (river.points !== undefined) {
      if (!Array.isArray(river.points)) {
        throw new Error(`Azgaar river ${river.i} points must be an array.`);
      }
      river.points.forEach((point, index) => {
        assertFinitePoint(point, `river ${river.i} point ${index}`);
      });
    }
    if (river.cells !== undefined) {
      if (!Array.isArray(river.cells)
          || river.cells.some((cellId) => !Number.isSafeInteger(cellId) || cellId < -1)) {
        throw new Error(
          `Azgaar river ${river.i} cells must contain packed cell ids or the -1 off-canvas sentinel.`,
        );
      }
      const missingCellId = river.cells.find(
        (cellId) => cellId >= 0 && !packedCellIds.has(cellId),
      );
      if (missingCellId !== undefined) {
        throw new Error(`Azgaar river ${river.i} references missing packed cell ${missingCellId}.`);
      }
    }
  }
}

function assertAzgaarDocument(document) {
  const description = String(document?.info?.description ?? '').toLowerCase();
  if (!description.includes("azgaar's fantasy map generator")) {
    throw new Error('The selected JSON is not an Azgaar Full JSON export.');
  }
  if (!Number.isFinite(Number(document?.info?.width)) || Number(document.info.width) <= 0
      || !Number.isFinite(Number(document?.info?.height)) || Number(document.info.height) <= 0) {
    throw new Error('Azgaar Full JSON must include positive map dimensions.');
  }

  const cells = document?.grid?.cells;
  const cellsX = document?.grid?.cellsX;
  const cellsY = document?.grid?.cellsY;
  const expectedCellCount = cellsX * cellsY;
  if (!Array.isArray(cells) || cells.length === 0
      || !Number.isInteger(cellsX) || cellsX < 1
      || !Number.isInteger(cellsY) || cellsY < 1
      || !Number.isSafeInteger(expectedCellCount)) {
    throw new Error('Azgaar Full JSON must include non-empty grid cells and positive grid dimensions.');
  }
  if (cells.length !== expectedCellCount) {
    throw new Error('Azgaar Full JSON grid dimensions must match its cell count.');
  }

  const ids = new Set();
  for (const cell of cells) {
    if (!Number.isSafeInteger(cell?.i) || cell.i < 0) {
      throw new Error('Azgaar Full JSON grid cells must have non-negative safe-integer ids.');
    }
    if (ids.has(cell.i)) {
      throw new Error(`Azgaar Full JSON contains duplicate grid cell id ${cell.i}.`);
    }
    ids.add(cell.i);
  }
  for (let cellId = 0; cellId < expectedCellCount; cellId += 1) {
    if (!ids.has(cellId)) {
      throw new Error(`Azgaar Full JSON grid is missing row-major cell id ${cellId}.`);
    }
  }

  const packedCellIds = assertPackedCells(document, ids);
  assertRivers(document, packedCellIds);
}

function normalizeBiomeSource(document) {
  if (Array.isArray(document.pack?.biomes)
      && document.pack.biomes.length === 0
      && document.biomesData !== undefined) {
    return {
      ...document,
      pack: { ...document.pack, biomes: undefined },
    };
  }
  return document;
}

function chunkAxisFits(minCell, maxCell, chunkSize) {
  const firstChunkOrigin = Math.floor(minCell / chunkSize) * chunkSize;
  const lastChunkOrigin = Math.floor(maxCell / chunkSize) * chunkSize;
  const lastChunkVertex = lastChunkOrigin + chunkSize;
  return Number.isSafeInteger(firstChunkOrigin)
    && Number.isSafeInteger(lastChunkVertex)
    && Math.abs(firstChunkOrigin) <= WORLD_MAX_SAFE_CELL_COORDINATE
    && Math.abs(lastChunkVertex) <= WORLD_MAX_SAFE_CELL_COORDINATE;
}

function assertSafeWorldBounds(summary, config) {
  const tileSize = Number(config.map?.tileSize);
  const chunkSize = Number(config.world?.chunkSize);
  const widthCells = Math.round(summary.physicalWidthMeters / tileSize);
  const heightCells = Math.round(summary.physicalHeightMeters / tileSize);
  if (!Number.isSafeInteger(widthCells) || widthCells < 1
      || !Number.isSafeInteger(heightCells) || heightCells < 1
      || !Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Azgaar imported world dimensions exceed safe streamed-world coordinates.');
  }

  const minCellX = -Math.floor(widthCells / 2);
  const minCellZ = -Math.floor(heightCells / 2);
  const maxCellX = minCellX + widthCells - 1;
  const maxCellZ = minCellZ + heightCells - 1;
  if (!chunkAxisFits(minCellX, maxCellX, chunkSize)
      || !chunkAxisFits(minCellZ, maxCellZ, chunkSize)) {
    throw new Error('Azgaar imported world dimensions exceed safe streamed-world coordinates.');
  }
}

function cloneCampaignArray(value) {
  return Array.isArray(value) ? structuredClone(value) : [];
}

function createCampaign(document, baseTerrain, summary, cartography) {
  return {
    source: {
      type: 'azgaar-full-json',
      version: document.info.version ?? null,
      mapId: document.info.mapId ?? null,
      mapName: document.info.mapName ?? document.settings?.mapName ?? 'Azgaar world',
      seed: document.info.seed ?? document.grid.seed ?? null,
      importedAt: new Date().toISOString(),
      sourceWidth: document.info.width ?? null,
      sourceHeight: document.info.height ?? null,
      target: {
        ...baseTerrain.bounds,
        atlasWidth: summary.atlasWidth,
        atlasHeight: summary.atlasHeight,
        physicalWidthMeters: summary.physicalWidthMeters,
        physicalHeightMeters: summary.physicalHeightMeters,
        boundary: 'ocean',
      },
    },
    ...(cartography ? { cartography } : {}),
    states: cloneCampaignArray(document.pack?.states),
    provinces: cloneCampaignArray(document.pack?.provinces),
    cultures: cloneCampaignArray(document.pack?.cultures),
    religions: cloneCampaignArray(document.pack?.religions),
    burgs: cloneCampaignArray(document.pack?.burgs),
    rivers: cloneCampaignArray(document.pack?.rivers),
    routes: cloneCampaignArray(document.pack?.routes),
    markers: cloneCampaignArray(document.pack?.markers),
    zones: cloneCampaignArray(document.pack?.zones),
    features: cloneCampaignArray(document.pack?.features),
    goods: cloneCampaignArray(document.pack?.goods),
    markets: cloneCampaignArray(document.pack?.markets),
    deals: cloneCampaignArray(document.pack?.deals),
    measurers: cloneCampaignArray(document.pack?.measurers),
    notes: cloneCampaignArray(document.notes),
  };
}

export function isAzgaarFullJson(document) {
  return String(document?.info?.description ?? '')
    .toLowerCase()
    .includes("azgaar's fantasy map generator")
    && Array.isArray(document?.grid?.cells);
}

export function importAzgaarFullJson(document, config, options = {}) {
  assertAzgaarDocument(document);
  const sourceDocument = normalizeBiomeSource(document);
  const chunkSize = config.world.chunkSize;
  const summary = buildAzgaarImportSummary(sourceDocument, config, options);
  assertSafeWorldBounds(summary, config);
  const baseTerrain = createAzgaarMacroWorldSource(sourceDocument, config, options);
  const cartography = Array.isArray(document.pack?.vertices)
    ? createAzgaarCartographySource(document)
    : null;
  return {
    version: INFINITE_WORLD_FORMAT_VERSION,
    world: {
      chunkSize,
      tileSize: config.map.tileSize,
      generator: {
        seed: config.world.seed,
        version: config.world.generatorVersion,
        heightScale: config.world.heightScale,
        seaLevel: config.world.seaLevel,
      },
      baseTerrain,
    },
    chunks: [],
    objects: [],
    voxelWorld: { unboundedXZ: true, cellsY: config.voxelPrototype.cells[1] },
    voxelStamps: [],
    campaign: createCampaign(document, baseTerrain, summary, cartography),
    importWarnings: [
      `Azgaar macro atlas ${summary.atlasWidth}×${summary.atlasHeight}; `
        + `${Math.round(summary.physicalWidthMeters / 1000)}×`
        + `${Math.round(summary.physicalHeightMeters / 1000)} km; `
        + `${(summary.estimatedRawBytes / 1024 / 1024).toFixed(1)} MiB raw.`,
      'Terrain is generated and streamed on demand; edits remain sparse.',
      'Labels, heraldry, and political overlays are preserved as campaign metadata.',
      ...(summary.usedCustomUnitFallback
        ? [`Unknown distance unit "${summary.distanceUnit}" was interpreted as kilometers.`]
        : []),
    ],
    savedAt: new Date().toISOString(),
  };
}
