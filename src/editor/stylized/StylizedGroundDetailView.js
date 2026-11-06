import { applyJungleMist } from './ambient/jungleMistOutput.js';
import { ITERATOR_PENDING } from './ResumableIterator.js';
import { BudgetedDetailVisibility } from './lod/BudgetedDetailVisibility.js';
import { stepViewRebuild } from './StagedViewRebuild.js';
import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { evaluateDetailSurfacePlacement } from './DetailSurfacePlacement.js';
import { CANDIDATE_PENDING } from './StableScatterManifest.js';
import { instanceCapacity } from './scatterMath.js';
import { createStableChunkManifestBuilder } from './StableScatterManifest.js';
import {
  createInstancedRenderers,
  disposeInstancedRenderers,
} from './lod/StylizedLodRuntime.js';
import { InstanceAnchor } from './lod/InstanceAnchor.js';
import { ScatterInstanceRows } from './lod/ScatterInstanceRows.js';
import { extractAuthoredGroupedPrototypes } from './StylizedPrototypeBake.js';
import { acceptsStrategicDetailPlacement } from './StrategicDetailPlacement.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { createBiomePrototypeSelector } from './BiomePrototypeSelector.js';
import { applyPlantMotion } from './PlantMotionNodes.js';
import { applyUnderstoryPalette, cloneAuthoredNodeMaterial } from './AuthoredFoliageMaterial.js';
import { applySkywardNormal } from './forest/foliageLight.js';
import { createOceanDistanceField } from '../water/OceanDistanceField.js';

const DETAIL_UP = new THREE.Vector3(0, 1, 0);
const DETAIL_REPRESENTATIONS = Object.freeze([{ band: 'near', fade: 1, ditherDirection: 1 }]);
const DETAIL_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  yaw: new THREE.Quaternion(),
};

function cloneDetailMaterial(source, { wind = null, height = 0, motion = 'woody-shrub', foliageConfig = null, tileId = null, role = 'auto', ambientEffects = null } = {}) {
  const material = cloneAuthoredNodeMaterial(source, { lit: !!foliageConfig });
  if (foliageConfig) applyUnderstoryPalette(material, foliageConfig, tileId, role);
  // Swayed with the meadow's own wave, so a tuft is not a rigid patch in a moving
  // sward (groundDetailWind.js).
  applyPlantMotion(material, { wind, height, profile: motion });
  if (foliageConfig) applySkywardNormal(material);
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
  applyJungleMist(material, ambientEffects);
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
    paletteLayerId = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.layerConfig = layerConfig;
    this.layerName = layerName;
    this.paletteLayerId = paletteLayerId
      ?? (layerName === 'aquaticPlant' ? 'aquaticPlants' : 'groundDetails');
    this.priorityChannel = priorityChannel;
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.forestFieldProvider = forestFieldProvider;
    this.prototypeIndicesByAsset = new Map();
    this.prototypes = [];
    this.prototypeHeightOffsets = [];
    // Lying deadwood (`conform: true`) tilts to the slope under it, or one end floats.
    this.prototypeConform = [];
    this.prototypePlacementRules = [];
    this.prototypeWaterRules = [];
    this.prototypeStrandRules = [];
    this.prototypeShoreRules = [];
    this.oceanDistance = layerName === 'shoreLife'
      ? createOceanDistanceField(terrainView, layerConfig.coastalReachMeters ?? 48) : null;
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
    this.prototypeRevision = 0;
    this.meshes = [];
    this.manifestCache = new Map();
    this.pendingManifests = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    // Instances are written relative to this, not in canonical metres (InstanceAnchor).
    this.instanceAnchor = new InstanceAnchor();
    this.instanceRows = new ScatterInstanceRows(layerName,
      placement => this.placementMatrix(placement), placement => this.placementAppearance(placement));
    this.root.name = `stylized-${layerName}`;
    this.visibility = config.enhancements?.detailVisibility && layerConfig.castShadow !== true
      && ['groundDetail', 'tropicalPlant'].includes(layerName) ? new BudgetedDetailVisibility(this) : null;
    terrainView.scene.add(this.root);
  }

  placementMatrix(placement) {
    const index = placement.prototypeIndex;
    const height = Number.isFinite(placement.waterPlacementHeight)
      ? placement.waterPlacementHeight : placement.height;
    const groundNormal = placement.groundNormal
      ?? (this.prototypeConform[index] ? this.slopeNormal(placement.x, placement.z) : null);
    return new THREE.Matrix4().compose(
      DETAIL_SCRATCH.position.set(placement.x, height + (this.prototypeHeightOffsets[index] ?? 0), placement.z),
      groundNormal
        ? DETAIL_SCRATCH.quaternion.setFromUnitVectors(DETAIL_UP,
          DETAIL_SCRATCH.normal.fromArray(groundNormal)).multiply(
          DETAIL_SCRATCH.yaw.setFromAxisAngle(DETAIL_UP, placement.rotationY))
        : DETAIL_SCRATCH.quaternion.setFromAxisAngle(DETAIL_UP, placement.rotationY),
      DETAIL_SCRATCH.scale.setScalar(placement.scale),
    );
  }

  /** Terrain normal from central differences one metre apart. */
  slopeNormal(x, z) {
    const h = (px, pz) => this.terrainView.getCanonicalHeight(px, pz);
    const nx = h(x - 0.5, z) - h(x + 0.5, z);
    const nz = h(x, z - 0.5) - h(x, z + 0.5);
    const length = Math.hypot(nx, 1, nz);
    return [nx / length, 1 / length, nz / length];
  }

  placementAppearance(placement) {
    const range = Math.max(0, Number(this.layerConfig.colorVariation) || 0);
    return {
      seed: placement.priority,
      colorVariation: 1 - range * 0.5 + placement.priority * range,
      surfaceData: placement.surfaceData,
    };
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
        this.prototypeConform.push(definition.conform === true);
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
        this.prototypeStrandRules.push(null);
        this.prototypeShoreRules.push(null);
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
          geometry.computeBoundingBox();
          return {
            geometry,
            material: cloneDetailMaterial(sourceMaterial, {
              // Water plants keep their own current-driven sway, not the air's;
              // stones (`sway: false`) keep still.
              wind: this.layerName === 'aquaticPlant' || definition.sway === false
                ? null
                : (this.config.wind ?? null),
              height: geometry.boundingBox.max.y - Math.min(0, geometry.boundingBox.min.y),
              motion: definition.motion,
              role: definition.materialRoles?.[sourceMaterial.name],
              foliageConfig: ['groundDetail', 'tropicalPlant'].includes(this.layerName)
                ? this.config : null,
              // `paletteTileId` grades a shrub with another biome's foliage palette
              // without growing it there: desert sagebrush wore the lime meadow green.
              tileId: definition.paletteTileId ?? definition.tileIds?.[0],
              ambientEffects: this.config.ambientEffects,
            }),
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
      renderer: this.terrainView.renderer,
      capacity,
      name: `stylized-${this.layerName}-${firstNewPrototype}`,
      castShadow: this.layerConfig.castShadow === true,
    }));
    this.prototypeRevision += 1;
  }

  /**
   * Adds prototypes that are built in code rather than extracted from a GLB.
   *
   * The donor's shore life — starfish, strand debris, creeping leaves, sea grass —
   * is geometry it generates, and that is worth keeping: it costs no asset, no
   * atlas and no load, so a whole layer can be installed synchronously at boot
   * instead of streaming in through residency. Everything downstream is the same
   * machinery the authored prototypes use: the same deterministic per-chunk
   * manifest, the same spacing and biome rules, the same instanced renderers, and
   * the same rebuild path.
   *
   * A definition is: `{ id, parts, heightOffset, placement, strand, tileIds,
   * weight, character, characterStrength, canopy }`, where `parts` is a list of
   * `{ geometry, material, kind }` exactly as `appendVariants` produces. `strand`
   * is a band relative to sea level (see `strandPlacement.js`) and is what makes a
   * layer of these live on a shore rather than everywhere.
   */
  appendProceduralPrototypes(definitions = []) {
    if (!this.layerConfig?.enabled || this.disposed || definitions.length === 0) return;
    const firstNewPrototype = this.prototypes.length;
    for (const definition of definitions) {
      if (!Array.isArray(definition.parts) || definition.parts.length === 0) {
        throw new Error(`${this.layerName} prototype ${definition.id ?? '?'} has no parts.`);
      }
      this.prototypeHeightOffsets.push(
        definition.heightOffset ?? this.layerConfig.heightOffset ?? 0,
      );
      this.prototypeConform.push(definition.conform === true);
      this.prototypePlacementRules.push(definition.placement ?? null);
      this.prototypeWaterRules.push(definition.water ?? null);
      this.prototypeStrandRules.push(
        definition.strand ?? this.layerConfig.strand ?? null,
      );
      this.prototypeShoreRules.push(definition.shoreHabitat ?? null);
      this.prototypeBiomeRules.push({
        tileIds: definition.tileIds ?? null,
        weight: definition.weight ?? 1,
        character: definition.character ?? null,
        characterStrength: definition.characterStrength,
        canopy: definition.canopy,
      });
      this.prototypes.push(definition.parts.map((part) => ({
        geometry: part.geometry,
        material: part.material,
        kind: part.kind ?? 'detail',
        instanceSurface: part.instanceSurface,
      })));
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id,
        this.prototypes.length - 1,
        1,
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
      renderer: this.terrainView.renderer,
      capacity,
      name: `stylized-${this.layerName}-${firstNewPrototype}`,
      castShadow: this.layerConfig.castShadow === true,
    }));
    this.prototypeRevision += 1;
  }

  manifestForChunk(chunkX, chunkZ, shouldYield = null) {
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
      JSON.stringify(this.prototypeStrandRules),
      JSON.stringify(this.prototypeShoreRules),
      this.regionalCharacterField?.signature ?? 'uniform-regions',
      forestField?.signature ?? 'uniform-forest',
      this.biomeAssetPalette?.revision ?? 0,
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) return cached.placements;
    const options = {
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
      candidateEvaluator: (candidate, shouldYield) => {
        if (!acceptsStrategicDetailPlacement(
          candidate,
          this.prototypePlacementRules[candidate.prototypeIndex],
          {
            tileSize: this.terrainView.worldStore.tileSize,
            tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
          },
        )) return null;

        // A layer of woodland floor lives under canopy, thinning out with it.
        if (this.layerConfig.canopyGate
          && candidate.priority >= (forestField?.sample(candidate.x, candidate.z).patchCoverage ?? 0)) return null;

        const metadata = evaluateDetailSurfacePlacement(this, candidate, options.heightAt, shouldYield);
        if (!metadata) return null;
        if (metadata === CANDIDATE_PENDING) return metadata;

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
    };
    const prepared = this.terrainView.preparedPlacement;
    if (prepared && !prepared.ensureChunk(chunkX, chunkZ, 2, 1)) return null;
    let state = this.pendingManifests.get(cacheKey);
    if (state?.key !== key) {
      state = { key, builder: createStableChunkManifestBuilder(options) };
      this.pendingManifests.set(cacheKey, state);
    }
    const placements = state.builder.step({ shouldYield });
    if (placements === null) return null;
    this.pendingManifests.delete(cacheKey);
    this.manifestCache.set(cacheKey, { key, placements });
    return placements;
  }

  update() {
    if (this.disposed || this.prototypes.length === 0 || !this.terrainView.focusChunkKey) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.place(this.root, origin);
    const radius = this.layerConfig.residentRadius;
    const revisionSignature = this.revisionTracker.windowSignature(focus, radius + 1, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${
      this.biomeAssetPalette?.revision ?? 0
    }:p${this.prototypeRevision}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    if (this.pendingRebuild?.updateKey === updateKey) return;
    this.pendingRebuild = {
      key: `${this.layerName}:${updateKey}`,
      updateKey,
      focus: { ...focus },
    };
  }

  applyPendingRebuild(shouldYield = null) {
    return stepViewRebuild(this, this.pendingRebuild, shouldYield,
      job => this.iterateRebuild(job.focus));
  }

  *iterateRebuild(focus) {
    PerfCounters.inc(`${this.layerName}Rebuilds`);
    const job = this.instanceRows.begin();
    const activeChunks = new Set();
    const radius = this.layerConfig.residentRadius;
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        activeChunks.add(key);
        let manifest = null;
        while (manifest === null) {
          manifest = this.manifestForChunk(chunkX, chunkZ, this.currentShouldYield);
          if (manifest === null) yield ITERATOR_PENDING;
        }
        yield* this.instanceRows.stageChunk(job, key, manifest, DETAIL_REPRESENTATIONS);
      }
    }
    yield* this.instanceRows.stageRetired(job);
    yield;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.follow(origin);
    const rebased = this.instanceAnchor.x !== this.instanceRows.anchorX
      || this.instanceAnchor.z !== this.instanceRows.anchorZ;
    const changed = job.changes.some(changes => changes?.size > 0);
    if (!this.visibility || changed || rebased || job.manifestsChanged) {
      const { near: count } = this.instanceRows.commit(job, this.meshes, [], this.instanceAnchor,
        Boolean(this.visibility));
      if (this.visibility) {
        this.visibility.reset(this.instanceRows.storage.map(storage => storage.buckets.near));
      }
      PerfCounters.set(`${this.layerName}Instances`, count);
    } else {
      this.instanceRows.chunks = job.chunks;
    }
    this.instanceAnchor.place(this.root, origin);
    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key)) this.manifestCache.delete(key);
    }
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.visibility?.dispose();
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
    this.prototypeConform.length = 0;
    this.prototypePlacementRules.length = 0;
    this.prototypeWaterRules.length = 0;
    this.prototypeStrandRules.length = 0;
    this.prototypeShoreRules.length = 0;
    this.oceanDistance?.cache.clear();
    this.prototypeBiomeRules.length = 0;
    this.prototypeIndicesByAsset.clear();
    this.prototypeIndexForRoll = null;
    this.manifestCache.clear();
  }
}
