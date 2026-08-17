import * as THREE from 'three/webgpu';
import { NATURAL_EDITOR_UI_CONFIG } from '../ui/NaturalEditorUiConfig.generated.js';

const SECONDARY_SELECTION_COLOR = '#d9bd72';
const SECONDARY_SELECTION_OPACITY = 0.14;
const MOVE_PREVIEW_COLOR = '#e8d38a';
const MOVE_PREVIEW_OPACITY = 0.16;
const OVERLAY_HEIGHT_OFFSET = 0.095;
const MAX_OVERLAYS = NATURAL_EDITOR_UI_CONFIG.selection.maxVisibleOverlays;
const ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const POSITION = new THREE.Vector3();
const SCALE = new THREE.Vector3();
const MATRIX = new THREE.Matrix4();

function createOverlay(color, opacity, name) {
  const overlay = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    MAX_OVERLAYS,
  );
  overlay.name = name;
  overlay.count = 0;
  overlay.frustumCulled = false;
  overlay.renderOrder = 18;
  return overlay;
}

export class ObjectSelectionOverlay {
  constructor(objectView) {
    this.objectView = objectView;
    this.selection = createOverlay(
      SECONDARY_SELECTION_COLOR,
      SECONDARY_SELECTION_OPACITY,
      'object-multi-selection',
    );
    this.preview = createOverlay(
      MOVE_PREVIEW_COLOR,
      MOVE_PREVIEW_OPACITY,
      'object-multi-selection-preview',
    );
    this.objectView.terrainView.scene.add(this.selection, this.preview);
  }

  matrixFor(object) {
    try {
      const placement = this.objectView.resolvePlacement(object);
      const center = this.objectView.placementResolver.renderCenter(placement.bounds);
      POSITION.set(
        center.x,
        placement.surface.baseHeight + OVERLAY_HEIGHT_OFFSET,
        center.z,
      );
      SCALE.set(
        placement.bounds.width * this.objectView.tileMap.tileSize,
        placement.bounds.depth * this.objectView.tileMap.tileSize,
        1,
      );
      return MATRIX.compose(POSITION, ROTATION, SCALE);
    } catch {
      return null;
    }
  }

  write(mesh, objects) {
    let count = 0;
    for (const object of objects) {
      if (count >= MAX_OVERLAYS) break;
      const matrix = this.matrixFor(object);
      if (!matrix) continue;
      mesh.setMatrixAt(count, matrix);
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = count > 0;
    mesh.visible = count > 0;
  }

  sync(ids, primaryId) {
    const objects = ids
      .filter((id) => id !== primaryId)
      .map((id) => this.objectView.objectMap.getById(id))
      .filter(Boolean);
    this.write(this.selection, objects);
  }

  previewTranslation(objects, deltaX, deltaZ) {
    this.write(
      this.preview,
      objects.map((object) => ({
        ...object,
        x: object.x + deltaX,
        z: object.z + deltaZ,
      })),
    );
  }

  clearPreview() {
    this.preview.count = 0;
    this.preview.visible = false;
  }

  disposeMesh(mesh) {
    this.objectView.terrainView.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  dispose() {
    this.disposeMesh(this.selection);
    this.disposeMesh(this.preview);
  }
}
