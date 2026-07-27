import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { evaluateAquaticPlacement } from '../water/AquaticPlacement.js';
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
    this.prototypeWaterRules = [];
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
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
        const placementRule = definition.prototypePlacements?.[groupIndex]
          ?? definition.placement
          ?? null;
        this.prototypePlacementRules.push(placementRule);
        this.prototypeWaterRules.push(
          definition.prototypeWater?.[groupIndex]
            ?? definition.water
            ?? (placementRule?.strategy === 'shoreline-colonies'
              ? this.layerConfig.surfaceWater
              : null),
        );
        this.prototypeBiomeRules.push({
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
      JSON.stringify(this.layerConfig.water ?? null),
      JSON.stringify(this.layerConfig.surfaceWater ?? null),
      JSON.stringify(this.prototypeBiomeRules),
      JSON.stringify(this.prototypePlacementRules),
      JSON.stringify(this.prototypeWaterRules),
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

        let metadata = null;
        if (this.layerName === 'aquaticPlant') {
          const waterSample = this.terrainView.getCanonicalWater?.(candidate.x, candidate.z);
          metadata = evaluateAquaticPlacement({
            waterSample,
            layerRule: this.layerConfig.water,
            prototypeRule: this.prototypeWaterRules[candidate.prototypeIndex],
          });
          if (!metadata) return null;
        }

        const tileDensity = this.layerConfig.densityByTile?.[candidate.tileId] ?? 1;
        if (tileDensity < 1 && candidate.priority >= tileDensity) return null;
        if (!this.regionalCharacterField) return metadata ?? true;
        const regionalMeadow = this.regionalCharacterField.sampleChannel(
          candidate.x,
          candidate.z,
          'meadow',
        );
        return candidate.priority < regionalMeadow
          ? { ...(metadata ?? {}), regionalMeadow }
          : null;
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
          const placementHeight = Number.isFinite(placement.waterPlacementHeight)
            ? placement.waterPlacementHeight
            : placement.height;
          instances[placement.prototypeIndex].push({
            matrix: new THREE.Matrix4().compose(
              DETAIL_SCRATCH.position.set(
                placement.x,
                placementHeight + (this.prototypeHeightOffsets[placement.prototypeIndex] ?? 0),
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
    this.prototypeWaterRules.length = 0;
    this.prototypeBiomeRules.length = 0;
    this.prototypeIndicesByAsset.clear();
    this.prototypeIndexForRoll = null;
    this.manifestCache.clear();
  }
}
