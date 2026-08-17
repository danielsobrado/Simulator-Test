import * as THREE from 'three/webgpu';
import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

const SECONDARY_SELECTION_COLOR = '#d9bd72';
const SECONDARY_SELECTION_OPACITY = 0.14;
const MOVE_PREVIEW_COLOR = '#e8d38a';
const MOVE_PREVIEW_OPACITY = 0.16;
const OVERLAY_HEIGHT_OFFSET = 0.095;

function createOverlay(color, opacity) {
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.visible = false;
  return overlay;
}

export class ObjectSelectionOverlay {
  constructor(objectView) {
    this.objectView = objectView;
    this.selectionPool = [];
    this.previewPool = [];
  }

  ensure(pool, count, color, opacity) {
    while (pool.length < count) {
      const overlay = createOverlay(color, opacity);
      this.objectView.terrainView.scene.add(overlay);
      pool.push(overlay);
    }
  }

  position(overlay, object) {
    const placement = this.objectView.resolvePlacement(object);
    const center = this.objectView.placementResolver.renderCenter(placement.bounds);
    overlay.position.set(
      center.x,
      placement.surface.baseHeight + OVERLAY_HEIGHT_OFFSET,
      center.z,
    );
    overlay.scale.set(
      placement.bounds.width * this.objectView.tileMap.tileSize,
      placement.bounds.depth * this.objectView.tileMap.tileSize,
      1,
    );
    overlay.visible = true;
  }

  sync(ids, primaryId) {
    const secondary = ids
      .filter((id) => id !== primaryId)
      .slice(0, NATURAL_EDITOR_UI_CONFIG.selection.maxVisibleOverlays);
    this.ensure(
      this.selectionPool,
      secondary.length,
      SECONDARY_SELECTION_COLOR,
      SECONDARY_SELECTION_OPACITY,
    );
    for (const overlay of this.selectionPool) overlay.visible = false;

    secondary.forEach((id, index) => {
      const object = this.objectView.objectMap.getById(id);
      if (object) this.position(this.selectionPool[index], object);
    });
  }

  previewTranslation(objects, deltaX, deltaZ) {
    const visible = objects.slice(0, NATURAL_EDITOR_UI_CONFIG.selection.maxVisibleOverlays);
    this.ensure(this.previewPool, visible.length, MOVE_PREVIEW_COLOR, MOVE_PREVIEW_OPACITY);
    for (const overlay of this.previewPool) overlay.visible = false;
    visible.forEach((object, index) => {
      this.position(this.previewPool[index], {
        ...object,
        x: object.x + deltaX,
        z: object.z + deltaZ,
      });
    });
  }

  clearPreview() {
    for (const overlay of this.previewPool) overlay.visible = false;
  }

  disposePool(pool) {
    for (const overlay of pool) {
      this.objectView.terrainView.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
    }
    pool.length = 0;
  }

  dispose() {
    this.disposePool(this.selectionPool);
    this.disposePool(this.previewPool);
  }
}
