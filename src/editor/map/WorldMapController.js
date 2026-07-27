import { PLAYER_MODE_WALK } from '../player/playerConstants.js';
import { cellCenterToWorld, worldToCell } from '../world/WorldCoordinates.js';
import { findNearestLandCell } from './worldMapCoordinates.js';

const WATER_TILE_ID = 0;
const MAX_LAND_SNAP_RINGS = 24;

/**
 * World-map overlay behaviour. Shortcut routing and pointer-lock ownership live
 * in GameplayOverlayController; this class only owns map UI state and teleport.
 */
export class WorldMapController {
  constructor({
    worldStore,
    floatingOrigin,
    tileSize,
    getViewModeController,
    getPlayerController,
    getCampaign,
    overlayController = null,
  }) {
    this.worldStore = worldStore;
    this.floatingOrigin = floatingOrigin;
    this.tileSize = tileSize;
    this.getViewModeController = getViewModeController;
    this.getPlayerController = getPlayerController;
    this.getCampaign = getCampaign;
    this.overlayController = overlayController;

    this.isOpen = false;
    this.listeners = new Set();

    if (this.overlayController) {
      this.unregisterOverlay = this.overlayController.registerOverlay('world-map', {
        onOpen: () => this.handleOverlayOpen(),
        onClose: () => this.handleOverlayClose(),
      });
    } else {
      this.unregisterOverlay = null;
    }
  }

  getCampaignData() {
    return this.getCampaign?.() ?? null;
  }

  getBaseTerrain() {
    return this.worldStore?.baseTerrain ?? null;
  }

  hasWorldMap() {
    return Boolean(this.getCampaignData() && this.getBaseTerrain());
  }

  getState() {
    return Object.freeze({
      isOpen: this.isOpen,
      available: this.hasWorldMap(),
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  handleOverlayOpen() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.emit();
  }

  handleOverlayClose() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit();
  }

  open() {
    if (this.overlayController) {
      this.overlayController.open('world-map');
      return;
    }
    this.handleOverlayOpen();
  }

  close() {
    if (this.overlayController) {
      this.overlayController.close('world-map');
      return;
    }
    this.handleOverlayClose();
  }

  toggle() {
    if (this.overlayController) {
      this.overlayController.toggle('world-map');
      return;
    }
    if (this.isOpen) {
      this.handleOverlayClose();
    } else {
      this.handleOverlayOpen();
    }
  }

  getPlayerFocusWorld() {
    const viewModeController = this.getViewModeController?.();
    if (!viewModeController) return null;
    const render = viewModeController.getFocusWorld();
    return this.floatingOrigin.toCanonical(render.x, render.z);
  }

  // The streamed terrain derives land/water from the coarse macro atlas, so a
  // click on a fine vector coastline can point at an ocean cell. Snap the target
  // to the nearest cell the player can actually stand on above sea level.
  resolveLandTarget(canonicalX, canonicalZ) {
    const baseTerrain = this.getBaseTerrain();
    const bounds = baseTerrain?.bounds;
    const atlas = baseTerrain?.atlas;
    if (!bounds || !atlas || !this.worldStore) {
      return { x: canonicalX, z: canonicalZ, snapped: false, found: true };
    }
    const seaLevel = baseTerrain.terrain?.seaLevel ?? -1.5;
    const cell = worldToCell(canonicalX, canonicalZ, this.tileSize);
    const stepCells = Math.max(1, Math.round(bounds.widthCells / atlas.width));
    const isLand = (cellX, cellZ) => this.worldStore.getTile(cellX, cellZ) !== WATER_TILE_ID
      && this.worldStore.getCellHeight(cellX, cellZ) > seaLevel;

    const result = findNearestLandCell(cell.x, cell.z, isLand, {
      stepCells,
      maxRings: MAX_LAND_SNAP_RINGS,
    });
    const world = cellCenterToWorld(result.x, result.z, this.tileSize);
    return {
      x: world.x,
      z: world.z,
      snapped: result.snapped,
      found: result.found,
      clickedCell: cell,
      targetCell: { x: result.x, z: result.z },
    };
  }

  teleportTo(canonicalX, canonicalZ) {
    const viewModeController = this.getViewModeController?.();
    const playerController = this.getPlayerController?.();
    if (!viewModeController || !playerController) return;

    const target = this.resolveLandTarget(canonicalX, canonicalZ);
    if (target.clickedCell) {
      // Leaves a breadcrumb in DevTools for debugging misfired teleports.
      console.info(
        '[world-map] teleport',
        target.snapped ? 'snapped to shore' : (target.found ? 'on land' : 'no land found'),
        { clicked: target.clickedCell, target: target.targetCell },
      );
    }
    const render = this.floatingOrigin.toRender(target.x, target.z);

    // Close first so uiBlocked clears before requesting pointer lock.
    this.close();

    if (viewModeController.mode === PLAYER_MODE_WALK) {
      playerController.setPose({ x: render.x, z: render.z });
      playerController.requestPointerLock();
    } else {
      viewModeController.setMode(PLAYER_MODE_WALK, {
        spawn: render,
        requestPointerLock: true,
      });
    }
  }

  dispose() {
    this.unregisterOverlay?.();
    this.unregisterOverlay = null;
    this.listeners.clear();
  }
}
