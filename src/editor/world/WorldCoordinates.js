import {
  WORLD_CHUNK_KEY_SEPARATOR,
  WORLD_MAX_SAFE_CELL_COORDINATE,
} from './worldConstants.js';

function assertSafeCellCoordinate(value, fieldName) {
  if (!Number.isSafeInteger(value)
      || Math.abs(value) > WORLD_MAX_SAFE_CELL_COORDINATE) {
    throw new Error(`${fieldName} must be a safe world-cell integer.`);
  }
}

function assertPositiveFiniteTileSize(tileSize) {
  if (!Number.isFinite(tileSize) || tileSize <= 0) {
    throw new Error('World tile size must be a positive finite number.');
  }
}

export function floorDiv(value, divisor) {
  if (!Number.isInteger(divisor) || divisor <= 0) {
    throw new Error('World coordinate divisor must be a positive integer.');
  }
  return Math.floor(value / divisor);
}

export function positiveModulo(value, divisor) {
  const remainder = value % divisor;
  return remainder < 0 ? remainder + divisor : remainder;
}

export function chunkKey(chunkX, chunkZ) {
  assertSafeCellCoordinate(chunkX, 'chunkX');
  assertSafeCellCoordinate(chunkZ, 'chunkZ');
  return `${chunkX}${WORLD_CHUNK_KEY_SEPARATOR}${chunkZ}`;
}

export function parseChunkKey(key) {
  if (typeof key !== 'string') {
    throw new Error('World chunk key must be a string.');
  }
  const parts = key.split(WORLD_CHUNK_KEY_SEPARATOR);
  if (parts.length !== 2) {
    throw new Error(`Invalid world chunk key: ${key}.`);
  }
  const chunkX = Number(parts[0]);
  const chunkZ = Number(parts[1]);
  assertSafeCellCoordinate(chunkX, 'chunkX');
  assertSafeCellCoordinate(chunkZ, 'chunkZ');
  return Object.freeze({ chunkX, chunkZ });
}

export function cellKey(cellX, cellZ) {
  assertSafeCellCoordinate(cellX, 'cellX');
  assertSafeCellCoordinate(cellZ, 'cellZ');
  return `${cellX}${WORLD_CHUNK_KEY_SEPARATOR}${cellZ}`;
}

export function parseCellKey(key) {
  return parseChunkKey(key);
}

export function cellToChunk(cellX, cellZ, chunkSize) {
  assertSafeCellCoordinate(cellX, 'cellX');
  assertSafeCellCoordinate(cellZ, 'cellZ');
  return Object.freeze({
    chunkX: floorDiv(cellX, chunkSize),
    chunkZ: floorDiv(cellZ, chunkSize),
    localX: positiveModulo(cellX, chunkSize),
    localZ: positiveModulo(cellZ, chunkSize),
  });
}

export function vertexToChunk(vertexX, vertexZ, chunkSize) {
  return cellToChunk(vertexX, vertexZ, chunkSize);
}

export function chunkCellBounds(chunkX, chunkZ, chunkSize) {
  assertSafeCellCoordinate(chunkX, 'chunkX');
  assertSafeCellCoordinate(chunkZ, 'chunkZ');
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('World chunk size must be a positive safe integer.');
  }

  const minX = chunkX * chunkSize;
  const minZ = chunkZ * chunkSize;
  const maxX = minX + chunkSize - 1;
  const maxZ = minZ + chunkSize - 1;
  const maxVertexX = minX + chunkSize;
  const maxVertexZ = minZ + chunkSize;
  assertSafeCellCoordinate(minX, 'minX');
  assertSafeCellCoordinate(minZ, 'minZ');
  assertSafeCellCoordinate(maxX, 'maxX');
  assertSafeCellCoordinate(maxZ, 'maxZ');
  assertSafeCellCoordinate(maxVertexX, 'maxVertexX');
  assertSafeCellCoordinate(maxVertexZ, 'maxVertexZ');
  return Object.freeze({ minX, minZ, maxX, maxZ });
}

export function worldToCell(worldX, worldZ, tileSize) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('World position must be finite.');
  }
  assertPositiveFiniteTileSize(tileSize);
  const x = Math.floor(worldX / tileSize);
  const z = Math.floor(-worldZ / tileSize);
  assertSafeCellCoordinate(x, 'cellX');
  assertSafeCellCoordinate(z, 'cellZ');
  return Object.freeze({ x, z });
}

export function cellCenterToWorld(cellX, cellZ, tileSize) {
  assertSafeCellCoordinate(cellX, 'cellX');
  assertSafeCellCoordinate(cellZ, 'cellZ');
  assertPositiveFiniteTileSize(tileSize);
  const x = (cellX + 0.5) * tileSize;
  const z = -(cellZ + 0.5) * tileSize;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    throw new Error('World cell center must resolve to a finite position.');
  }
  return Object.freeze({ x, z });
}
