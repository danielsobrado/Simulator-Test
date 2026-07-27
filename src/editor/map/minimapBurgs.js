import { burgToNormalized } from './worldMapCoordinates.js';

const DEFAULT_BURG_COLOR = '#f0cf68';
// How far past the visible window an off-map burg still earns a rim marker,
// as a multiple of the window's half-width.
export const MINIMAP_BURG_EDGE_FACTOR = 2.5;
// Rim markers sit just inside the round player-mode frame.
const MINIMAP_BURG_EDGE_RADIUS = 0.44;

/**
 * Picks the Azgaar burgs worth drawing on the local minimap.
 *
 * Positions come back normalised to the minimap window — `u`/`v` in `0..1`
 * across the canvas, north-up, so the caller can place them with percentages
 * and let the heading rotation carry them around. Burgs outside the window but
 * still nearby are clamped to the rim and flagged `offscreen`, which is how a
 * settlement announces itself before it drifts into view.
 *
 * Returns an empty list for worlds without an Azgaar campaign.
 */
export function selectMinimapBurgs({
  campaign,
  center,
  cells,
  maxMarkers = 6,
  edgeFactor = MINIMAP_BURG_EDGE_FACTOR,
}) {
  const source = campaign?.source;
  const bounds = source?.target;
  if (!bounds || !Array.isArray(campaign?.burgs) || !(cells > 0) || !center) {
    return [];
  }

  const stateColors = new Map(
    (campaign.states ?? []).map((state) => [Number(state.i), state.color]),
  );
  const halfCells = cells / 2;
  const rangeCells = halfCells * edgeFactor;
  const markers = [];

  for (const burg of campaign.burgs) {
    if (!burg || burg.removed) continue;
    const sourceX = Number(burg.x);
    const sourceY = Number(burg.y);
    if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) continue;

    const { nx, nz } = burgToNormalized({ x: sourceX, y: sourceY }, source);
    const cellX = Math.floor(bounds.minCellX + nx * bounds.widthCells);
    const cellZ = Math.floor(bounds.minCellZ + nz * bounds.heightCells);
    const offsetX = cellX - center.x;
    const offsetZ = cellZ - center.z;
    const distanceCells = Math.hypot(offsetX, offsetZ);
    if (distanceCells > rangeCells) continue;

    const offscreen = Math.abs(offsetX) > halfCells || Math.abs(offsetZ) > halfCells;
    let u = 0.5 + offsetX / cells;
    let v = 0.5 + offsetZ / cells;
    if (offscreen) {
      // distanceCells is non-zero here: an offset inside half a cell of the
      // centre cannot leave the window.
      const scale = (MINIMAP_BURG_EDGE_RADIUS * cells) / distanceCells;
      u = 0.5 + (offsetX / cells) * scale;
      v = 0.5 + (offsetZ / cells) * scale;
    }

    markers.push(Object.freeze({
      id: Number(burg.i),
      name: String(burg.name ?? ''),
      capital: Boolean(burg.capital),
      color: stateColors.get(Number(burg.state)) ?? DEFAULT_BURG_COLOR,
      u,
      v,
      offscreen,
      distanceCells,
    }));
  }

  // Nearest first, so the marker cap drops the far ones rather than whichever
  // the export happened to list last.
  markers.sort((left, right) => left.distanceCells - right.distanceCells);
  return markers.slice(0, maxMarkers);
}
