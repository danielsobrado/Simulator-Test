import * as THREE from 'three';
import { disposeModelParts } from './assets/modelParts.js';
import { createObjectModelParts } from './ObjectModelLibrary.js';
import { ObjectLodController } from './ObjectLodController.js';
import { PerfCounters } from './performance/qa/PerfCounters.js';
import { collectResidentObjects } from './world/residentObjectQueries.js';
import { updateObjectInstances, prepareObjectInstances, publishObjectInstances } from './placement/ObjectInstanceUpdates.js';
import { objectResidencyState, invalidateObjectPlacements } from './placement/ObjectResidencyState.js';
import { cancelObjectCapacity } from './placement/ObjectCapacityPublication.js';
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

export function residentObjectCellBounds(slots, chunkSize) {
  if (!Array.isArray(slots) || slots.length === 0 || !Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    const descriptor = slot?.descriptor;
    if (!descriptor) continue;
    minX = Math.min(minX, descriptor.originCellX);
    minZ = Math.min(minZ, descriptor.originCellZ);
    maxX = Math.max(maxX, descriptor.originCellX + chunkSize - 1);
    maxZ = Math.max(maxZ, descriptor.originCellZ + chunkSize - 1);
  }
  return Number.isFinite(minX) ? { minX, minZ, maxX, maxZ } : null;
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
      getWaterSample: (x, z) => terrainView.getCanonicalWater?.(x, z),
    });
    this.root = new THREE.Group();
    this.root.name = 'placed-objects';
    terrainView.scene.add(this.root);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderers = new Map();
    this.pickMeshes = [];
    this.selectedObjectId = null;
    this.lastResidencyFocusKey = null;
    this.lastResidencyObjectRevision = Number.NaN;
    this.lastResidencySelection = null;
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

    const hasSkyLighting = Boolean(
      terrainView.skyView
      || terrainView.scene.children.some((child) => child.isDirectionalLight || child.isHemisphereLight),
    );
    const hemisphere = new THREE.HemisphereLight('#dce8ff', '#293326', hasSkyLighting ? 0 : 1.45);
    const sun = new THREE.DirectionalLight('#fff1cf', hasSkyLighting ? 0 : 2.1);
    sun.position.set(80, 120, 60);
    hemisphere.userData.fallbackLighting = true;
    sun.userData.fallbackLighting = true;
    this.fallbackLights = [hemisphere, sun];
    terrainView.scene.add(hemisphere, sun);

    for (const definition of objectCatalog) {
      const parts = definition.asset ? [] : createObjectModelParts(definition, tileMap.tileSize);
      this.definitionByKey.set(definition.key, definition);
      this.renderers.set(definition.key, this.createRendererRecord(definition, parts));
    }

    this.dirtyPlacements = new Set();
    this.allPlacementsDirty = true;
    this.pendingObjectUpdates = new Map();
    terrainView.objectView = this;
    this.unsubscribePlacements = terrainView.worldStore?.subscribe?.(change => invalidateObjectPlacements(this, change));
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
        ? (() => {
          const baseColor = new THREE.Color(definition.foundation.color);
          return new THREE.MeshStandardMaterial({
            color: baseColor,
            emissive: baseColor.clone().multiplyScalar(0.18),
            roughness: 0.96,
            metalness: 0,
          });
        })()
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

  clearAssetParts(definitionKey) {
    const previous = this.renderers.get(definitionKey);
    if (!previous?.definition.asset) return;
    this.disposeRendererRecord(previous);
    this.renderers.set(definitionKey, this.createRendererRecord(previous.definition, []));
    if (this.previewDefinitionKey === definitionKey) {
      for (const child of this.previewGroup.children) child.material.dispose();
      this.previewGroup.clear();
      this.previewDefinitionKey = null;
    }
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

  collectResidentObjects() {
    return collectResidentObjects({ slots: this.terrainView.slots,
      chunkSize: this.terrainView.worldStore?.chunkSize, objectMap: this.objectMap,
      selectedObjectId: this.selectedObjectId });
  }

  syncResidency(force = false) {
    const state = objectResidencyState(this);
    if (!force && state.key === this.lastResidencyFocusKey && state.objects === this.lastResidencyObjectRevision
        && this.selectedObjectId === this.lastResidencySelection && !this.allPlacementsDirty && this.dirtyPlacements.size === 0) return false;
    this.refreshAll(this.collectResidentObjects());
    return true;
  }

  refreshAll(objects = null) {
    const startedAt = performance.now();
    const grouped = new Map();
    for (const object of objects ?? this.collectResidentObjects()) {
      if (!grouped.has(object.definitionKey)) grouped.set(object.definitionKey, []);
      grouped.get(object.definitionKey).push(object);
    }
    this.dirtyPlacements ??= new Set();
    if (!this.unsubscribePlacements && this.heightField?.heights) this.allPlacementsDirty = true;
    let updated = false;
    for (const [key, renderer] of this.renderers) {
      if (!grouped.has(key) && !renderer.placementRecords?.size) {
        this.pendingObjectUpdates.delete(key); cancelObjectCapacity(this, renderer); continue;
      }
      const members = grouped.get(key) ?? [];
      if (members.length > 32) {
        const invalidation = { all: this.allPlacementsDirty, dirty: new Set(this.dirtyPlacements),
          origin: this.terrainView.floatingOrigin.getState() };
        this.pendingObjectUpdates.set(key, { renderer, job: prepareObjectInstances(this, renderer, members, invalidation) });
      } else {
        this.pendingObjectUpdates.delete(key);
        updated = updateObjectInstances(this, renderer, members) || updated;
      }
    }
    this.pickMeshes = [...this.renderers.values()].flatMap(renderer => [
      ...(renderer.lodMeshes ? Object.values(renderer.lodMeshes).flat() : renderer.meshes),
      ...(renderer.foundationMesh?.count ? [renderer.foundationMesh] : []),
    ]);
    const state = objectResidencyState(this);
    this.lastResidencyFocusKey = state.key;
    this.lastResidencyObjectRevision = state.objects;
    this.lastResidencySelection = this.selectedObjectId;
    this.allPlacementsDirty = false;
    this.dirtyPlacements.clear();
    if (updated) {
      this.updatePerformanceCounters(grouped);
      PerfCounters.inc('objectRefreshes');
      PerfCounters.inc('objectRefreshMs', performance.now() - startedAt);
    }
  }

  advancePreparation(shouldYield = () => false) {
    for (const [key, entry] of this.pendingObjectUpdates) {
      if (shouldYield()) return;
      for (;;) {
        const step = entry.next ? { done: true, value: entry.next } : entry.job.next();
        if (step.done) {
          if (!step.value) cancelObjectCapacity(this, entry.renderer);
          if (step.value && this.renderers.get(key) === entry.renderer) {
            if (!publishObjectInstances(this, entry.renderer, step.value)) { entry.next = step.value; break; }
            this.pickMeshes = [...this.renderers.values()].flatMap(renderer => [
              ...(renderer.lodMeshes ? Object.values(renderer.lodMeshes).flat() : renderer.meshes),
              ...(renderer.foundationMesh?.count ? [renderer.foundationMesh] : []),
            ]);
            this.updatePerformanceCounters();
          }
          this.pendingObjectUpdates.delete(key);
          break;
        }
        if (shouldYield()) return;
      }
    }
  }

  updatePerformanceCounters(grouped = null) {
    const countsByDefinition = grouped ?? (() => {
      const counts = new Map(Array.from(this.renderers.keys(), (definitionKey) => [definitionKey, []]));
      for (const [key, renderer] of this.renderers) counts.set(key, [...(renderer.placementRecords?.values() ?? [])]);
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
          renderer: this.terrainView.renderer,
          partsByPrototype: [renderer.lodSources.near],
          reuseVertexArrays: true,
          capacity,
          name: `${renderer.definition.key}-near`,
          castShadow: renderer.lodShadows.near,
        })[0],
        coarse: createInstancedRenderers({
          root: this.root,
          renderer: this.terrainView.renderer,
          partsByPrototype: [renderer.lodSources.coarse],
          reuseVertexArrays: true,
          capacity,
          name: `${renderer.definition.key}-coarse`,
          castShadow: renderer.lodShadows.coarse,
        })[0],
        shell: createInstancedRenderers({
          root: this.root,
          renderer: this.terrainView.renderer,
          partsByPrototype: [renderer.lodSources.shell],
          reuseVertexArrays: true,
          capacity,
          name: `${renderer.definition.key}-shell`,
          castShadow: renderer.lodShadows.shell,
        })[0],
      };
      renderer.capacity = capacity;
      for (const meshes of Object.values(renderer.lodMeshes)) {
        for (const mesh of meshes) this.terrainView.drawPreparation?.register(mesh);
      }
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
      this.terrainView.drawPreparation?.register(mesh);
      return mesh;
    });
    renderer.capacity = capacity;
  }

  update(timestamp, camera, budget = null) {
    this.syncResidency();
    if (!budget || !budget.shouldYield()) {
      (budget?.runner ?? (work => work()))(() => this.advancePreparation(budget?.shouldYield));
    }
    const startedAt = performance.now();
    const viewportHeight = this.terrainView.viewportHeight
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
        const rows = renderer.lodSignatures[band] === plan.baseVersions?.[band] ? plan.changedRows[band] : null;
        writeInstances([renderer.lodMeshes[band]], [instances], null, rows ? [rows] : null);
        const objectIds = rows ? renderer.lodMeshes[band][0]?.userData.objectIds ?? [] : [];
        if (rows) for (const index of rows) objectIds[index] = instances[index].objectId;
        else for (const instance of instances) objectIds.push(instance.objectId);
        objectIds.length = instances.length;
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
    this.terrainView.drawPreparation?.register(renderer.foundationMesh);
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
    this.unsubscribePlacements?.();
    this.pendingObjectUpdates.clear();
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
    cancelObjectCapacity(this, renderer);
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
