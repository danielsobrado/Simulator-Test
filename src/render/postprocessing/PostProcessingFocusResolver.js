import * as THREE from 'three';
import { raycastTerrainHeightfield } from '../../editor/spells/spell_terrain_adapter.js';

const MIN_FOCUS_DISTANCE_METERS = 0.5;

/**
 * Bridges post-processing to the existing player, selection, and picking
 * systems. It returns only a scalar distance, so render nodes stay independent
 * of editor domain objects.
 */
export class PostProcessingFocusResolver {
  constructor({
    terrainView,
    playerController,
    editorController,
    objectView,
    constructionView,
  }) {
    this.terrainView = terrainView;
    this.playerController = playerController;
    this.editorController = editorController;
    this.objectView = objectView;
    this.constructionView = constructionView;
    this.centre = new THREE.Vector2(0, 0);
    this.raycaster = new THREE.Raycaster();
    this.target = new THREE.Vector3();
  }

  resolve(mode, camera, previousFocus) {
    if (!camera) return null;
    if (mode === 'selection') {
      return this.selectionDistance(camera) ?? this.playerDistance(camera);
    }
    if (mode === 'centre-raycast') {
      return this.centreRaycastDistance(camera) ?? previousFocus;
    }
    return this.playerDistance(camera);
  }

  playerDistance(camera) {
    const state = this.playerController?.state;
    if (!state) return null;
    this.target.set(
      state.x,
      this.terrainView.getWorldHeight(state.x, state.z),
      state.z,
    );
    return this.validDistance(camera.position.distanceTo(this.target));
  }

  selectionDistance(camera) {
    const objectId = this.editorController?.selectedObjectId;
    const object = objectId == null
      ? null
      : this.editorController.objectMap?.getById(objectId);
    if (!object) return null;
    const placement = this.objectView.resolvePlacement(object);
    const centre = this.objectView.placementResolver.renderCenter(placement.bounds);
    this.target.set(centre.x, placement.surface.baseHeight, centre.z);
    return this.validDistance(camera.position.distanceTo(this.target));
  }

  centreRaycastDistance(camera) {
    this.raycaster.setFromCamera(this.centre, camera);
    const maximumDistance = Number.isFinite(camera.far) ? camera.far : 5000;
    let nearest = Infinity;

    const terrainHit = raycastTerrainHeightfield(
      this.terrainView,
      this.raycaster.ray,
      maximumDistance,
    );
    if (terrainHit) nearest = Math.min(nearest, terrainHit.distance);

    const canvas = this.terrainView.renderer.domElement;
    const bounds = canvas.getBoundingClientRect();
    const centreX = bounds.left + bounds.width * 0.5;
    const centreY = bounds.top + bounds.height * 0.5;

    const constructionHit = this.constructionView?.pickConstructionPoint(
      centreX,
      centreY,
      camera,
    );
    if (constructionHit) {
      const render = this.terrainView.floatingOrigin.toRender(
        constructionHit.x,
        constructionHit.z,
      );
      this.target.set(render.x, constructionHit.y, render.z);
      nearest = Math.min(nearest, camera.position.distanceTo(this.target));
    }

    const objectId = this.objectView?.pickObject(centreX, centreY, camera);
    const object = objectId == null
      ? null
      : this.editorController.objectMap?.getById(objectId);
    if (object) {
      const placement = this.objectView.resolvePlacement(object);
      const centre = this.objectView.placementResolver.renderCenter(placement.bounds);
      this.target.set(centre.x, placement.surface.baseHeight, centre.z);
      nearest = Math.min(nearest, camera.position.distanceTo(this.target));
    }

    // Character renderers currently expose no independent pick registry. The
    // player target is still covered by Player mode; future character views can
    // contribute a distance here without changing the DOF node.
    return this.validDistance(nearest);
  }

  validDistance(distance) {
    return Number.isFinite(distance)
      ? Math.max(MIN_FOCUS_DISTANCE_METERS, distance)
      : null;
  }
}
