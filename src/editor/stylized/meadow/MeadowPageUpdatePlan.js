/** Append a stem run, merging it with the previous run when both are contiguous. */
function appendRange(ranges, start, count, offset) {
  const last = ranges.at(-1);
  if (last && last.start + last.count === start && last.offset + last.count === offset) last.count += count;
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
 * Pure, bounded (at most 16 tiles) prediction of every companion-array write.
 *
 * Every stem carries its tile in `instanceTile`, so a tile need not be contiguous.
 * A retired or resized tile leaves holes, and only stems past the new draw count
 * move into them: the cost is bounded by what left, not by what follows it.
 */
export function meadowPageUpdatePlan(page, tiles) {
  const present = new Set(tiles);
  const stems = tile => Math.min(tile.output.count, page.stride);
  const sourceOf = tile => tile.prepared ?? tile.buildId;
  let count = 0;
  for (const tile of tiles) count += stems(tile);

  const freed = [];
  const kept = new Map();
  for (const [tile, slot] of page.slots) {
    if (present.has(tile) && slot.count === stems(tile) && slot.source === sourceOf(tile)) kept.set(tile, slot);
    else freed.push(...slot.ranges);
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
  holes.sort((left, right) => right.start - left.start);

  let bytes = 0, repackBytes = 0;
  const writes = [];
  for (const tile of kept.keys()) {
    const slot = kept.get(tile), ranges = [], moved = [];
    for (const { start, count: length, offset } of slot.ranges) {
      const resident = Math.min(length, Math.max(0, count - start));
      if (resident > 0) appendRange(ranges, start, resident, offset);
      if (resident < length) claimHoles(holes, length - resident, offset + resident, moved);
    }
    const movedStems = moved.reduce((sum, range) => sum + range.count, 0);
    for (const range of moved) ranges.push(range);
    const metadata = slot.renderX !== tile.renderX || slot.renderZ !== tile.renderZ
      || slot.revealTime !== tile.revealTime || slot.revealRank !== tile.revealRank;
    bytes += movedStems * 10 * 4 + (metadata ? slot.count : movedStems) * 4 * 4;
    repackBytes += movedStems * 14 * 4;
    writes.push({ tile, count: slot.count, source: slot.source, ranges, sourceRanges: moved, metadata });
  }
  for (const tile of tiles) {
    if (kept.has(tile)) continue;
    const ranges = [], stemCount = stems(tile);
    claimHoles(holes, stemCount, 0, ranges);
    bytes += stemCount * 14 * 4;
    writes.push({ tile, count: stemCount, source: sourceOf(tile), ranges, sourceRanges: ranges, metadata: true });
  }
  return { present, order: writes.map(write => write.tile), writes, count, bytes, repackBytes };
}
