import { mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * Shaped stones for a crenellated crown.
 *
 * The reference treats the merlons as a separate pass over the top-row polygons
 * it deleted earlier: each one is rebuilt relative to its own bounding box,
 * randomly lifted and scaled, bridged back to the wall with either one or three
 * segments, pierced through the middle, and finished with one border edge
 * extruded out. This is that pass, expressed in the grammar the rest of the wall
 * already uses.
 *
 * Two deliberate departures:
 *
 * - The piercing is made by *omitting* cells, not by a boolean. There is no CSG
 *   in this project, and every other void in the wall — doors, arches, breaches —
 *   is already cut the same way, so the slit costs nothing new.
 * - Merlon stones are plain boxes rather than lattice quads. At 0.2 m across, the
 *   bed ramp that shapes the wall body is smaller than the bevel; `stoneJitter`
 *   supplies all the variation these need, the same way it does for coping.
 *
 * Three.js-free: this runs in the compiler worker with the packer.
 */

const MERLON_HASH = 0x9b05688c;
const SPUR_HASH = 0x1f83d9ab;

function lane(hash, shift) {
  return ((hash >>> shift) & 255) / 255;
}

/**
 * Lay out one merlon as a list of units ready for the packer's `emitUnit`.
 *
 * @param merlon `{ s, width, base, height }` from `WallTopProfile.crenellationsOver`.
 * @param options.index the merlon's `stableIndex` base, so the shape is stable
 *   under unrelated edits.
 * @returns `{ units, rows, columns, pierced, bridge }` — the extra fields are the
 *   layout decisions, exposed so tests can assert against them rather than
 *   inferring them back out of the geometry.
 */
export function layoutMerlon(merlon, {
  minWidth,
  thickness,
  seed,
  index,
}) {
  const shape = mixSeed(seed ^ MERLON_HASH, index);
  const spurHash = mixSeed(seed ^ SPUR_HASH, index);

  // "Polygons are bridged randomly: either with 1 or 3 segments." The bridge is
  // the stalk between the wall top and the crown, and it is what decides whether
  // the merlon is tall enough to be worth piercing.
  //
  // Weighted well away from the tall variant, because the reference only sends
  // *some* of the crown through this pass. It is also what keeps the crown
  // affordable: a four-row merlon costs about twice a two-row one, and on a long
  // wall in a fine-grained style the crown can otherwise eat enough of
  // `MAX_CONSTRUCTION_STONES` to leave the far end of the wall unbuilt.
  const bridge = lane(shape, 0) < 0.72 ? 1 : 3;
  const rows = bridge === 1 ? 2 : 4;
  // How many stones will actually course across this merlon. A fine-grained
  // style crenellates on a tighter spacing, and three columns across a 0.5 m
  // merlon would be splinters, not masonry.
  const columns = merlon.width >= 0.6 ? 3 : merlon.width >= 0.36 ? 2 : 1;
  // "The central polygon is deleted." Only the tall variant, only where there is
  // a pier to leave either side of the void, and not always — so a crown reads
  // as a run of plain merlons with the odd arrow loop in it.
  const pierced = bridge === 3 && columns === 3 && lane(shape, 8) < 0.75;

  // "For each polygon a new polygon is created relatively to the bounding box,
  // randomly y offsetted and scaled."
  const lift = lane(shape, 16) * 0.12 * merlon.height;
  const crownScale = 0.74 + lane(shape, 24) * 0.18;

  const bodyHeight = Math.max(0.12, merlon.height - lift);
  const rowHeight = bodyHeight / rows;
  const footing = merlon.base + lift;
  const units = [];

  const rowWidthAt = (row) => (
    merlon.width * (1 + (crownScale - 1) * (rows > 1 ? row / (rows - 1) : 0))
  );

  for (let row = 0; row < rows; row += 1) {
    const rowWidth = rowWidthAt(row);
    // A pierced merlon keeps its three columns all the way up: the two piers
    // either side of an arrow loop are continuous, which is how one is actually
    // built. A solid merlon alternates instead, so its joints break bond —
    // downward rather than upward, since a wider row is a row that costs more.
    const cells = pierced ? columns : Math.max(1, columns - (row % 2));
    const cellWidth = rowWidth / cells;
    const y = footing + (row + 0.5) * rowHeight;

    if (cellWidth < Math.max(0.09, minWidth * 0.4)) {
      // Too narrow to course; lay the row as one stone rather than as splinters.
      units.push({
        category: 'merlon',
        s: merlon.s,
        y,
        width: rowWidth,
        height: rowHeight,
        depth: thickness * 0.92,
      });
      continue;
    }

    for (let cell = 0; cell < cells; cell += 1) {
      // The slit: one cell wide, two tall, clear of the footing course so the
      // merlon still bonds onto the wall below it.
      if (pierced && cell === 1 && row >= 1 && row <= 2) continue;
      units.push({
        category: 'merlon',
        s: merlon.s + (cell + 0.5 - cells / 2) * cellWidth,
        y,
        width: cellWidth,
        height: rowHeight,
        depth: thickness * 0.92,
      });
    }
  }

  // "A random border edge is extruded (random length)." One cantilevered stone
  // off the side of the crown — a corbel, in masonry terms. `ashlar` rather than
  // `merlon`/`field` so `IRREGULARITY_CATEGORY_SCALE` keeps it worked: a corbel
  // shaped like rubble reads as a stone that fell and happened to stick. The
  // packer still tags it with the MERLON support role.
  if (bridge === 3 && lane(spurHash, 0) < 0.45) {
    const side = lane(spurHash, 8) < 0.5 ? -1 : 1;
    const crownWidth = rowWidthAt(rows - 1);
    const length = Math.max(0.1, (0.3 + lane(spurHash, 16) * 0.45) * cellSize(crownWidth, columns));
    const row = rows - 1 - Math.round(lane(spurHash, 24));
    units.push({
      category: 'ashlar',
      s: merlon.s + side * (crownWidth / 2 + length / 2),
      y: footing + (row + 0.5) * rowHeight,
      width: length,
      height: rowHeight * 0.72,
      depth: thickness * 0.66,
    });
  }

  return { units, rows, columns, pierced, bridge };
}

function cellSize(rowWidth, columns) {
  return rowWidth / Math.max(1, columns);
}
