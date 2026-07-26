import { PerfCounters } from '../performance/qa/PerfCounters.js';

/**
 * Mark a BufferAttribute dirty for only the used float/element range.
 * Three.js WebGPU honors `updateRanges` via `queue.writeBuffer` partial uploads.
 *
 * @param {import('three').BufferAttribute} attribute
 * @param {number} usedCount Number of logical elements (vertices/instances), not floats.
 * @param {{ counter?: string }} [options]
 */
export function markAttributeRangeUpdated(attribute, usedCount, { counter = 'attributeBytesUploaded' } = {}) {
  const count = Math.max(0, Math.floor(usedCount));
  const floats = count * attribute.itemSize;
  attribute.clearUpdateRanges();
  if (floats > 0) {
    attribute.addUpdateRange(0, floats);
  }
  attribute.needsUpdate = true;
  const bytes = floats * (attribute.array?.BYTES_PER_ELEMENT ?? 4);
  if (bytes > 0) {
    PerfCounters.inc(counter, bytes);
  }
  return bytes;
}

const MAX_PENDING_RANGES = 8;

/**
 * Mark only the instances between `minIndex` and `maxIndex` (inclusive) dirty.
 *
 * Unlike `markAttributeRangeUpdated`, which always re-uploads from element zero,
 * this uploads a subrange — so a rebuild that only nudges the LOD fade of one
 * chunk's instances does not re-send every matrix in the buffer. `maxIndex` below
 * `minIndex` means nothing changed, and nothing is uploaded at all: the GPU copy is
 * already correct, because three.js writes the full array when it first creates the
 * buffer and every write since has gone through a tracked range.
 *
 * Ranges already queued on the attribute are kept, not replaced. Three.js clears
 * them itself once the backend has uploaded them, so anything still queued has not
 * reached the GPU — normally because the mesh was frustum culled on the frame that
 * dirtied it, which is routine when the LOD plan spans chunks behind the camera.
 * Dropping such a range strands those instances on stale matrices and fades
 * permanently: the writers skip values the CPU array already holds, so nothing ever
 * re-dirties them and trees behind you stay wrong — usually invisible, because a
 * fade left at 0 is what the dithered material reads.
 *
 * They are appended rather than unioned into one span. The backend issues one
 * `writeBuffer` per range, so two far-apart chunks stay two small uploads instead of
 * the hundred-kilobyte span between them. Past `MAX_PENDING_RANGES` the span wins:
 * a mesh that has gone that many rebuilds without being drawn is cheaper to
 * re-upload whole than to describe.
 */
export function markAttributeSubrangeUpdated(
  attribute,
  minIndex,
  maxIndex,
  { counter = 'attributeBytesUploaded' } = {},
) {
  if (!attribute || maxIndex < minIndex) return 0;
  const itemSize = attribute.itemSize;
  let start = minIndex * itemSize;
  let length = (maxIndex - minIndex + 1) * itemSize;
  const pending = attribute.updateRanges ?? [];
  if (pending.length >= MAX_PENDING_RANGES) {
    let end = start + length;
    for (const range of pending) {
      if (range.start < start) start = range.start;
      if (range.start + range.count > end) end = range.start + range.count;
    }
    length = end - start;
    attribute.clearUpdateRanges();
  }
  attribute.addUpdateRange(start, length);
  attribute.needsUpdate = true;
  const bytes = length * (attribute.array?.BYTES_PER_ELEMENT ?? 4);
  if (bytes > 0) {
    PerfCounters.inc(counter, bytes);
  }
  return bytes;
}

