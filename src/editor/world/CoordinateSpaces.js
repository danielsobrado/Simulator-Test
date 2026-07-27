import {
  cellCenterToWorld,
  cellToChunk,
  worldToCell,
} from './WorldCoordinates.js';

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function assertPositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
}

function assertCellBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    throw new Error('Cell bounds are required.');
  }
  for (const name of ['minX', 'minZ', 'maxX', 'maxZ']) {
    if (!Number.isSafeInteger(bounds[name])) {
      throw new Error(`Cell bounds ${name} must be a safe integer.`);
    }
  }
  if (bounds.maxX < bounds.minX || bounds.maxZ < bounds.minZ) {
    throw new Error('Cell bounds maximums must cover their minimums.');
  }
}

export function cellToCanonicalWorld(cellX, cellZ, tileSize) {
  assertPositive(tileSize, 'tileSize');
  return cellCenterToWorld(cellX, cellZ, tileSize);
}

export function canonicalWorldToCell(canonicalX, canonicalZ, tileSize) {
  assertFinite(canonicalX, 'canonicalX');
  assertFinite(canonicalZ, 'canonicalZ');
  assertPositive(tileSize, 'tileSize');
  return worldToCell(canonicalX, canonicalZ, tileSize);
}

export function canonicalWorldToTerrainChunk(
  canonicalX,
  canonicalZ,
  tileSize,
  chunkSize,
) {
  const cell = canonicalWorldToCell(canonicalX, canonicalZ, tileSize);
  const chunk = cellToChunk(cell.x, cell.z, chunkSize);
  return Object.freeze({ chunkX: chunk.chunkX, chunkZ: chunk.chunkZ });
}

export function renderLocalToCanonicalWorld(renderX, renderZ, floatingOrigin) {
  assertFinite(renderX, 'renderX');
  assertFinite(renderZ, 'renderZ');
  if (!floatingOrigin?.toCanonical) {
    throw new Error('A floating origin with toCanonical is required.');
  }
  return floatingOrigin.toCanonical(renderX, renderZ);
}

export function canonicalWorldToRenderLocal(canonicalX, canonicalZ, floatingOrigin) {
  assertFinite(canonicalX, 'canonicalX');
  assertFinite(canonicalZ, 'canonicalZ');
  if (!floatingOrigin?.toRender) {
    throw new Error('A floating origin with toRender is required.');
  }
  return floatingOrigin.toRender(canonicalX, canonicalZ);
}

export function cellBoundsCenterToCanonicalWorld(bounds, tileSize) {
  assertCellBounds(bounds);
  assertPositive(tileSize, 'tileSize');
  const min = cellCenterToWorld(bounds.minX, bounds.minZ, tileSize);
  const max = cellCenterToWorld(bounds.maxX, bounds.maxZ, tileSize);
  return Object.freeze({
    x: (min.x + max.x) / 2,
    z: (min.z + max.z) / 2,
  });
}
