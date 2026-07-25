import * as THREE from 'three/webgpu';
import { QUARTER_TURN_RADIANS } from './constants.js';
import { disposeModelParts } from './assets/modelParts.js';
import { createObjectModelParts } from './ObjectModelLibrary.js';
import { evaluateObjectSurface } from './TerrainPlacement.js';

const PREVIEW_VALID_COLOR = '#79d47d';
const PREVIEW_INVALID_COLOR = '#db6868';
const SELECTION_COLOR = '#f0cf68';
const FOUNDATION_EPSILON = 0.03;
const FOUNDATION_OVERLAP = 0.04;
const OVERLAY_HEIGHT_OFFSET = 0.09;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function nextCapacity(required) {
  let capacity = 8;
  while (capacity < required) {
    capacity *= 2;
  }
  return capacity;
}

export class ObjectView {
  constructor({ terrainView, tileMap, heightField, objectMap, objectCatalog }) {
    this.terrainView = terrainView;
    this.tileMap = tileMap;
    this.heightField = heightField;
    this.objectMap = objectMap;
    this.objectCatalog = objectCatalog;
    this.definitionByKey = new Map(objectCatalog.map((definition) => [definition.key, definition]));
    this.root = new THREE.Group();
    this.root.name = 'placed-objects';
    terrainView.scene.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderers = new Map();
    this.pickMeshes = [];
    this.previewGroup = new THREE.Group();
    this.previewGroup.visible = false;
    terrainView.scene.add(this.previewGroup);
    this.previewDefinitionKey = null;

    this.previewFoundation = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: PREVIEW_VALID_COLOR,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      }),
    );
    this.previewFoundation.visible = false;
    terrainView.scene.add(this.previewFoundation);

    this.footprintPreview = this.createOverlay(PREVIEW_VALID_COLOR, 0.26);
    this.selectionOverlay = this.createOverlay(SELECTION_COLOR, 0.24);
    terrainView.scene.add(this.footprintPreview, this.selectionOverlay);

    const hemisphere = new THREE.HemisphereLight('#dce8ff', '#293326', 1.45);
    const sun = new THREE.DirectionalLight('#fff1cf', 2.1);
    sun.position.set(80, 120, 60);
    terrainView.scene.add(hemisphere, sun);

    for (const definition of objectCatalog) {
      const parts = createObjectModelParts(definition, tileMap.tileSize);
      this.definitionByKey.set(definition.key, definition);
      this.renderers.set(definition.key, this.createRendererRecord(definition, parts));
    }

    this.refreshAll();
  }

  createRendererRecord(definition, parts) {
    const hasFoundation = definition.foundation.mode === 'terrace';
    return {
      definition,
      parts,
      meshes: [],
      capacity: 0,
      foundationGeometry: hasFoundation ? new THREE.BoxGeometry(1, 1, 1) : null,
      foundationMaterial: hasFoundation
        ? new THREE.MeshStandardMaterial({
          color: definition.foundation.color,
          roughness: 0.96,
          metalness: 0,
        })
        : null,
      foundationMesh: null,
      foundationCapacity: 0,
    };
  }

  registerDefinition(definition, parts) {
    if (!definition || !Array.isArray(parts) || parts.length === 0) {
      throw new Error('Cannot register an empty procedural object renderer.');
    }
    const previous = this.renderers.get(definition.key);
    if (previous) {
      for (const mesh of previous.meshes) {
        this.root.remove(mesh);
        mesh.dispose?.();
      }
      if (previous.foundationMesh) {
        this.root.remove(previous.foundationMesh);
        previous.foundationMesh.dispose?.();
      }
      previous.foundationGeometry?.dispose();
      previous.foundationMaterial?.dispose();
      disposeModelParts(previous.parts);
    }
    this.definitionByKey.set(definition.key, definition);
    this.renderers.set(definition.key, this.createRendererRecord(definition, parts));
    if (this.previewDefinitionKey === definition.key) {
      for (const child of this.previewGroup.children) child.material.dispose();
      this.previewGroup.clear();
      this.previewDefinitionKey = null;
    }
    this.refreshAll();
  }

  createOverlay(color, opacity) {
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

  resolvePlacement(object) {
    const definition = this.definitionByKey.get(object.definitionKey);
    if (!definition) {
      throw new Error(`Unknown object definition: ${object.definitionKey}.`);
    }
    const bounds = this.objectMap.getBounds(
      object.x,
      object.z,
      object.definitionKey,
      object.rotation,
    );
    const evaluation = evaluateObjectSurface({
      definition,
      heightField: this.heightField,
      bounds,
      tileSize: this.tileMap.tileSize,
    });
    return { definition, bounds, ...evaluation };
  }

  refreshAll() {
    const grouped = new Map(Array.from(this.renderers.keys(), (definitionKey) => [definitionKey, []]));
    for (const object of this.objectMap.list()) {
      grouped.get(object.definitionKey)?.push(object);
    }

    this.pickMeshes = [];
    for (const [definitionKey, renderer] of this.renderers.entries()) {
      const objects = grouped.get(definitionKey) ?? [];
      const placements = objects.map((object) => ({ object, placement: this.resolvePlacement(object) }));
      this.ensureCapacity(renderer, objects.length);
      const objectIds = objects.map((object) => object.id);

      for (const mesh of renderer.meshes) {
        mesh.count = objects.length;
        mesh.userData.objectIds = objectIds;
        this.pickMeshes.push(mesh);
      }

      for (let index = 0; index < placements.length; index += 1) {
        const { object, placement } = placements[index];
        const rootMatrix = this.createObjectMatrix(object, placement.surface);
        for (let partIndex = 0; partIndex < renderer.parts.length; partIndex += 1) {
          const matrix = new THREE.Matrix4().multiplyMatrices(rootMatrix, renderer.parts[partIndex].matrix);
          renderer.meshes[partIndex].setMatrixAt(index, matrix);
        }
      }

      for (const mesh of renderer.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }

      const foundationPlacements = placements.filter(
        ({ placement }) => placement.surface.foundationDepth > FOUNDATION_EPSILON,
      );
      this.refreshFoundations(renderer, foundationPlacements);
    }
  }

  ensureCapacity(renderer, required) {
    // Definitions with nothing placed stay unallocated, so a large catalog does
    // not put hundreds of empty instanced meshes in front of the renderer.
    if (required === 0) {
      return;
    }
    if (renderer.capacity >= Math.max(1, required)) {
      return;
    }

    const capacity = nextCapacity(required);
    for (const mesh of renderer.meshes) {
      this.root.remove(mesh);
      mesh.dispose?.();
    }

    renderer.meshes = renderer.parts.map((part) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.objectIds = [];
      this.root.add(mesh);
      return mesh;
    });
    renderer.capacity = capacity;
  }

  ensureFoundationCapacity(renderer, required) {
    if (!renderer.foundationGeometry || required === 0) {
      return;
    }
    if (renderer.foundationMesh && renderer.foundationCapacity >= required) {
      return;
    }

    if (renderer.foundationMesh) {
      this.root.remove(renderer.foundationMesh);
      renderer.foundationMesh.dispose?.();
    }

    renderer.foundationCapacity = nextCapacity(required);
    renderer.foundationMesh = new THREE.InstancedMesh(
      renderer.foundationGeometry,
      renderer.foundationMaterial,
      renderer.foundationCapacity,
    );
    renderer.foundationMesh.count = 0;
    renderer.foundationMesh.castShadow = true;
    renderer.foundationMesh.receiveShadow = true;
    renderer.foundationMesh.userData.objectIds = [];
    this.root.add(renderer.foundationMesh);
  }

  refreshFoundations(renderer, placements) {
    this.ensureFoundationCapacity(renderer, placements.length);
    if (!renderer.foundationMesh) {
      return;
    }

    renderer.foundationMesh.count = placements.length;
    renderer.foundationMesh.userData.objectIds = placements.map(({ object }) => object.id);
    for (let index = 0; index < placements.length; index += 1) {
      const { placement } = placements[index];
      renderer.foundationMesh.setMatrixAt(
        index,
        this.createFoundationMatrix(placement.bounds, placement.surface),
      );
    }
    renderer.foundationMesh.instanceMatrix.needsUpdate = true;
    renderer.foundationMesh.computeBoundingSphere();
    if (placements.length > 0) {
      this.pickMeshes.push(renderer.foundationMesh);
    }
  }

  createObjectMatrix(object, surfaceOverride = null) {
    const placement = surfaceOverride
      ? {
        bounds: this.objectMap.getBounds(object.x, object.z, object.definitionKey, object.rotation),
        definition: this.definitionByKey.get(object.definitionKey),
        surface: surfaceOverride,
      }
      : this.resolvePlacement(object);
    const center = this.terrainView.boundsToWorld(placement.bounds);
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      WORLD_UP,
      -object.rotation * QUARTER_TURN_RADIANS,
    );
    let quaternion = yaw;

    if (placement.definition.foundation.alignToNormal) {
      const normal = new THREE.Vector3(
        placement.surface.normal.x,
        placement.surface.normal.y,
        placement.surface.normal.z,
      );
      const alignment = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normal);
      quaternion = alignment.multiply(yaw);
    }

    return new THREE.Matrix4().compose(
      new THREE.Vector3(center.x, placement.surface.baseHeight, center.z),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
  }

  createFoundationMatrix(bounds, surface) {
    const center = this.terrainView.boundsToWorld(bounds);
    const depth = surface.foundationDepth + FOUNDATION_OVERLAP;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(
        center.x,
        surface.baseHeight - depth / 2,
        center.z,
      ),
      new THREE.Quaternion(),
      new THREE.Vector3(
        bounds.width * this.tileMap.tileSize * 0.96,
        depth,
        bounds.depth * this.tileMap.tileSize * 0.96,
      ),
    );
  }

  pickObject(clientX, clientY, camera) {
    const bounds = this.terrainView.renderer.domElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);

    const hit = this.raycaster.intersectObjects(this.pickMeshes, false)[0];
    if (!hit || hit.instanceId === undefined) {
      return null;
    }
    return hit.object.userData.objectIds[hit.instanceId] ?? null;
  }

  setPreview(preview) {
    if (!preview) {
      this.previewGroup.visible = false;
      this.previewFoundation.visible = false;
      this.footprintPreview.visible = false;
      return;
    }

    if (this.previewDefinitionKey !== preview.definitionKey) {
      this.rebuildPreview(preview.definitionKey);
    }

    const object = {
      definitionKey: preview.definitionKey,
      x: preview.x,
      z: preview.z,
      rotation: preview.rotation,
    };
    const placement = preview.surface
      ? {
        definition: this.definitionByKey.get(preview.definitionKey),
        bounds: this.objectMap.getBounds(preview.x, preview.z, preview.definitionKey, preview.rotation),
        surface: preview.surface,
      }
      : this.resolvePlacement(object);
    const matrix = this.createObjectMatrix(object, placement.surface);
    matrix.decompose(this.previewGroup.position, this.previewGroup.quaternion, this.previewGroup.scale);
    const color = preview.valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
    for (const mesh of this.previewGroup.children) {
      mesh.material.color.set(color);
    }
    this.previewGroup.visible = true;

    if (placement.surface.foundationDepth > FOUNDATION_EPSILON) {
      this.createFoundationMatrix(placement.bounds, placement.surface).decompose(
        this.previewFoundation.position,
        this.previewFoundation.quaternion,
        this.previewFoundation.scale,
      );
      this.previewFoundation.material.color.set(color);
      this.previewFoundation.visible = true;
    } else {
      this.previewFoundation.visible = false;
    }

    this.positionOverlay(
      this.footprintPreview,
      placement.bounds,
      color,
      placement.surface.baseHeight,
    );
  }

  rebuildPreview(definitionKey) {
    for (const child of this.previewGroup.children) {
      child.material.dispose();
    }
    this.previewGroup.clear();

    const renderer = this.renderers.get(definitionKey);
    if (!renderer) {
      throw new Error(`Unknown object definition: ${definitionKey}.`);
    }
    for (const part of renderer.parts) {
      const mesh = new THREE.Mesh(
        part.geometry,
        new THREE.MeshBasicMaterial({
          color: PREVIEW_VALID_COLOR,
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
        }),
      );
      part.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      this.previewGroup.add(mesh);
    }
    this.previewDefinitionKey = definitionKey;
  }

  setSelection(objectId) {
    const object = objectId ? this.objectMap.getById(objectId) : null;
    if (!object) {
      this.selectionOverlay.visible = false;
      return;
    }
    const placement = this.resolvePlacement(object);
    this.positionOverlay(
      this.selectionOverlay,
      placement.bounds,
      SELECTION_COLOR,
      placement.surface.baseHeight,
    );
  }

  positionOverlay(overlay, bounds, color, height) {
    const center = this.terrainView.boundsToWorld(bounds);
    overlay.position.set(center.x, height + OVERLAY_HEIGHT_OFFSET, center.z);
    overlay.scale.set(
      bounds.width * this.tileMap.tileSize,
      bounds.depth * this.tileMap.tileSize,
      1,
    );
    overlay.material.color.set(color);
    overlay.visible = true;
  }

  dispose() {
    for (const renderer of this.renderers.values()) {
      for (const mesh of renderer.meshes) {
        this.root.remove(mesh);
        mesh.dispose?.();
      }
      if (renderer.foundationMesh) {
        this.root.remove(renderer.foundationMesh);
        renderer.foundationMesh.dispose?.();
      }
      renderer.foundationGeometry?.dispose();
      renderer.foundationMaterial?.dispose();
      disposeModelParts(renderer.parts);
    }
    for (const child of this.previewGroup.children) {
      child.material.dispose();
    }
    this.previewFoundation.geometry.dispose();
    this.previewFoundation.material.dispose();
    this.footprintPreview.geometry.dispose();
    this.footprintPreview.material.dispose();
    this.selectionOverlay.geometry.dispose();
    this.selectionOverlay.material.dispose();
    this.terrainView.scene.remove(
      this.root,
      this.previewGroup,
      this.previewFoundation,
      this.footprintPreview,
      this.selectionOverlay,
    );
  }
}
