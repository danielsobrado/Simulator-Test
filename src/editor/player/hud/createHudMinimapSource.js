import { selectMinimapBurgs } from '../../map/minimapBurgs.js';
import { worldToCellPoint } from '../../world/WorldCoordinates.js';
import { HudRegionMap } from './HudRegionMap.js';

/** Settlements on the compass: the nearest few, out to this many minimap windows. */
const COMPASS_MAX_PLACES = 5;
const COMPASS_RANGE_FACTOR = 12;

/**
 * Adapts the editor's minimap and tile lookups to what `HudMinimap` needs, so
 * the HUD never reaches into EditorUi or the editor controller itself.
 *
 * Worlds imported from Azgaar dock the nearby area of the Azgaar map; other
 * worlds dock the editor's own cell-scale minimap. The choice is made each
 * time the dial docks a frame, so importing a world while walking takes effect
 * the next time walking starts.
 *
 * @param {object} deps
 * @param {import('../../EditorUi.js').EditorUi} deps.ui owner of the minimap bitmap
 * @param {{ focusProvider?: () => { x: number, z: number }, campaign?: object | null }} deps.controller
 * @param {{ tileSize: number, get: Function, getTileDefinition: Function }} deps.tileMap
 * @param {() => object | null} [deps.getBaseTerrain]
 * @param {() => { label: string, color: string } | null} [deps.getLocationLabel] active instanced location label
 */
export function createHudMinimapSource({
  ui, controller, tileMap, getBaseTerrain = () => null, getLocationLabel = () => null,
}) {
  const editorMap = Object.freeze({
    frame: ui.minimapFrame ?? null,
    getWindow: () => ui.minimapPublishedWindow ?? ({ center: ui.minimapCenter, cells: ui.minimapCells }),
    // Offset follows the published bitmap until the replacement is complete.
    recenter: (cell) => {
      ui.minimapCenter = cell;
      ui.updateMinimap();
    },
  });
  const regionMap = new HudRegionMap({
    getCampaign: () => controller.campaign ?? null,
    getBaseTerrain,
    tileSize: tileMap.tileSize,
  });
  const regionAdapter = Object.freeze({
    frame: regionMap.frame,
    getWindow: () => regionMap.getWindow(),
    recenter: (cell) => regionMap.recenter(cell),
  });
  let active = editorMap;

  return Object.freeze({
    getFrame: () => {
      active = regionMap.isAvailable() ? regionAdapter : editorMap;
      return active.frame;
    },
    getWindow: () => active.getWindow(),
    recenter: (cell) => active.recenter(cell),
    getFocusPoint: () => {
      const canonical = controller.focusProvider?.();
      return canonical ? worldToCellPoint(canonical.x, canonical.z, tileMap.tileSize) : null;
    },
    getPlaces: (point) => selectMinimapBurgs({
      campaign: controller.campaign ?? null,
      center: { x: Math.floor(point.x), z: Math.floor(point.z) },
      cells: active.getWindow().cells,
      maxMarkers: COMPASS_MAX_PLACES,
      edgeFactor: COMPASS_RANGE_FACTOR,
    }).map(({ id, name, capital, color, u, v, distanceCells }) => ({
      id,
      name,
      capital,
      color,
      // Rim clamping keeps a marker's direction, which is all the compass reads.
      worldDx: u - 0.5,
      worldDz: v - 0.5,
      metres: distanceCells * tileMap.tileSize,
    })),
    describeRegion: (cellX, cellZ) => (getLocationLabel() ? null : regionMap.describeRegion(cellX, cellZ)),
    describeCell: (cellX, cellZ) => {
      const locationLabel = getLocationLabel();
      if (locationLabel) return locationLabel;
      const definition = tileMap.getTileDefinition(tileMap.get(cellX, cellZ));
      return definition ? { label: definition.label, color: definition.color } : null;
    },
  });
}
