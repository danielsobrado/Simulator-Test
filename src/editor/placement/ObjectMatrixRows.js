import { Matrix4 } from 'three/webgpu';
import { extendInstanceBounds } from '../stylized/lod/InstanceBoundsUpdate.js';
import { markAttributeSubrangeUpdated } from '../stylized/attributeUpload.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

const matrix = new Matrix4();
const publications = new WeakMap();

/** Stable dense rows: removal moves only the tail, and unchanged records keep their slot. */
export class ObjectMatrixRows {
  constructor(matrixKey) {
    this.matrixKey = matrixKey;
    this.records = [];
    this.indices = new Map();
    this.objectIds = [];
    this.changed = [];
    this.version = 0;
  }

  patch(next) {
    const dirty = new Set(), records = this.records, indices = this.indices;
    const previousCount = records.length;
    for (const [id, row] of indices) {
      if (next.get(id)?.[this.matrixKey]) continue;
      const tail = records.pop();
      indices.delete(id);
      if (row < records.length) {
        records[row] = tail; indices.set(tail.object.id, row); dirty.add(row);
      }
    }
    for (const [id, record] of next) {
      if (!record[this.matrixKey]) continue;
      let row = indices.get(id);
      if (row === undefined) { row = records.length; indices.set(id, row); }
      const previous = records[row];
      records[row] = record;
      if (previous?.[this.matrixKey] !== record[this.matrixKey] || previous?.object.id !== id) dirty.add(row);
    }
    this.changed = [...dirty].filter(row => row < records.length).sort((a, b) => a - b);
    for (const row of this.changed) this.objectIds[row] = records[row].object.id;
    this.objectIds.length = records.length;
    this.baseVersion = this.version;
    if (this.changed.length || previousCount !== records.length) this.version++;
  }
}

/** Transform only dirty rows; a new mesh receives the complete retained publication. */
export function writeObjectMatrixRows(mesh, rows, partMatrix = null) {
  const previous = publications.get(mesh);
  const full = previous?.rows !== rows || previous.version !== rows.baseVersion;
  const count = rows.records.length, changed = [];
  const visits = full ? count : rows.changed.length;
  const attribute = mesh.instanceMatrix;
  for (let visit = 0; visit < visits; visit++) {
    const row = full ? visit : rows.changed[visit];
    const source = rows.records[row][rows.matrixKey];
    const elements = partMatrix ? matrix.multiplyMatrices(source, partMatrix).elements : source.elements;
    PerfCounters.inc('objectInstanceRowsTransformed');
    for (let i = 0; i < 16; i++) {
      if (attribute.array[row * 16 + i] === Math.fround(elements[i])) continue;
      attribute.array.set(elements, row * 16); changed.push(row); break;
    }
  }
  const previousCount = mesh.count;
  mesh.count = count; mesh.visible = count > 0;
  mesh.userData.objectIds = rows.objectIds;
  if (full) markAttributeSubrangeUpdated(attribute, 0, count - 1);
  else for (const row of changed) markAttributeSubrangeUpdated(attribute, row, row);
  const boundsWrites = (previous?.boundsWrites ?? 0) + changed.length;
  const tighten = full || !mesh.boundingSphere || boundsWrites >= Math.max(64, count)
    || count < previousCount / 2;
  if (tighten) mesh.computeBoundingSphere();
  else if (changed.length) extendInstanceBounds(mesh, changed);
  publications.set(mesh, { rows, version: rows.version, boundsWrites: tighten ? 0 : boundsWrites });
}
