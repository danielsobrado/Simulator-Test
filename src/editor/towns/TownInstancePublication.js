import { markAttributeSubrangeUpdated } from '../stylized/attributeUpload.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';

/** Dirty slots are sorted and unique; pending ranges survive until the draw uploads them. */
export function writeTownInstanceRows(meshes, matrices, colours, placementAt, count, dirty) {
  for (const mesh of meshes) {
    for (const slot of dirty) {
      const index = placementAt[slot];
      mesh.instanceMatrix.array.set(matrices.subarray(index * 16, index * 16 + 16), slot * 16);
      mesh.instanceColor?.array.set(colours.subarray(index * 3, index * 3 + 3), slot * 3);
    }
    mesh.count = count;
    PerfCounters.inc('townInstanceRowsCopied', dirty.length);
    for (let start = 0; start < dirty.length;) {
      let end = start;
      while (end + 1 < dirty.length && dirty[end + 1] === dirty[end] + 1) end++;
      markAttributeSubrangeUpdated(mesh.instanceMatrix, dirty[start], dirty[end]);
      markAttributeSubrangeUpdated(mesh.instanceColor, dirty[start], dirty[end]);
      start = end + 1;
    }
  }
}
