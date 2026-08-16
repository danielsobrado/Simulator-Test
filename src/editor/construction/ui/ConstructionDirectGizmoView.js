import * as THREE from 'three/webgpu';
import { CONSTRUCTION_DIRECT_GIZMO_CONFIG as CONFIG } from '../config/ConstructionDirectGizmoConfig.generated.js';
import {
  anchorArc,
  constructionCentroid,
} from './ConstructionDirectGizmoModel.js';
import { createWallTopProfile } from '../masonry/WallTopProfile.js';

const PICK_PLANE_NORMAL = new THREE.Vector3(0, 1, 0);

function invisiblePickMaterial() {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  material.colorWrite = false;
  return material;
}

export class ConstructionDirectGizmoView {
  constructor({ constructionView }) {
    this.view = constructionView;
    this.terrainView = constructionView.terrainView;
    this.floatingOrigin = constructionView.floatingOrigin;
    this.root = new THREE.Group();
    this.root.name = 'construction-direct-gizmo';
    this.view.root.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Plane();
    this.pickPoint = new THREE.Vector3();
    this.cameraPoint = new THREE.Vector3();
    this.handlePoint = new THREE.Vector3();
    this.record = null;
    this.arcTable = null;
    this.selectedAnchorId = null;
    this.lastOrigin = { x: Number.NaN, z: Number.NaN };
    this.dirty = true;

    this.heightMaterial = new THREE.MeshBasicMaterial({
      color: CONFIG.render.heightColor,
      depthTest: false,
      depthWrite: false,
    });
    this.moveMaterial = new THREE.MeshBasicMaterial({
      color: CONFIG.render.moveColor,
      depthTest: false,
      depthWrite: false,
    });
    this.pickMaterial = invisiblePickMaterial();

    this.heightGroup = this.createHeightHandle();
    this.moveGroup = this.createMoveHandle();
    this.root.add(this.moveGroup, this.heightGroup);
    this.moveVisual.onBeforeRender = () => this.syncRenderPositions();
    this.hide();
  }

  createHeightHandle() {
    const group = new THREE.Group();
    group.name = 'construction-height-gizmo';

    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, CONFIG.height.lift, 0),
    ]);
    this.heightLine = new THREE.Line(lineGeometry, this.heightMaterial);
    this.heightLine.renderOrder = CONFIG.render.renderOrder;
    this.heightLine.frustumCulled = false;
    group.add(this.heightLine);

    this.heightCone = new THREE.Mesh(
      new THREE.ConeGeometry(
        CONFIG.height.coneRadius,
        CONFIG.height.coneHeight,
        CONFIG.render.radialSegments,
      ),
      this.heightMaterial,
    );
    this.heightCone.position.y = CONFIG.height.lift + CONFIG.height.coneHeight * 0.5;
    this.heightCone.renderOrder = CONFIG.render.renderOrder + 1;
    group.add(this.heightCone);

    this.heightPick = new THREE.Mesh(
      new THREE.CylinderGeometry(
        CONFIG.height.pickRadius,
        CONFIG.height.pickRadius,
        CONFIG.height.pickLength,
        CONFIG.render.radialSegments,
      ),
      this.pickMaterial,
    );
    this.heightPick.position.y = CONFIG.height.pickLength * 0.5;
    this.heightPick.userData.directGizmoKind = 'height';
    group.add(this.heightPick);
    return group;
  }

  createMoveHandle() {
    const group = new THREE.Group();
    group.name = 'construction-move-all-gizmo';

    this.moveVisual = new THREE.Mesh(
      new THREE.OctahedronGeometry(CONFIG.move.radius),
      this.moveMaterial,
    );
    this.moveVisual.renderOrder = CONFIG.render.renderOrder;
    group.add(this.moveVisual);

    this.moveRing = new THREE.Mesh(
      new THREE.TorusGeometry(
        CONFIG.move.ringRadius,
        CONFIG.move.ringTube,
        6,
        CONFIG.render.radialSegments * 2,
      ),
      this.moveMaterial,
    );
    this.moveRing.rotation.x = Math.PI / 2;
    this.moveRing.renderOrder = CONFIG.render.renderOrder;
    group.add(this.moveRing);

    this.movePick = new THREE.Mesh(
      new THREE.SphereGeometry(CONFIG.move.ringRadius, CONFIG.render.radialSegments, 8),
      this.pickMaterial,
    );
    this.movePick.userData.directGizmoKind = 'move-all';
    group.add(this.movePick);
    return group;
  }

  setRecord(record, arcTable, selectedAnchorId) {
    this.record = record;
    this.arcTable = arcTable;
    this.selectedAnchorId = selectedAnchorId;
    this.root.visible = Boolean(record && arcTable);
    this.dirty = true;
    this.syncRenderPositions();
  }

  hide() {
    this.record = null;
    this.arcTable = null;
    this.selectedAnchorId = null;
    this.dirty = true;
    this.root.visible = false;
    this.heightGroup.visible = false;
    this.moveGroup.visible = false;
  }

  groundHeight(x, z) {
    return this.terrainView.getCanonicalHeight(x, z) ?? 0;
  }

  syncRenderPositions() {
    const record = this.record;
    const arcTable = this.arcTable;
    if (!record || !arcTable || record.path.type !== 'cubicBezier') return;
    const origin = this.floatingOrigin.toRender(0, 0);
    if (!this.dirty && origin.x === this.lastOrigin.x && origin.z === this.lastOrigin.z) return;
    this.dirty = false;
    this.lastOrigin = { x: origin.x, z: origin.z };

    this.root.visible = true;
    const topProfile = createWallTopProfile(record, arcTable);
    this.syncLegacyHandles(record, arcTable, topProfile);

    const centre = constructionCentroid(record);
    if (centre) {
      const render = this.floatingOrigin.toRender(centre.x, centre.z);
      let highest = this.groundHeight(centre.x, centre.z) + record.top.base;
      for (const anchor of record.path.anchors) {
        const s = anchorArc(record, arcTable, anchor.id);
        const height = Number.isFinite(s) ? topProfile.heightAt(s) : record.top.base;
        highest = Math.max(highest, this.groundHeight(...anchor.position) + height);
      }
      this.moveGroup.position.set(render.x, highest + CONFIG.move.lift, render.z);
      this.moveGroup.visible = true;
    }

    const anchor = this.selectedAnchorId
      ? record.path.anchors.find(({ id }) => id === this.selectedAnchorId)
      : null;
    if (!anchor) {
      this.heightGroup.visible = false;
      return;
    }
    const render = this.floatingOrigin.toRender(anchor.position[0], anchor.position[1]);
    const s = anchorArc(record, arcTable, anchor.id);
    const height = Number.isFinite(s) ? topProfile.heightAt(s) : record.top.base;
    this.heightGroup.position.set(
      render.x,
      this.groundHeight(...anchor.position) + height + CONFIG.handleGroundOffset,
      render.z,
    );
    this.heightGroup.visible = true;
    this.heightPick.userData.anchorId = anchor.id;
  }

  syncLegacyHandles(record, arcTable, topProfile) {
    const anchors = new Map(record.path.anchors.map((anchor) => [anchor.id, anchor]));
    for (const mesh of this.view.handleMeshes) {
      const anchor = anchors.get(mesh.userData.anchorId);
      if (!anchor) continue;
      const s = anchorArc(record, arcTable, anchor.id);
      const height = Number.isFinite(s) ? topProfile.heightAt(s) : record.top.base;

      if (mesh.userData.handleKind === 'anchor') {
        const render = this.floatingOrigin.toRender(anchor.position[0], anchor.position[1]);
        mesh.position.set(
          render.x,
          this.groundHeight(...anchor.position) + height + CONFIG.handleGroundOffset,
          render.z,
        );
        continue;
      }

      if (mesh.userData.handleKind === 'tangent') {
        const segment = record.path.segments.find(({ id }) => id === mesh.userData.segmentId);
        if (!segment) continue;
        const offset = mesh.userData.which === 'start' ? segment.startHandle : segment.endHandle;
        const x = anchor.position[0] + offset[0];
        const z = anchor.position[1] + offset[1];
        const render = this.floatingOrigin.toRender(x, z);
        mesh.position.set(render.x, this.groundHeight(x, z) + height + CONFIG.handleGroundOffset, render.z);
      }
    }

    const selected = this.selectedAnchorId ? anchors.get(this.selectedAnchorId) : null;
    if (!selected) return;
    const anchorMesh = this.view.handleMeshes.find((mesh) => (
      mesh.userData.handleKind === 'anchor' && mesh.userData.anchorId === selected.id
    ));
    const tangentMeshes = this.view.handleMeshes.filter((mesh) => (
      mesh.userData.handleKind === 'tangent' && mesh.userData.anchorId === selected.id
    ));
    if (!anchorMesh) return;

    for (let index = 0; index < this.view.handleLines.length; index += 1) {
      const line = this.view.handleLines[index];
      const tangent = tangentMeshes[index];
      const position = line?.geometry?.getAttribute('position');
      if (!tangent || !position || position.count < 2) continue;
      position.setXYZ(0, anchorMesh.position.x, anchorMesh.position.y, anchorMesh.position.z);
      position.setXYZ(1, tangent.position.x, tangent.position.y, tangent.position.z);
      position.needsUpdate = true;
    }
  }

  setPointer(clientX, clientY) {
    const bounds = this.terrainView.renderer.domElement.getBoundingClientRect();
    if (!(bounds.width > 0) || !(bounds.height > 0)) return false;
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -(((clientY - bounds.top) / bounds.height) * 2 - 1),
    );
    return true;
  }

  pick(clientX, clientY, camera) {
    if (!this.root.visible || !camera || !this.setPointer(clientX, clientY)) return null;
    this.syncRenderPositions();
    this.raycaster.setFromCamera(this.pointer, camera);
    const targets = [];
    if (this.heightGroup.visible) targets.push(this.heightPick);
    if (this.moveGroup.visible) targets.push(this.movePick);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    return {
      kind: hit.object.userData.directGizmoKind,
      anchorId: hit.object.userData.anchorId ?? null,
    };
  }

  canonicalPointOnHorizontalPlane(clientX, clientY, camera, y) {
    if (!camera || !Number.isFinite(y) || !this.setPointer(clientX, clientY)) return null;
    this.raycaster.setFromCamera(this.pointer, camera);
    this.pickPlane.set(PICK_PLANE_NORMAL, -y);
    const hit = this.raycaster.ray.intersectPlane(this.pickPlane, this.pickPoint);
    if (!hit) return null;
    const canonical = this.floatingOrigin.toCanonical(hit.x, hit.z);
    return { x: canonical.x, z: canonical.z };
  }

  heightUnitsPerPixel(camera) {
    const bounds = this.terrainView.renderer.domElement.getBoundingClientRect();
    if (!(bounds.height > 0) || !camera) return CONFIG.height.minUnitsPerPixel;

    let units;
    if (camera.isPerspectiveCamera) {
      camera.getWorldPosition(this.cameraPoint);
      this.heightGroup.getWorldPosition(this.handlePoint);
      const distance = Math.max(0.1, this.cameraPoint.distanceTo(this.handlePoint));
      units = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance / bounds.height;
    } else if (camera.isOrthographicCamera) {
      units = Math.abs(camera.top - camera.bottom) / Math.max(1, camera.zoom) / bounds.height;
    } else {
      units = CONFIG.height.minUnitsPerPixel;
    }
    return THREE.MathUtils.clamp(
      units,
      CONFIG.height.minUnitsPerPixel,
      CONFIG.height.maxUnitsPerPixel,
    );
  }

  dispose() {
    this.view.root.remove(this.root);
    this.heightLine.geometry.dispose();
    this.heightCone.geometry.dispose();
    this.heightPick.geometry.dispose();
    this.moveVisual.geometry.dispose();
    this.moveRing.geometry.dispose();
    this.movePick.geometry.dispose();
    this.heightMaterial.dispose();
    this.moveMaterial.dispose();
    this.pickMaterial.dispose();
  }
}
