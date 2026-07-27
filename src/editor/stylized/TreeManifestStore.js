import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { cellCenterToWorld } from '../world/WorldCoordinates.js';
import { StylizedBuildQueue } from './StylizedBuildQueue.js';
import {
  blockersForChunk,
  buildStableChunkManifest,
  placementSignature,
} from './StableScatterManifest.js';
import {
  ForestHabitatField,
  createForestPlacementEvaluator,
} from './forest/ForestHabitatField.js';
import {
  resolveForestCandidateBudget,
  resolveForestSeed,
} from './forest/ForestRuntimeConfig.js';
import { aggregateCanopyClusters } from './lod/canopyCluster.js';
import { ForestSpeciesRegistry } from './forest/ForestSpeciesRegistry.js';
import { ForestEditStore } from './forest/ForestEditStore.js';
import { PathClearanceField } from './forest/PathClearanceField.js';

export function createPathClearanceField(terrainView, config) {
  return new PathClearanceField({
    tileAt: (cellX, cellZ) => terrainView.tileMap.get(cellX, cellZ),
    tileSize: terrainView.worldStore.tileSize,
    chunkSize: terrainView.worldStore.chunkSize,
    roadTileId: config.path?.tileId ?? 13,
    clearCells: config.path?.clearCells ?? 0,
    naturalTrail: config.path?.naturalTrail,
    revisionProvider: () => terrainView.worldStore.revision,
  });
}

function createForestField(terrainView, config, regionalCharacterField = null) {
  const habitat = config.trees.habitat ?? {};
  if (habitat.enabled === false) return null;
  return new ForestHabitatField({
    seed: resolveForestSeed(terrainView.worldStore),
    tileSize: terrainView.worldStore.tileSize,
    tileAt: (cellX, cellZ) => terrainView.tileMap.get(cellX, cellZ),
    heightAt: (x, z) => terrainView.getCanonicalHeight(x, z),
    waterDistanceAt: typeof terrainView.getCanonicalWaterDistance === 'function'
      ? (x, z) => terrainView.getCanonicalWaterDistance(x, z)
      : null,
    revisionProvider: () => terrainView.worldStore.revision,
    regionalCharacterField,
    config: habitat,
  });
}

function percentile90(values) {
  if (values.length === 0) return 1;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.floor(values.length * 0.9))];
}

export class TreeManifestStore {
  constructor({
    terrainView,
    config,
    revisionTracker,
    prototypeCount,
    prototypeIndexBySpecies = null,
    prototypeTileIds = null,
    objectMap = null,
    regionalCharacterField = null,
    onBuilt,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.prototypeCount = prototypeCount;
    this.objectMap = objectMap;
    this.onBuilt = onBuilt;
    this.forestField = createForestField(terrainView, config, regionalCharacterField);
    this.speciesRegistry = new ForestSpeciesRegistry({
      species: config.trees.species,
      palettes: config.trees.speciesPalettes,
      prototypeCount,
      prototypeIndexBySpecies,
      prototypeTileIds,
      groveMix: config.trees.groveMix,
    });
    this.pathClearance = createPathClearanceField(terrainView, config);
    this.editStore = new ForestEditStore(terrainView.worldStore.forestEdits);
    this.editDocumentRef = terrainView.worldStore.forestEdits ?? null;
    this.cache = new Map();
    this.contextCache = new Map();
    this.pendingKeys = new Set();
    this.activeKeys = new Set();
    this.queue = new StylizedBuildQueue({
      buildsPerFrame: config.streaming?.treeManifestBuildsPerFrame ?? 4,
      budgetMs: config.streaming?.manifestBuildBudgetMs ?? 3,
    });
  }

  constructionQueryBounds(chunkX, chunkZ, clearRadius) {
    const chunkSize = this.terrainView.worldStore.chunkSize;
    const tileSize = this.terrainView.worldStore.tileSize;
    const haloCells = Math.ceil(clearRadius / tileSize) + 2;
    return {
      minX: chunkX * chunkSize - haloCells,
      maxX: (chunkX + 1) * chunkSize - 1 + haloCells,
      minZ: chunkZ * chunkSize - haloCells,
      maxZ: (chunkZ + 1) * chunkSize - 1 + haloCells,
    };
  }

  constructionBlockers(bounds) {
    const objects = this.objectMap?.queryBounds
      ? this.objectMap.queryBounds(bounds)
      : this.objectMap?.list?.() ?? [];
    const tileSize = this.terrainView.worldStore.tileSize;
    return objects.map((object) => {
      const footprint = this.objectMap.getBounds(
        object.x,
        object.z,
        object.definitionKey,
        object.rotation,
      );
      const minimum = cellCenterToWorld(footprint.minX, footprint.minZ, tileSize);
      const maximum = cellCenterToWorld(footprint.maxX, footprint.maxZ, tileSize);
      const halfWidth = footprint.width * tileSize * 0.5;
      const halfDepth = footprint.depth * tileSize * 0.5;
      return {
        stableId: `construction:${object.id}`,
        x: (minimum.x + maximum.x) * 0.5,
        z: (minimum.z + maximum.z) * 0.5,
        radius: Math.hypot(halfWidth, halfDepth),
      };
    });
  }

  context(chunkX, chunkZ, rockSource) {
    const editDocument = this.terrainView.worldStore.forestEdits ?? null;
    if (editDocument !== this.editDocumentRef) {
      this.editStore.loadDocument(editDocument);
      this.editDocumentRef = editDocument;
      this.contextCache.clear();
    }
    const clearRadius = this.config.trees.clearRadius ?? this.terrainView.worldStore.tileSize;
    const rocks = Array.isArray(rockSource)
      ? rockSource
      : rockSource?.getBlockersForChunk?.(chunkX, chunkZ, 1) ?? [];
    const constructionBounds = this.constructionQueryBounds(chunkX, chunkZ, clearRadius);
    const constructionRevision = this.objectMap?.signatureForBounds?.(constructionBounds)
      ?? this.objectMap?.revision
      ?? 0;
    const key = `${chunkX}:${chunkZ}`;
    const inputSignature = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      placementSignature(rocks),
      constructionRevision,
      this.prototypeCount,
      this.forestField?.signature ?? 'uniform',
      this.speciesRegistry.signature,
      this.pathClearance.signature,
      this.editStore.revision,
    ].join('|');
    const cached = this.contextCache.get(key);
    if (cached?.inputSignature === inputSignature) return cached.context;

    const construction = this.constructionBlockers(constructionBounds);
    const blockers = blockersForChunk({
      placements: [...rocks, ...construction],
      chunkX,
      chunkZ,
      chunkWorldSize: this.terrainView.chunkWorldSize,
      expand: clearRadius,
    });
    const context = Object.freeze({
      clearRadius,
      blockers,
      signature: `${inputSignature}|${placementSignature(blockers)}`,
    });
    this.contextCache.set(key, { inputSignature, context });
    return context;
  }

  get(chunkX, chunkZ, rockSource) {
    const key = `${chunkX}:${chunkZ}`;
    const cached = this.cache.get(key);
    if (!cached) return null;
    return cached.signature === this.context(chunkX, chunkZ, rockSource).signature
      ? cached.placements
      : null;
  }

  lodAnchor(chunkX, chunkZ) {
    const entry = this.cache.get(`${chunkX}:${chunkZ}`);
    if (!entry) return null;
    if (entry.anchor !== undefined) return entry.anchor;
    const placements = entry.placements;
    if (placements.length === 0) {
      const x = (chunkX + 0.5) * this.terrainView.chunkWorldSize;
      const z = -(chunkZ + 0.5) * this.terrainView.chunkWorldSize;
      entry.anchor = Object.freeze({
        x,
        y: this.terrainView.getCanonicalHeight(x, z),
        z,
        heightScale: 1,
      });
      return entry.anchor;
    }
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    const scales = [];
    for (const placement of placements) {
      sumX += placement.x;
      sumY += placement.height;
      sumZ += placement.z;
      scales.push(placement.heightScale ?? placement.scale ?? 1);
    }
    entry.anchor = Object.freeze({
      x: sumX / placements.length,
      y: sumY / placements.length,
      z: sumZ / placements.length,
      heightScale: percentile90(scales),
    });
    return entry.anchor;
  }

  canopyAggregate(chunkX, chunkZ, minimumWidth, minimumHeight) {
    const entry = this.cache.get(`${chunkX}:${chunkZ}`);
    if (!entry) return null;
    const shapeKey = `${minimumWidth}:${minimumHeight}`;
    if (entry.canopyShapeKey === shapeKey) return entry.canopy;
    const placements = entry.placements;
    const emergentCount = Math.max(0, Math.round(placements.length * 0.04));
    const emergent = placements.length === 0 || emergentCount === 0
      ? []
      : [...placements]
        .sort((left, right) => (
          (right.heightScale ?? right.scale) - (left.heightScale ?? left.scale)
          || (left.stableId < right.stableId ? -1 : (left.stableId > right.stableId ? 1 : 0))
        ))
        .slice(0, emergentCount);
    entry.canopy = Object.freeze({
      clusters: aggregateCanopyClusters({
        chunkX,
        chunkZ,
        placements,
        minimumWidth,
        minimumHeight,
      }),
      emergent,
    });
    entry.canopyShapeKey = shapeKey;
    return entry.canopy;
  }

  build(chunkX, chunkZ, rockSource) {
    const context = this.context(chunkX, chunkZ, rockSource);
    const perChunk = this.config.trees.perChunk;
    const maxAccepted = Math.max(
      1,
      Math.trunc(this.config.trees.habitat?.maxAcceptedPerChunk) || perChunk,
    );
    const candidateBudget = this.forestField
      ? resolveForestCandidateBudget(
        perChunk,
        this.config.trees.habitat?.candidateBudgetPerChunk,
      )
      : perChunk;
    const counters = { evaluated: 0, rejectedHabitat: 0, rejectedEdits: 0 };
    const fieldStatsBefore = {
      builds: 0,
      cacheHits: 0,
      patchBuilds: 0,
      patchCacheHits: 0,
      ...(this.forestField?.stats ?? {}),
    };
    const generated = buildStableChunkManifest({
      kind: 'tree',
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize: this.terrainView.worldStore.tileSize,
      perChunk: candidateBudget,
      maxAccepted,
      tileIds: this.config.trees.tileIds,
      tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      prototypeCount: this.prototypeCount,
      minScale: this.config.trees.minScale,
      maxScale: this.config.trees.maxScale,
      radiusForScale: (scale) => context.clearRadius * scale,
      blockers: context.blockers,
      candidateEvaluator: createForestPlacementEvaluator(this.forestField, counters, {
        speciesRegistry: this.speciesRegistry,
        editStore: this.editStore,
        exclusionAt: this.pathClearance.exclusion(),
      }),
    });
    const planted = this.editStore.plantedForChunk(
      chunkX,
      chunkZ,
      this.terrainView.chunkWorldSize,
    ).map((plant, index) => {
      const habitat = this.forestField?.sample(plant.x, plant.z) ?? {
        patchId: null,
        profileKey: null,
        structure: null,
        suitability: 1,
        patchCoverage: 1,
        patchEdge: 0,
        slope: 0,
        elevation: this.terrainView.getCanonicalHeight(plant.x, plant.z),
        waterWeight: 1,
      };
      const candidate = {
        stableId: plant.stableId,
        ownerChunkX: chunkX,
        ownerChunkZ: chunkZ,
        index: candidateBudget + index,
        x: plant.x,
        z: plant.z,
        height: this.terrainView.getCanonicalHeight(plant.x, plant.z),
        scale: this.config.trees.minScale,
        rotationY: 0,
        prototypeIndex: 0,
        radius: context.clearRadius,
        priority: 0,
      };
      const ecological = this.speciesRegistry.select(candidate, {
        ...habitat,
        profileKey: habitat.profileKey ?? 'temperate_deciduous_forest',
      });
      return Object.freeze({
        ...candidate,
        ...ecological,
        speciesId: plant.speciesId,
        ageClass: plant.ageClass,
        patchId: habitat.patchId ?? `planted:${plant.stableId}`,
        forestProfileKey: habitat.profileKey,
        forestStructure: habitat.structure ?? 'planted',
        forestSuitability: habitat.suitability,
        forestPatchCoverage: habitat.patchCoverage,
        forestPatchEdge: habitat.patchEdge,
        forestSlope: habitat.slope,
        forestElevation: habitat.elevation,
        planted: true,
      });
    });
    const placements = Object.freeze([...generated, ...planted]);
    const rejectedSpacing = Math.max(
      0,
      counters.evaluated - counters.rejectedHabitat - counters.rejectedEdits - generated.length,
    );
    this.cache.set(`${chunkX}:${chunkZ}`, {
      signature: context.signature,
      placements,
    });
    PerfCounters.inc('treeManifestBuilds');
    PerfCounters.set('forestLastChunkCandidatesEvaluated', counters.evaluated);
    PerfCounters.set('forestLastChunkCandidatesRejectedHabitat', counters.rejectedHabitat);
    PerfCounters.set('forestLastChunkCandidatesRejectedEdits', counters.rejectedEdits);
    PerfCounters.set('forestLastChunkCandidatesRejectedSpacing', rejectedSpacing);
    PerfCounters.set('forestLastChunkTreesAccepted', placements.length);
    PerfCounters.inc(
      'forestFieldBuilds',
      (this.forestField?.stats.builds ?? 0) - fieldStatsBefore.builds,
    );
    PerfCounters.inc(
      'forestFieldCacheHits',
      (this.forestField?.stats.cacheHits ?? 0) - fieldStatsBefore.cacheHits,
    );
    PerfCounters.inc(
      'forestPatchGridBuilds',
      (this.forestField?.stats.patchBuilds ?? 0) - fieldStatsBefore.patchBuilds,
    );
    PerfCounters.inc(
      'forestPatchGridCacheHits',
      (this.forestField?.stats.patchCacheHits ?? 0) - fieldStatsBefore.patchCacheHits,
    );
    PerfCounters.set('forestLastChunkPatchCount', new Set(
      placements.map((placement) => placement.patchId).filter(Boolean),
    ).size);
    for (const [speciesId, count] of placements.reduce((counts, placement) => {
      counts.set(placement.speciesId, (counts.get(placement.speciesId) ?? 0) + 1);
      return counts;
    }, new Map())) {
      PerfCounters.set(`forestSpecies.${speciesId}`, count);
    }
    return placements;
  }

  invalidateAll() {
    this.cache.clear();
    this.contextCache.clear();
  }

  fell(stableId) {
    const changed = this.editStore.fell(stableId);
    if (changed) {
      this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
      this.editDocumentRef = this.terrainView.worldStore.forestEdits;
      this.invalidateAll();
    }
    return changed;
  }

  plant(record) {
    const planted = this.editStore.plant(record);
    this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
    this.editDocumentRef = this.terrainView.worldStore.forestEdits;
    this.invalidateAll();
    return planted;
  }

  setPatchState(patchId, state, progress = 0) {
    this.editStore.setPatchState(patchId, state, progress);
    this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
    this.editDocumentRef = this.terrainView.worldStore.forestEdits;
    this.invalidateAll();
  }

  schedule(chunkX, chunkZ, rockSource) {
    const key = `${chunkX}:${chunkZ}`;
    const focus = this.terrainView.focusChunk;
    const priority = focus
      ? Math.max(Math.abs(chunkX - focus.chunkX), Math.abs(chunkZ - focus.chunkZ))
      : 0;
    this.pendingKeys.add(key);
    this.queue.enqueue({ key, chunkX, chunkZ, rockSource, priority });
  }

  getOrSchedule(chunkX, chunkZ, rockSource) {
    const placements = this.get(chunkX, chunkZ, rockSource);
    if (!placements) this.schedule(chunkX, chunkZ, rockSource);
    return placements;
  }

  setActive(keys) {
    this.activeKeys = keys;
    for (const key of this.cache.keys()) {
      if (!keys.has(key)) this.cache.delete(key);
    }
    for (const key of this.contextCache.keys()) {
      if (!keys.has(key)) this.contextCache.delete(key);
    }
  }

  flush() {
    const result = this.queue.flush((job) => {
      this.pendingKeys.delete(job.key);
      if (!this.activeKeys.has(job.key)) return false;
      this.build(job.chunkX, job.chunkZ, job.rockSource);
      this.onBuilt?.();
      return true;
    });
    PerfCounters.set('treeManifestQueueDepth', result.remaining);
    return result;
  }

  dispose() {
    this.queue.clear();
    this.pendingKeys.clear();
    this.activeKeys.clear();
    this.cache.clear();
    this.contextCache.clear();
  }
}
