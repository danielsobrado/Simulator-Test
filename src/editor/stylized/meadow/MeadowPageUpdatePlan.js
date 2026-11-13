const NO_WRITES = Object.freeze([]);

const stems = (page, tile) => Math.min(tile.output.count, page.stride);
const sourceOf = tile => tile.prepared ?? tile.buildId;
const byStartDescending = (left, right) => right.start - left.start;
const continues = (last, start, offset) => last.start + last.count === start && last.offset + last.count === offset;
const metadataChanged = (slot, tile) => slot.renderX !== tile.renderX || slot.renderZ !== tile.renderZ
  || slot.revealTime !== tile.revealTime || slot.revealRank !== tile.revealRank;

/** Append a stem run, merging it with the previous run when both are contiguous. */
function appendRange(ranges, start, count, offset) {
  const last = ranges.at(-1);
  if (last && continues(last, start, offset)) last.count += count;
  else ranges.push({ start, count, offset });
}

/** Claim `count` stems from the free holes, as runs of the tile's source from `offset`. */
function claimHoles(holes, count, offset, target) {
  while (count > 0) {
    const hole = holes.at(-1), taken = Math.min(hole.count, count);
    appendRange(target, hole.start, taken, offset);
    hole.start += taken;
    hole.count -= taken;
    if (hole.count === 0) holes.pop();
    count -= taken;
    offset += taken;
  }
}

/**
 * The plan for a page whose full rebuild would write nothing: the same tiles, sources,
 * counts and origins, and runs already merged inside the draw. It reuses the page's own
 * `present` and `order` (update only reassigns them), so the per-frame commit of an
 * untouched page allocates no Set, Map, range or write. Otherwise null.
 */
function unchangedPlan(page, tiles, count) {
  if (tiles.length !== page.slots.size || page.order.length !== tiles.length) return null;
  let i = 0;
  for (const tile of page.slots.keys()) {
    const slot = page.slots.get(tile), ranges = slot.ranges;
    if (page.order[i++] !== tile || !tiles.includes(tile) || slot.count !== stems(page, tile)
      || slot.source !== sourceOf(tile) || metadataChanged(slot, tile)) return null;
    for (let r = 0; r < ranges.length; r += 1) {
      const { start, count: length, offset } = ranges[r];
      if (length <= 0 || start + length > count || (r > 0 && continues(ranges[r - 1], start, offset))) return null;
    }
  }
  return { present: page.present, order: page.order, writes: NO_WRITES, count, bytes: 0, repackBytes: 0 };
}

/**
 * Pure, bounded (at most 16 tiles) prediction of every companion-array write.
 *
 * Every stem carries its tile in `instanceTile`, so a tile need not be contiguous.
 * A retired or resized tile leaves holes, and only stems past the new draw count
 * move into them: the cost is bounded by what left, not by what follows it.
 */
export function meadowPageUpdatePlan(page, tiles) {
  let count = 0;
  for (const tile of tiles) count += stems(page, tile);
  const unchanged = unchangedPlan(page, tiles, count);
  if (unchanged) return unchanged;

  const present = new Set(tiles);
  const freed = [];
  const kept = new Map();
  for (const [tile, slot] of page.slots) {
    if (present.has(tile) && slot.count === stems(page, tile) && slot.source === sourceOf(tile)) kept.set(tile, slot);
    else for (const range of slot.ranges) freed.push(range);
  }
  if (count > page.geometry.instanceCount) {
    freed.push({ start: page.geometry.instanceCount, count: count - page.geometry.instanceCount, offset: 0 });
  }
  const holes = [];
  for (const { start, count: length } of freed) {
    const usable = Math.min(length, count - start);
    if (usable > 0) holes.push({ start, count: usable });
  }
  // Popped from the end, so the lowest holes fill first.
  holes.sort(byStartDescending);

  let bytes = 0, repackBytes = 0;
  const writes = [];
  for (const tile of kept.keys()) {
    const slot = kept.get(tile), ranges = [], moved = [];
    for (const { start, count: length, offset } of slot.ranges) {
      const resident = Math.min(length, Math.max(0, count - start));
      if (resident > 0) appendRange(ranges, start, resident, offset);
      if (resident < length) claimHoles(holes, length - resident, offset + resident, moved);
    }
    let movedStems = 0;
    for (const range of moved) { movedStems += range.count; ranges.push(range); }
    const metadata = metadataChanged(slot, tile);
    bytes += movedStems * 10 * 4 + (metadata ? slot.count : movedStems) * 4 * 4;
    repackBytes += movedStems * 14 * 4;
    writes.push({ tile, count: slot.count, source: slot.source, ranges, sourceRanges: moved, metadata });
  }
  for (const tile of tiles) {
    if (kept.has(tile)) continue;
    const ranges = [], stemCount = stems(page, tile);
    claimHoles(holes, stemCount, 0, ranges);
    bytes += stemCount * 14 * 4;
    writes.push({ tile, count: stemCount, source: sourceOf(tile), ranges, sourceRanges: ranges, metadata: true });
  }
  return { present, order: writes.map(write => write.tile), writes, count, bytes, repackBytes };
}
