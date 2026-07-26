import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { instanceCapacity } from './scatterMath.js';
import { buildStableChunkManifest } from './StableScatterManifest.js';
import {
  createInstancedRenderers,
  disposeInstancedRenderers,
  writeInstances,
} from './lod/StylizedLodRuntime.js';
import { extractAuthoredGroupedPrototypes } from './StylizedPrototypeBake.js';
import { acceptsStrategicDetailPlacement } from './StrategicDetailPlacement.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { createBiomePrototypeSelector } from './BiomePrototypeSelector.js';

const DETAIL_UP = new THREE.Vector3(0, 1, 0);
const DETAIL_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

function cloneDetailMaterial(source) {
  const material = source.clone();
  if ('roughness' in material) material.roughness = Math.max(0.72, material.roughness ?? 1);
  if ('metalness' in material) material.metalness = 0;
  if (material.map?.colorSpace !== undefined) {
    material.map.colorSpace = THREE.SRGBColorSpace;
  }
  if (material.map || material.alphaMap || material.transparent) {
    material.alphaTest = Math.max(0.32, material.alphaTest ?? 0);
    material.transparent = false;
    material.depthWrite = true;
    material.side = THREE.DoubleSide;
  }
  material.needsUpdate = true;
  return material;
}

/**
 * Sparse authored accents over the procedural grass carpet and below water.
 *
 * Dense grass remains the purpose-built shared blade buffer. This layer is for
 * recognisable clover, weed, flower and reed silhouettes whose texture/material
 * parts matter at walking distance. Pack grouping, biome eligibility and scale
 * live entirely in configuration so another GLB can join without view changes.
 */
export class StylizedGroundDetailView {
  constructor({
    terrainView,
    config,
    revisionTracker,
    layerConfig,
    layerName,
    priorityChannel,
    biomeAssetPalette = null,
    regionalCharacterField = null,
    forestFieldProvider = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.layerConfig = layerConfig;
    this.layerName = layerName;
    this.paletteLayerId = layerName === 'aquaticPlant'
      ? 'aquaticPlants'
      : 'groundDetails';
    this.priorityChannel = priorityChannel;
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.forestFieldProvider = forestFieldProvider;
    this.prototypeIndicesByAsset = new Map();
    this.prototypes = [];
    this.prototypeHeightOffsets = [];
    this.prototypePlacementRules = [];
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
    // Bumped by every `appendVariants`. The resident-window key below is
    // otherwise blind to the prototype set, so a variant that streams in while
    // the camera stands still would not schedule the rebuild that shows it.
    this.prototypeRevision = 0;
    this.meshes = [];
    this.manifestCache = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    this.root.name = `stylized-${layerName}`;
    terrainView.scene.add(this.root);
  }

  /**
   * Install more authored variants alongside whatever is already resident.
   *
   * Variants stream in as the camera approaches the biomes they belong to, so
   * this is additive: prototypes keep the indices they were registered under and
   * only the new ones get renderers. Rebuilding the layer from scratch instead
   * would re-extract every geometry already on screen and drop its instances for
   * a frame.
   */
  appendVariants(authoredVariants = []) {
    if (!this.layerConfig?.enabled || this.disposed || authoredVariants.length === 0) return;
    const firstNewPrototype = this.prototypes.length;
    for (const { scene, definition } of authoredVariants) {
      const firstIndex = this.prototypes.length;
      const extracted = extractAuthoredGroupedPrototypes(scene, {
        scale: definition.scale,
        groups: definition.prototypeGroups,
        label: `${this.layerName} variant ${definition.scene}`,
      });
      extracted.forEach((parts, groupIndex) => {
        this.prototypeHeightOffsets.push(
          definition.prototypeHeightOffsets?.[groupIndex]
            ?? definition.heightOffset
            ?? this.layerConfig.heightOffset
            ?? 0,
        );
        this.prototypePlacementRules.push(
          definition.prototypePlacements?.[groupIndex] ?? definition.placement ?? null,
        );
        this.prototypeBiomeRules.push({
          // A variant with no `tileIds` stays eligible everywhere the layer is,
          // which is the pre-existing behaviour.
          tileIds: definition.tileIds ?? null,
          weight: definition.prototypeWeights?.[groupIndex] ?? definition.weight ?? 1,
          character: definition.character ?? null,
          characterStrength: definition.characterStrength,
          canopy: definition.canopy,
        });
        this.prototypes.push(parts.map(({ geometry, source }) => {
          const sourceMaterial = materialList(source)[0];
          if (!sourceMaterial) {
            geometry.dispose();
            throw new Error(`${this.layerName} prototype contains a mesh without a material.`);
          }
          return {
            geometry,
            material: cloneDetailMaterial(sourceMaterial),
            kind: 'detail',
          };
        }));
      });
      if (extracted.length === 0) {
        throw new Error(`${this.layerName} variant ${definition.scene} produced no prototypes.`);
      }
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id ?? definition.scene,
        firstIndex,
        extracted.length,
      );
    }
    this.prototypeIndexForRoll = createBiomePrototypeSelector({
      rules: this.prototypeBiomeRules,
      regionalCharacterField: this.regionalCharacterField,
    });
    const capacity = instanceCapacity({
      residentRadius: this.layerConfig.residentRadius,
      perChunk: this.layerConfig.perChunk,
    });
    this.meshes.push(...createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.prototypes.slice(firstNewPrototype),
      capacity,
      // Offset keeps mesh names unique: `createInstancedRenderers` numbers from
      // zero and each append starts a fresh batch.
      name: `stylized-${this.layerName}-${firstNewPrototype}`,
      castShadow: this.layerConfig.castShadow === true,
    }));
    this.prototypeRevision += 1;
  }

  manifestForChunk(chunkX, chunkZ) {
    const forestField = this.forestFieldProvider?.();
    const key = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.layerConfig.perChunk,
      this.layerConfig.tileIds.join(','),
      JSON.stringify(this.layerConfig.densityByTile ?? null),
      JSON.stringify(this.prototypeBiomeRules),
      JSON.stringify(this.prototypePlacementRules),
      this.regionalCharacterField?.signature ?? 'uniform-regions',
      forestField?.signature ?? 'uniform-forest',
      this.biomeAssetPalette?.revision ?? 0,
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) return cached.placements;
    const placements = buildStableChunkManifest({
      kind: this.layerName,
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize: this.terrainView.worldStore.tileSize,
      perChunk: this.layerConfig.perChunk,
      tileIds: this.layerConfig.tileIds,
      tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      prototypeCount: this.prototypes.length,
      prototypeIndexForRoll: (roll, tileId, x, z) => {
        const automaticIndex = this.prototypeIndexForRoll(
          roll,
          tileId,
          x,
          z,
          this.prototypeIndexForRoll.usesCanopy ? forestField?.sample(x, z) ?? null : null,
        );
        return this.biomeAssetPalette?.resolvePrototypeIndex({
          tileId,
          layerId: this.paletteLayerId,
          automaticIndex,
          prototypeIndicesByAsset: this.prototypeIndicesByAsset,
          roll,
        }) ?? automaticIndex;
      },
      minScale: this.layerConfig.minScale,
      maxScale: this.layerConfig.maxScale,
      radiusForScale: (scale) => this.layerConfig.radius * scale,
      priorityChannel: this.priorityChannel,
      candidateEvaluator: (candidate) => {
        if (!acceptsStrategicDetailPlacement(
          candidate,
          this.prototypePlacementRules[candidate.prototypeIndex],
          {
            tileSize: this.terrainView.worldStore.tileSize,
            tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
          },
        )) return null;
        // Which plants grow in a biome is `tileIds`; how much of anything grows
        // there is this. A desert and a tundra are on the layer so they get the
        // right sparse silhouettes, not so they get a meadow's worth of them.
        const tileDensity = this.layerConfig.densityByTile?.[candidate.tileId] ?? 1;
        if (tileDensity < 1 && candidate.priority >= tileDensity) return null;
        if (!this.regionalCharacterField) return true;
        const regionalMeadow = this.regionalCharacterField.sampleChannel(
          candidate.x,
          candidate.z,
          'meadow',
        );
        return candidate.priority < regionalMeadow ? { regionalMeadow } : null;
      },
    });
    this.manifestCache.set(cacheKey, { key, placements });
    return placements;
  }

  update() {
    if (this.disposed || this.prototypes.length === 0 || !this.terrainView.focusChunkKey) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.root.position.set(-origin.x, 0, -origin.z);
    const radius = this.layerConfig.residentRadius;
    const revisionSignature = this.revisionTracker.windowSignature(focus, radius + 1, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${
      this.biomeAssetPalette?.revision ?? 0
    }:p${this.prototypeRevision}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    this.pendingRebuild = {
      key: `${this.layerName}:${updateKey}`,
      updateKey,
      focus,
    };
  }

  applyPendingRebuild() {
    const job = this.pendingRebuild;
    if (!job) return false;
    this.pendingRebuild = null;
    this.lastUpdateKey = job.updateKey;
    this.rebuild(job.focus);
    return true;
  }

  rebuild(focus) {
    PerfCounters.inc(`${this.layerName}Rebuilds`);
    const instances = this.prototypes.map(() => []);
    const activeChunks = new Set();
    const radius = this.layerConfig.residentRadius;
    const colorVariation = Math.max(0, Number(this.layerConfig.colorVariation) || 0);
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        activeChunks.add(key);
        for (const placement of this.manifestForChunk(chunkX, chunkZ)) {
          instances[placement.prototypeIndex].push({
            matrix: new THREE.Matrix4().compose(
              DETAIL_SCRATCH.position.set(
                placement.x,
                placement.height
                  + (this.prototypeHeightOffsets[placement.prototypeIndex] ?? 0),
                placement.z,
              ),
              DETAIL_SCRATCH.quaternion.setFromAxisAngle(DETAIL_UP, placement.rotationY),
              DETAIL_SCRATCH.scale.setScalar(placement.scale),
            ),
            fade: 1,
            seed: placement.priority,
            colorVariation: 1 - colorVariation * 0.5 + placement.priority * colorVariation,
          });
        }
      }
    }
    const count = writeInstances(this.meshes, instances);
    PerfCounters.set(`${this.layerName}Instances`, count);
    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key)) this.manifestCache.delete(key);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.meshes);
    for (const parts of this.prototypes) {
      for (const part of parts) {
        part.geometry?.dispose();
        part.material?.dispose();
      }
    }
    this.prototypes.length = 0;
    this.prototypeHeightOffsets.length = 0;
    this.prototypePlacementRules.length = 0;
    this.prototypeBiomeRules.length = 0;
    this.prototypeIndicesByAsset.clear();
    this.prototypeIndexForRoll = null;
    this.manifestCache.clear();
  }
}
