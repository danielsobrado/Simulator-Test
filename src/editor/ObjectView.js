import * as THREE from 'three/webgpu';
import { disposeModelParts } from './assets/modelParts.js';
import { createObjectModelParts } from './ObjectModelLibrary.js';
import { ObjectLodController } from './ObjectLodController.js';
import { PerfCounters } from './performance/qa/PerfCounters.js';
import { ObjectPlacementResolver } from './placement/ObjectPlacementResolver.js';
import {
  createInstancedRenderers,
  disposeInstancedRenderers,
  writeInstances,
} from './stylized/lod/StylizedLodRuntime.js';

const PREVIEW_VALID_COLOR = '#79d47d';
const PREVIEW_INVALID_COLOR = '#db6868';
const SELECTION_COLOR = '#f0cf68';
const FOUNDATION_EPSILON = 0.03;
const OVERLAY_HEIGHT_OFFSET = 0.09;

function nextCapacity(required) {
  let capacity = 8;
  while (capacity < required) capacity *= 2;
  return capacity;
}

function geometryTriangles(geometry) {
  return (geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) / 3;
}

function bandTriangles(parts) {
  return parts.reduce((total, part) => total + geometryTriangles(part.geometry), 0);
}

function geometryBytes(geometry) {
  let bytes = geometry.index?.array?.byteLength ?? 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array?.byteLength ?? 0;
  }
  return bytes;
}

function modelBounds(parts) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const entry of parts) {
    entry.geometry.computeBoundingBox();
    if (!entry.geometry.boundingBox) continue;
    bounds.union(entry.geometry.boundingBox.clone().applyMatrix4(entry.matrix));
  }
  return bounds;
}

export class ObjectView {
  constructor({ terrainView, tileMap, heightField, objectMap, objectCatalog }) {
    this.terrainView = terrainView;
    this.tileMap = tileMap;
    this.heightField = heightField;
    this.objectMap = objectMap;
    this.objectCatalog = objectCatalog;
    this.disposed = false;
    this.definitionByKey = new Map(objectCatalog.map((definition) => [definition.key, definition]));
    this.placementResolver = new ObjectPlacementResolver({
      objectMap,
      definitionByKey: this.definitionByKey,
      heightField,
      tileSize: tileMap.tileSize,
      floatingOrigin: terrainView.floatingOrigin,
    });
    this.root = new THREE.Group();
    this.root.name = 'placed-objects';
    terrainView.scene.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderers = new Map();
    this.pickMeshes = [];
    this.selectedObjectId = null;
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
    hemisphere.userData.fallbackLighting = true;
    sun.userData.fallbackLighting = true;
    this.fallbackLights = [hemisphere, sun];
    terrainView.scene.add(hemisphere, sun);

    for (const definition of objectCatalog) {
      const parts = createObjectModelParts(definition, tileMap.tileSize);
      this.definitionByKey.set(definition.key, definition);
      this.renderers.set(definition.key, this.createRendererRecord(definition, parts));
    }

    this.refreshAll();
  }

  createRendererRecord(definition, parts, lodParts = null) {
    const hasFoundation = definition.foundation.mode === 'terrace';
    const hasLod = Boolean(lodParts?.coarse?.length && lodParts?.shell?.length);
    const bounds = modelBounds(parts);
    return {
      definition,
      parts,
      lodSources: hasLod
        ? { near: parts, coarse: lodParts.coarse, shell: lodParts.shell }
        : null,
      lodMeshes: hasLod ? { near: [], coarse: [], shell: [] } : null,
      lodTriangles: hasLod
        ? {
          near: bandTriangles(parts),
          coarse: bandTriangles(lodParts.coarse),
          shell: bandTriangles(lodParts.shell),
        }
        : null,
      lodController: hasLod ? new ObjectLodController(lodParts.config) : null,
      lodShadows: hasLod ? lodParts.shadows : null,
      lodPlacements: [],
      lodSignatures: { near: '', coarse: '', shell: '' },
      worldHeight: bounds.isEmpty() ? 1 : Math.max(0.1, bounds.max.y - bounds.min.y),
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

  registerDefinition(definition, parts, lodParts = null) {
    if (!definition || !Array.isArray(parts) || parts.length === 0) {
      throw new Error('Cannot register an empty procedural object renderer.');
    }
    const previous = this.renderers.get(definition.key);
    if (previous) this.disposeRendererRecord(previous);
    this.definitionByKey.set(definition.key, definition);
    this.renderers.set(definition.key, this.createRendererRecord(definition, parts, lodParts));
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
    return this.placementResolver.resolve(object);
  }

  refreshAll() {
    const startedAt = performance.now();
    const grouped = new Map(Array.from(this.renderers.keys(), (definitionKey) => [definitionKey, []]));
    for (const object of this.objectMap.list()) grouped.get(object.definitionKey)?.push(object);

    this.pickMeshes = [];
    for (const [definitionKey, renderer] of this.renderers.entries()) {
      const objects = grouped.get(definitionKey) ?? [];
      const placements = objects.map((object) => ({ object, placement: this.resolvePlacement(object) }));
      this.ensureCapacity(renderer, objects.length);
      const objectIds = objects.map((object) => object.id);

      if (renderer.lodSources) {
        renderer.lodController.clear();
        renderer.lodPlacements = placements.map(({ object, placement }) => {
          const matrix = this.createObjectMatrix(object, placement.surface);
          return {
            object,
            matrix,
            worldPosition: new THREE.Vector3(
              matrix.elements[12],
              matrix.elements[13] + renderer.worldHeight / 2,
              matrix.elements[14],
            ),
            worldHeight: renderer.worldHeight,
          };
        });
        renderer.lodController.seed(renderer.lodPlacements);
        const nearInstances = renderer.lodPlacements.map(({ object, matrix }) => ({
          matrix,
          fade: 1,
          seed: object.id / 0xffffffff,
          objectId: object.id,
        }));
        writeInstances([renderer.lodMeshes.near], [nearInstances]);
        writeInstances([renderer.lodMeshes.coarse], [[]]);
        writeInstances([renderer.lodMeshes.shell], [[]]);
        renderer.lodSignatures = {
          near: objectIds.map((id) => `${id}:16`).join('|'),
          coarse: '',
          shell: '',
        };
        for (const meshes of Object.values(renderer.lodMeshes)) {
          for (const mesh of meshes) {
            mesh.userData.objectIds = meshes === renderer.lodMeshes.near ? objectIds : [];
            this.pickMeshes.push(mesh);
          }
        }
      } else {
        for (const mesh of renderer.meshes) {
          mesh.count = objects.length;
          mesh.userData.objectIds = objectIds;
          this.pickMeshes.push(mesh);
        }

        for (let index = 0; index < placements.length; index += 1) {
          const { object, placement } = placements[index];
          const rootMatrix = this.createObjectMatrix(object, placement.surface);
          for (let partIndex = 0; partIndex < renderer.parts.length; partIndex += 1) {
            const matrix = new THREE.Matrix4().multiplyMatrices(
              rootMatrix,
              renderer.parts[partIndex].matrix,
            );
            renderer.meshes[partIndex].setMatrixAt(index, matrix);
          }
        }

        for (const mesh of renderer.meshes) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere();
        }
      }

      const foundationPlacements = placements.filter(
        ({ placement }) => placement.surface.foundationDepth > FOUNDATION_EPSILON,
      );
      this.refreshFoundations(renderer, foundationPlacements);
    }

    this.updatePerformanceCounters(grouped);
    PerfCounters.inc('objectRefreshes');
    PerfCounters.inc('objectRefreshMs', performance.now() - startedAt);
  }

  updatePerformanceCounters(grouped = null) {
    const countsByDefinition = grouped ?? (() => {
      const counts = new Map(Array.from(this.renderers.keys(), (definitionKey) => [definitionKey, []]));
      for (const object of this.objectMap.list()) counts.get(object.definitionKey)?.push(object);
      return counts;
    })();
    let instances = 0;
    let drawMeshes = 0;
    let triangles = 0;
    let geometryBytesTotal = 0;
    const countedGeometries = new Set();
    for (const renderer of this.renderers.values()) {
      const objectCount = countsByDefinition.get(renderer.definition.key)?.length ?? 0;
      if (objectCount > 0) {
        instances += objectCount;
        drawMeshes += renderer.parts.length;
        triangles += renderer.parts.reduce(
          (total, entry) => total + geometryTriangles(entry.geometry) * objectCount,
          0,
        );
      }
      const sources = renderer.lodSources ? Object.values(renderer.lodSources).flat() : renderer.parts;
      for (const entry of sources) {
        if (countedGeometries.has(entry.geometry)) continue;
        countedGeometries.add(entry.geometry);
        geometryBytesTotal += geometryBytes(entry.geometry);
      }
    }
    PerfCounters.set('objectInstances', instances);
    PerfCounters.set('objectDrawMeshes', drawMeshes);
    PerfCounters.set('objectTriangles', triangles);
    PerfCounters.set('objectGeometryBytes', geometryBytesTotal);
  }

  ensureCapacity(renderer, required) {
    if (required === 0 || renderer.capacity >= Math.max(1, required)) return;
    const capacity = nextCapacity(required);
    if (renderer.lodSources) {
      for (const meshes of Object.values(renderer.lodMeshes)) {
        disposeInstancedRenderers(this.root, [meshes]);
      }
      renderer.lodMeshes = {
        near: createInstancedRenderers({
          root: this.root,
          partsByPrototype: [renderer.lodSources.near],
          capacity,
          name: `${renderer.definition.key}-near`,
          castShadow: renderer.lodShadows.near,
        })[0],
        coarse: createInstancedRenderers({
          root: this.root,
          partsByPrototype: [renderer.lodSources.coarse],
          capacity,
          name: `${renderer.definition.key}-coarse`,
          castShadow: renderer.lodShadows.coarse,
        })[0],
        shell: createInstancedRenderers({
          root: this.root,
          partsByPrototype: [renderer.lodSources.shell],
          capacity,
          name: `${renderer.definition.key}-shell`,
          castShadow: renderer.lodShadows.shell,
        })[0],
      };
      renderer.capacity = capacity;
      return;
    }
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

  update(timestamp, camera) {
    const startedAt = performance.now();
    const viewportHeight = this.terrainView.renderer.domElement.clientHeight
      || this.terrainView.renderer.domElement.height
      || 1;
    const counts = { near: 0, coarse: 0, shell: 0 };
    let transitions = 0;
    let triangles = 0;
    let drawMeshes = 0;
    for (const renderer of this.renderers.values()) {
      if (!renderer.lodController || renderer.lodPlacements.length === 0) continue;
      const plan = renderer.lodController.plan({
        placements: renderer.lodPlacements,
        camera,
        viewportHeight,
        timestamp,
        selectedObjectId: this.selectedObjectId,
      });
      transitions += plan.transitions;
      for (const band of ['near', 'coarse', 'shell']) {
        const instances = plan.buckets[band];
        counts[band] += instances.length;
        if (instances.length > 0) {
          drawMeshes += renderer.lodSources[band].length;
          triangles += renderer.lodTriangles[band] * instances.length;
        }
        if (renderer.lodSignatures[band] === plan.signatures[band]) continue;
        writeInstances([renderer.lodMeshes[band]], [instances]);
        const objectIds = instances.map(({ objectId }) => objectId);
        for (const mesh of renderer.lodMeshes[band]) mesh.userData.objectIds = objectIds;
        renderer.lodSignatures[band] = plan.signatures[band];
        PerfCounters.inc('objectLodBucketRewrites');
      }
    }
    PerfCounters.set('objectLodNear', counts.near);
    PerfCounters.set('objectLodCoarse', counts.coarse);
    PerfCounters.set('objectLodShell', counts.shell);
    PerfCounters.set('objectLodTransitions', transitions);
    if (counts.near + counts.coarse + counts.shell > 0) {
      PerfCounters.set('objectTriangles', triangles);
      PerfCounters.set('objectDrawMeshes', drawMeshes);
    }
    PerfCounters.inc('objectLodSelectionMs', performance.now() - startedAt);
  }

  ensureFoundationCapacity(renderer, required) {
    if (!renderer.foundationGeometry || required === 0) return;
    if (renderer.foundationMesh && renderer.foundationCapacity >= required) return;
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
    if (!renderer.foundationMesh) return;
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
    if (placements.length > 0) this.pickMeshes.push(renderer.foundationMesh);
  }

  createObjectMatrix(object, surfaceOverride = null) {
    return this.placementResolver.createObjectMatrix(object, surfaceOverride);
  }

  createFoundationMatrix(bounds, surface) {
    return this.placementResolver.createFoundationMatrix(bounds, surface);
  }

  pickObject(clientX, clientY, camera) {
    const bounds = this.terrainView.renderer.domElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);
    const hit = this.raycaster.intersectObjects(this.pickMeshes, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
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
        bounds: this.objectMap.getBounds(
          preview.x,
          preview.z,
          preview.definitionKey,
          preview.rotation,
        ),
        surface: preview.surface,
      }
      : this.resolvePlacement(object);
    const matrix = this.createObjectMatrix(object, placement.surface);
    matrix.decompose(this.previewGroup.position, this.previewGroup.quaternion, this.previewGroup.scale);
    const color = preview.valid ? PREVIEW_VALID_COLOR : PREVIEW_INVALID_COLOR;
    for (const mesh of this.previewGroup.children) mesh.material.color.set(color);
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
    for (const child of this.previewGroup.children) child.material.dispose();
    this.previewGroup.clear();
    const renderer = this.renderers.get(definitionKey);
    if (!renderer) throw new Error(`Unknown object definition: ${definitionKey}.`);
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
    this.selectedObjectId = objectId ? Number(objectId) : null;
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
    const center = this.placementResolver.renderCenter(bounds);
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
    if (this.disposed) return;
    this.disposed = true;
    this.placementResolver.dispose();
    for (const renderer of this.renderers.values()) this.disposeRendererRecord(renderer);
    for (const child of this.previewGroup.children) child.material.dispose();
    this.previewGroup.clear();
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
      ...this.fallbackLights,
    );
    this.renderers.clear();
    this.pickMeshes = [];
    this.fallbackLights = [];
  }

  disposeRendererRecord(renderer) {
    for (const mesh of renderer.meshes) {
      this.root.remove(mesh);
      mesh.dispose?.();
    }
    if (renderer.lodMeshes) {
      for (const meshes of Object.values(renderer.lodMeshes)) {
        disposeInstancedRenderers(this.root, [meshes]);
      }
    }
    if (renderer.foundationMesh) {
      this.root.remove(renderer.foundationMesh);
      renderer.foundationMesh.dispose?.();
    }
    renderer.foundationGeometry?.dispose();
    renderer.foundationMaterial?.dispose();
    const sourceParts = renderer.lodSources
      ? Object.values(renderer.lodSources).flat()
      : renderer.parts;
    disposeModelParts(sourceParts);
  }
}
