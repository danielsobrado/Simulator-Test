import { PerfCounters } from '../../../../performance/qa/PerfCounters.js';
import { InteriorNumericBuffer, INTERIOR_BUFFER_PAGE_ELEMENTS } from './InteriorNumericBuffer.js';

/** Settlement-local metres. Whole rooms share a cell; no faces are clipped or moved. */
export const INTERIOR_BATCH_CELL_METRES = 256;
/** About 3 MiB per float3 array; 32-bit indices remove the uint16 primitive-restart limit. */
export const INTERIOR_BATCH_MAX_VERTICES = 262140;
export const INTERIOR_VERTEX_ATTRIBUTES = Object.freeze({ positions: 3, normals: 3, colors: 3, uvs: 2, fire: 3, sky: 1 });

function recordCopy(bytes) {
  PerfCounters.inc('settlementInteriorBufferCopyBytes', bytes);
  PerfCounters.set('settlementInteriorBufferMaxCopyBytes', Math.max(PerfCounters.get('settlementInteriorBufferMaxCopyBytes'), bytes));
}

/** Spatial/material batches own their arrays. Splitting never interrupts a triangle. */
export class InteriorBatchStore {
  constructor({ cellMetres = INTERIOR_BATCH_CELL_METRES, maxVertices = INTERIOR_BATCH_MAX_VERTICES } = {}) {
    if (!(Number.isFinite(cellMetres) && cellMetres > 0)) throw new Error('Interior cells need a positive size.');
    if (!Number.isInteger(maxVertices) || maxVertices < 4 || maxVertices > INTERIOR_BATCH_MAX_VERTICES) {
      throw new Error(`Interior batches need 4–${INTERIOR_BATCH_MAX_VERTICES} vertices.`);
    }
    this.cellMetres = cellMetres;
    this.maxVertices = maxVertices;
    this.cells = new Map();
    this.batches = [];
    this.enter(0, 0);
  }

  enter(x, z) {
    const cellX = Math.floor(x / this.cellMetres), cellZ = Math.floor(z / this.cellMetres);
    const key = `${cellX}:${cellZ}`;
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, cell = { cellX, cellZ, materials: new Map() });
    this.cell = cell;
  }

  acquire(materialKey, vertices) {
    const { cell } = this;
    let batch = cell.materials.get(materialKey);
    if (!batch || batch.vertexCount + vertices > this.maxVertices) {
      const buffers = Object.fromEntries(Object.entries(INTERIOR_VERTEX_ATTRIBUTES)
        .map(([name, size]) => [name, new InteriorNumericBuffer(Float32Array,
          Math.min(INTERIOR_BUFFER_PAGE_ELEMENTS, this.maxVertices * size))]));
      buffers.indices = new InteriorNumericBuffer(Uint32Array, Math.min(INTERIOR_BUFFER_PAGE_ELEMENTS, this.maxVertices * 2));
      batch = { materialKey, cellX: cell.cellX, cellZ: cell.cellZ,
        part: batch ? batch.part + 1 : 0, vertexCount: 0, ...buffers };
      cell.materials.set(materialKey, batch);
      this.batches.push(batch);
    }
    batch.vertexCount += vertices;
    return batch;
  }

  *arraysJob() {
    const result = [];
    for (const batch of this.batches) {
      const { materialKey, cellX, cellZ, part, vertexCount } = batch;
      const arrays = { materialKey, cellX, cellZ, part };
      for (const name of [...Object.keys(INTERIOR_VERTEX_ATTRIBUTES), 'indices']) {
        arrays[name] = yield* batch[name].toArrayJob(recordCopy);
      }
      result.push(arrays);
      PerfCounters.inc('settlementInteriorBatchesGenerated');
      PerfCounters.inc('settlementInteriorVerticesGenerated', vertexCount);
      PerfCounters.inc('settlementInteriorIndicesGenerated', arrays.indices.length);
      yield;
    }
    return result;
  }
}
