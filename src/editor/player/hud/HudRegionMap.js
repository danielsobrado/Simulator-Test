import { selectMinimapBurgs } from '../../map/minimapBurgs.js';
import { createMinimapBurgElements } from '../../map/minimapBurgMarkers.js';
import { paintRegionMap } from '../../map/regionMapPainter.js';
import { getWorldVectorModel } from '../../map/worldMapModelCache.js';
import { findVectorMapCell } from '../../map/worldMapVector.js';
import { MAP_ZOOM } from './HudMinimap.js';

/** Canvas resolution; the dial shows it at up to ~310 CSS px after the zoom. */
const CANVAS_SIZE = 384;
/** How many Azgaar cells, on average, span the bitmap's window. */
const SPAN_AZGAAR_CELLS = 16;
/** Burgs sit closer together at this scale, so fewer are named than locally. */
const MAX_BURGS = 4;

/**
 * The nearby area of the Azgaar map, framed like the editor's minimap so the
 * walking dial can dock it in its place: a `.minimap-frame` holding a canvas
 * and the burg markers, with a window measured in world cells.
 *
 * The window spans a fixed number of Azgaar cells rather than world cells,
 * because an imported world is planet-scale: the editor's local window lies
 * inside a single Azgaar cell and would show one flat biome.
 */
export class HudRegionMap {
  /**
   * @param {object} deps
   * @param {() => object | null} deps.getCampaign
   * @param {() => object | null} deps.getBaseTerrain
   * @param {number} deps.tileSize metres per cell
   */
  constructor({ getCampaign, getBaseTerrain, tileSize }) {
    this.getCampaign = getCampaign;
    this.getBaseTerrain = getBaseTerrain;
    this.tileSize = tileSize;
    this.center = { x: 0, z: 0 };
    this.cells = 0;
    this.model = null;
    this.modelCampaign = undefined;

    this.frame = document.createElement('div');
    this.frame.className = 'minimap-frame minimap-frame--region';
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.burgs = document.createElement('div');
    this.burgs.className = 'minimap-burgs';
    this.burgs.setAttribute('aria-hidden', 'true');
    this.frame.append(this.canvas, this.burgs);
  }

  /** Whether the current world has Azgaar cartography to show. */
  isAvailable() {
    return this.resolveModel() != null;
  }

  resolveModel() {
    const campaign = this.getCampaign?.() ?? null;
    if (campaign === this.modelCampaign) return this.model;
    this.modelCampaign = campaign;
    this.model = null;
    try {
      this.model = getWorldVectorModel(campaign, this.getBaseTerrain?.() ?? null);
    } catch (error) {
      console.warn('Unable to decode Azgaar cartography for the walking minimap.', error);
    }
    const bounds = campaign?.source?.target;
    if (this.model && !(bounds?.widthCells > 0 && campaign.source.sourceWidth > 0)) this.model = null;
    if (this.model) {
      const { width, height, cartography } = this.model;
      const meanCellSource = Math.sqrt((width * height) / Math.max(1, cartography.cellIds.length));
      this.cells = Math.max(1, Math.round(
        SPAN_AZGAAR_CELLS * meanCellSource * bounds.widthCells / campaign.source.sourceWidth,
      ));
    }
    return this.model;
  }

  getWindow() {
    return { center: this.center, cells: this.cells };
  }

  /**
   * The Azgaar province under a world cell, else its state; id 0 is Azgaar's
   * "no province" / "Neutrals", which is not a place name.
   */
  describeRegion(cellX, cellZ) {
    const model = this.resolveModel();
    if (!model) return null;
    const { target: bounds, sourceWidth, sourceHeight } = this.modelCampaign.source;
    const index = findVectorMapCell(
      model,
      (cellX + 0.5 - bounds.minCellX) * sourceWidth / bounds.widthCells,
      sourceHeight - (cellZ + 0.5 - bounds.minCellZ) * sourceHeight / bounds.heightCells,
    );
    if (index < 0) return null;
    const { cartography, lookups } = model;
    const province = cartography.provinces[index];
    const state = cartography.states[index];
    return (province ? lookups.provinceById.get(province)?.name : null)
      ?? (state ? lookups.stateById.get(state)?.name : null)
      ?? null;
  }

  /** Redraws the window around `cell`, an integer world cell. */
  recenter(cell) {
    const model = this.resolveModel();
    const campaign = this.modelCampaign;
    if (!model) return;
    this.center = { x: cell.x, z: cell.z };
    const { target: bounds, sourceWidth, sourceHeight } = campaign.source;
    const toSourceX = sourceWidth / bounds.widthCells;
    const toSourceY = sourceHeight / bounds.heightCells;
    const half = this.cells / 2;
    paintRegionMap(this.canvas.getContext('2d'), model, {
      minX: (cell.x - half - bounds.minCellX) * toSourceX,
      minY: sourceHeight - (cell.z + half - bounds.minCellZ) * toSourceY,
      width: this.cells * toSourceX,
      height: this.cells * toSourceY,
    });
    const markers = selectMinimapBurgs({
      campaign, center: this.center, cells: this.cells, maxMarkers: MAX_BURGS, dialZoom: MAP_ZOOM,
    });
    this.burgs.replaceChildren(...createMinimapBurgElements(markers, this.tileSize));
  }
}
