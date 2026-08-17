import * as THREE from 'three/webgpu';
import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

const SECONDARY_SELECTION_COLOR = '#d9bd72';
const SECONDARY_SELECTION_OPACITY = 0.14;
const OVERLAY_HEIGHT_OFFSET = 0.095;

function createOverlay() {
  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: SECONDARY_SELECTION_COLOR,
      transparent: true,
      opacity: SECONDARY_SELECTION_OPACITY,
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
    this.pool = [];
  }

  ensure(count) {
    while (this.pool.length < count) {
      const overlay = createOverlay();
      this.objectView.terrainView.scene.add(overlay);
      this.pool.push(overlay);
    }
  }

  sync(ids, primaryId) {
    const secondary = ids
      .filter((id) => id !== primaryId)
      .slice(0, NATURAL_EDITOR_UI_CONFIG.selection.maxVisibleOverlays);
    this.ensure(secondary.length);
    for (const overlay of this.pool) overlay.visible = false;

    secondary.forEach((id, index) => {
      const object = this.objectView.objectMap.getById(id);
      if (!object) return;
      const placement = this.objectView.resolvePlacement(object);
      const center = this.objectView.placementResolver.renderCenter(placement.bounds);
      const overlay = this.pool[index];
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
    });
  }

  dispose() {
    for (const overlay of this.pool) {
      this.objectView.terrainView.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
    }
    this.pool.length = 0;
  }
}
