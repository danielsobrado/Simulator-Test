import { WORLD_MAX_SAFE_CELL_COORDINATE } from './worldConstants.js';

const TILE_SENTINEL = 255;
const DENSE_ENCODING = 'base64-le-v1';

function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  }
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof value !== 'string') {
    throw new Error('Encoded chunk data must be a base64 string.');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function assertChunkCoordinateRange(chunk, chunkSize) {
  if (!Number.isSafeInteger(chunk?.x) || !Number.isSafeInteger(chunk?.z)) {
    throw new Error('Infinite world chunk coordinates must be safe integers.');
  }
  const originX = chunk.x * chunkSize;
  const originZ = chunk.z * chunkSize;
  const maxVertexX = originX + chunkSize;
  const maxVertexZ = originZ + chunkSize;
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originZ)
      || !Number.isSafeInteger(maxVertexX) || !Number.isSafeInteger(maxVertexZ)
      || Math.abs(originX) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(originZ) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(maxVertexX) > WORLD_MAX_SAFE_CELL_COORDINATE
      || Math.abs(maxVertexZ) > WORLD_MAX_SAFE_CELL_COORDINATE) {
    throw new Error('Infinite world chunk exceeds the engine cell coordinate limit.');
  }
}

function encodeTiles(entries, cellCount) {
  const values = new Uint8Array(cellCount);
  values.fill(TILE_SENTINEL);
  for (const [index, value] of entries) {
    values[index] = value;
  }
  return bytesToBase64(values);
}

function decodeTiles(encoded, cellCount) {
  const values = base64ToBytes(encoded);
  if (values.length !== cellCount) {
    throw new Error('Encoded chunk tile data has an invalid size.');
  }
  const entries = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== TILE_SENTINEL) {
      entries.push([index, values[index]]);
    }
  }
  return entries;
}

function encodeHeights(entries, vertexCount) {
  const bytes = new Uint8Array(vertexCount * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < vertexCount; index += 1) {
    view.setFloat32(index * 4, Number.NaN, true);
  }
  for (const [index, value] of entries) {
    view.setFloat32(index * 4, value, true);
  }
  return bytesToBase64(bytes);
}

function decodeHeights(encoded, vertexCount) {
  const bytes = base64ToBytes(encoded);
  if (bytes.length !== vertexCount * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('Encoded chunk height data has an invalid size.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let index = 0; index < vertexCount; index += 1) {
    const value = view.getFloat32(index * 4, true);
    if (!Number.isNaN(value)) {
      entries.push([index, value]);
    }
  }
  return entries;
}

export function encodeChunkDocument(chunk, chunkSize) {
  const cellCount = chunkSize * chunkSize;
  const vertexCount = (chunkSize + 1) * (chunkSize + 1);
  const containsReservedTile = (chunk.tiles ?? []).some(([, value]) => value === TILE_SENTINEL);
  const denseTiles = !containsReservedTile && (chunk.tiles?.length ?? 0) > cellCount * 0.5;
  const denseHeights = (chunk.heights?.length ?? 0) > vertexCount * 0.5;
  return {
    x: chunk.x,
    z: chunk.z,
    ...(denseTiles
      ? { tileData: encodeTiles(chunk.tiles, cellCount) }
      : { tiles: chunk.tiles ?? [] }),
    ...(denseHeights
      ? { heightData: encodeHeights(chunk.heights, vertexCount) }
      : { heights: chunk.heights ?? [] }),
    ...((denseTiles || denseHeights) ? { encoding: DENSE_ENCODING } : {}),
  };
}

export function decodeChunkDocument(chunk, chunkSize) {
  assertChunkCoordinateRange(chunk, chunkSize);
  if (chunk.encoding && chunk.encoding !== DENSE_ENCODING) {
    throw new Error(`Unsupported chunk encoding: ${chunk.encoding}.`);
  }
  const cellCount = chunkSize * chunkSize;
  const vertexCount = (chunkSize + 1) * (chunkSize + 1);
  return {
    x: chunk.x,
    z: chunk.z,
    tiles: chunk.tileData === undefined
      ? chunk.tiles ?? []
      : decodeTiles(chunk.tileData, cellCount),
    heights: chunk.heightData === undefined
      ? chunk.heights ?? []
      : decodeHeights(chunk.heightData, vertexCount),
  };
}

export const CHUNK_DOCUMENT_ENCODING = DENSE_ENCODING;
