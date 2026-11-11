import { createIteratorBuilder } from './ResumableIterator.js';
import { finalizeTreeManifest } from './TreeManifestFinalizer.js';
import { ForestEditRevisions } from './forest/ForestEditRevisions.js';
import { withinPreparationWindow } from '../world/PlacementPreparationWindow.js';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { cellCenterToWorld } from '../world/WorldCoordinates.js';
import { StylizedBuildQueue } from './StylizedBuildQueue.js';
import {
  blockersForChunk,
  createStableChunkManifestBuilder,
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
import { combineExclusions, createBarrenEdgeExclusion } from './forest/barrenEdgeExclusion.js';

const FOREST_STAT_KEYS = Object.freeze([
  'builds',
  'cacheHits',
  'patchBuilds',
  'patchCacheHits',
]);

function forestStats(field) {
  const stats = {};
  for (const key of FOREST_STAT_KEYS) stats[key] = field?.stats?.[key] ?? 0;
  return stats;
}

function addForestStatsDelta(target, before, after) {
  for (const key of FOREST_STAT_KEYS) {
    target[key] += Math.max(0, (after[key] ?? 0) - (before[key] ?? 0));
  }
}

export function createPathClearanceField(terrainView, config) {
  const key = JSON.stringify(config.path ?? {});
  terrainView.placementPaths ??= new Map();
  if (terrainView.placementPaths.has(key)) return terrainView.placementPaths.get(key);
  const field = new PathClearanceField({
    tileAt: (cellX, cellZ) => terrainView.tileMap.get(cellX, cellZ),
    tileSize: terrainView.worldStore.tileSize,
    chunkSize: terrainView.worldStore.chunkSize,
    roadTileId: config.path?.tileId ?? 13,
    clearCells: config.path?.clearCells ?? 0,
    naturalTrail: config.path?.naturalTrail,
    revisionProvider: () => terrainView.worldStore.revision,
  });
  field.field.preparedProvider = (x, z) => terrainView.preparedPlacement?.field('path', x, z);
  terrainView.placementPaths.set(key, field);
  return field;
}

function createForestField(terrainView, config, regionalCharacterField = null) {
  const habitat = config.trees.habitat ?? {};
  if (habitat.enabled === false) return null;
  const field = new ForestHabitatField({
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
  field.preparedProvider = (x, z) => terrainView.preparedPlacement?.forestSample(x, z);
  field.localRevisionProvider = (x, z) => terrainView.preparedPlacement
    ? terrainView.preparedPlacement.signature(Math.floor(x / terrainView.chunkWorldSize), Math.floor(-z / terrainView.chunkWorldSize))
    : terrainView.worldStore.revision;
  return field;
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
    prototypePreferredTileIds = null,
    prototypeAgeClasses = null,
    objectMap = null,
    regionalCharacterField = null,
    onBuilt,
    fitPlacement = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.prototypeCount = prototypeCount;
    this.objectMap = objectMap;
    this.onBuilt = onBuilt;
    this.fitPlacement = fitPlacement;
    this.forestField = createForestField(terrainView, config, regionalCharacterField);
    this.speciesRegistry = new ForestSpeciesRegistry({
      species: config.trees.species,
      palettes: config.trees.speciesPalettes,
      prototypeCount,
      prototypeIndexBySpecies,
      prototypeTileIds,
      prototypePreferredTileIds,
      prototypeAgeClasses,
      groveMix: config.trees.groveMix,
    });
    this.pathClearance = createPathClearanceField(terrainView, config);
    this.editStore = new ForestEditStore(terrainView.worldStore.forestEdits);
    this.editDocumentRef = terrainView.worldStore.forestEdits ?? null;
    this.editRevisions = new ForestEditRevisions(terrainView.chunkWorldSize);
    this.version = 0;
    this.clock = 0;
    this.cacheLimit = config.streaming?.retainedManifestChunks ?? 625;
    this.cache = new Map();
    this.contextCache = new Map();
    this.pendingBuilds = new Map();
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
      this.editRevisions.reset();
      this.contextCache.clear();
    }
    const cacheKey = `${chunkX}:${chunkZ}`;
    const previous = this.contextCache.get(cacheKey);
    const version = rockSource?.manifestStore?.version;
    const rockStore = rockSource?.manifestStore;
    const sourceWindow = rockStore?.window;
    const worldRevision = this.revisionTracker.revision;
    const objectRevision = this.objectMap?.revision ?? 0;
    const prototypeRevision = rockSource?.prototypeRevision ?? 0;
    const paletteRevision = rockSource?.biomeAssetPalette?.revision ?? 0;
    if (version !== undefined && previous?.version === version
      && previous.rockStore === rockStore && previous.sourceWindow === sourceWindow
      && previous.worldRevision === worldRevision && previous.objectRevision === objectRevision
      && previous.prototypeRevision === prototypeRevision && previous.paletteRevision === paletteRevision
      && previous.editRevision === this.editStore.revision && previous.prototypeCount === this.prototypeCount) {
      return previous.context;
    }
    const clearRadius = this.config.trees.clearRadius ?? this.terrainView.worldStore.tileSize;
    const rockSnapshot = rockSource?.blockerSnapshotForChunk?.(chunkX, chunkZ, 1);
    const rocks = rockSource?.blockerSnapshotForChunk
      ? rockSnapshot?.placements ?? null
      : Array.isArray(rockSource)
      ? rockSource
      : rockSource?.getPreparedBlockersForChunk
        ? rockSource.getPreparedBlockersForChunk(chunkX, chunkZ, 1)
        : rockSource?.getBlockersForChunk?.(chunkX, chunkZ, 1) ?? [];
    if (rocks === null) {
      // Keep a failed dependency lookup too. Scanning the same nine rock
      // manifests and prepared-field halo every frame cannot make it ready.
      // Completion, edits, assets or a moved preparation window invalidate it.
      this.contextCache.set(cacheKey, { context: null, version, rockStore, sourceWindow,
        worldRevision, objectRevision, prototypeRevision, paletteRevision,
        editRevision: this.editStore.revision, prototypeCount: this.prototypeCount });
      return null;
    }
    const constructionBounds = this.constructionQueryBounds(chunkX, chunkZ, clearRadius);
    const constructionRevision = this.objectMap?.signatureForBounds?.(constructionBounds)
      ?? this.objectMap?.revision
      ?? 0;
    const key = `${chunkX}:${chunkZ}`;
    const inputSignature = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      rockSnapshot?.signature ?? placementSignature(rocks),
      constructionRevision,
      this.prototypeCount,
      this.forestField?.signature ?? 'uniform',
      this.speciesRegistry.signature,
      this.pathClearance.signature,
      this.editRevisions.signature(chunkX, chunkZ),
    ].join('|');
    const cached = this.contextCache.get(key);
    if (cached?.inputSignature === inputSignature) {
      Object.assign(cached, { version, rockStore, sourceWindow, worldRevision, objectRevision, prototypeRevision,
        paletteRevision, editRevision: this.editStore.revision, prototypeCount: this.prototypeCount });
      return cached.context;
    }

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
    this.contextCache.set(key, { inputSignature, context, version, rockStore, sourceWindow, worldRevision, objectRevision,
      prototypeRevision, paletteRevision, editRevision: this.editStore.revision, prototypeCount: this.prototypeCount });
    return context;
  }

  get(chunkX, chunkZ, rockSource) {
    const key = `${chunkX}:${chunkZ}`;
    const cached = this.cache.get(key);
    if (!cached) return null;
    const context = this.context(chunkX, chunkZ, rockSource);
    if (!context || cached.signature !== context.signature) return null;
    cached.used = ++this.clock;
    return cached.placements;
  }

  /**
   * The last built placements for a chunk without the signature check `get`
   * makes — cheap enough to ask every frame. A rebuild replaces the array, so
   * callers can key on its identity.
   */
  peek(chunkX, chunkZ) {
    return this.cache.get(`${chunkX}:${chunkZ}`)?.placements ?? null;
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
    // Lattice crowns (trees.unclusteredSpecies) read as nothing like a merged
    // canopy blob, so they skip the clusters and stand as their own impostors.
    const unclustered = new Set(this.config.trees.unclusteredSpecies ?? []);
    const standalone = entry.placements.filter((placement) => unclustered.has(placement.speciesId));
    const placements = standalone.length
      ? entry.placements.filter((placement) => !unclustered.has(placement.speciesId))
      : entry.placements;
    const emergentCount = Math.max(0, Math.round(placements.length * 0.04));
    const emergent = placements.length === 0 || emergentCount === 0
      ? []
      : [...placements]
        .sort((left, right) => (
          (right.heightScale ?? right.scale) - (left.heightScale ?? left.scale)
          || (left.stableId < right.stableId ? -1 : (left.stableId > right.stableId ? 1 : 0))
        ))
        .slice(0, emergentCount);
    emergent.push(...standalone);
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

  createBuildState(chunkX, chunkZ, context) {
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
    const accumulatedFieldStats = Object.fromEntries(FOREST_STAT_KEYS.map((key) => [key, 0]));
    return {
      signature: context.signature,
      context,
      candidateBudget,
      counters,
      accumulatedFieldStats,
      builder: createStableChunkManifestBuilder({
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
          exclusionAt: combineExclusions(this.pathClearance.exclusion(), createBarrenEdgeExclusion(
            this.config.trees.barrenEdge, (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ), this.terrainView.worldStore.tileSize)),
        }),
      }),
    };
  }

  build(chunkX, chunkZ, rockSource, shouldYield = null) {
    if (shouldYield?.()) return null;
    const context = this.context(chunkX, chunkZ, rockSource);
    if (!context) return null;
    const prepared = this.terrainView.preparedPlacement;
    if (prepared && !prepared.ensureChunk(chunkX, chunkZ, 2, 0)) return null;
    const key = `${chunkX}:${chunkZ}`;
    let state = this.pendingBuilds.get(key);
    if (!state || state.signature !== context.signature) {
      state = this.createBuildState(chunkX, chunkZ, context);
      this.pendingBuilds.set(key, state);
    }

    if (!state.finalizer) {
      const before = forestStats(this.forestField);
      const generated = state.builder.step({ shouldYield });
      addForestStatsDelta(state.accumulatedFieldStats, before, forestStats(this.forestField));
      PerfCounters.inc('treeManifestBuildSlices');
      if (generated === null) return null;
      state.generatedCount = generated.length;
      state.finalizer = createIteratorBuilder(() => finalizeTreeManifest(this, state, generated, chunkX, chunkZ));
    }
    const before = forestStats(this.forestField);
    const placements = state.finalizer.step({ shouldYield });
    addForestStatsDelta(state.accumulatedFieldStats, before, forestStats(this.forestField));
    if (placements === null) return null;
    this.pendingBuilds.delete(key);
    const rejectedSpacing = Math.max(
      0,
      state.counters.evaluated
        - state.counters.rejectedHabitat
        - state.counters.rejectedEdits
        - state.generatedCount,
    );
    this.cache.set(key, {
      signature: context.signature,
      placements, used: ++this.clock,
    });
    this.version++;
    PerfCounters.inc('treeManifestBuilds');
    PerfCounters.set('forestLastChunkCandidatesEvaluated', state.counters.evaluated);
    PerfCounters.set('forestLastChunkCandidatesRejectedHabitat', state.counters.rejectedHabitat);
    PerfCounters.set('forestLastChunkCandidatesRejectedEdits', state.counters.rejectedEdits);
    PerfCounters.set('forestLastChunkCandidatesRejectedSpacing', rejectedSpacing);
    PerfCounters.set('forestLastChunkTreesAccepted', placements.length);
    PerfCounters.inc('forestFieldBuilds', state.accumulatedFieldStats.builds);
    PerfCounters.inc('forestFieldCacheHits', state.accumulatedFieldStats.cacheHits);
    PerfCounters.inc('forestPatchGridBuilds', state.accumulatedFieldStats.patchBuilds);
    PerfCounters.inc('forestPatchGridCacheHits', state.accumulatedFieldStats.patchCacheHits);
    PerfCounters.set('forestLastChunkPatchCount', state.patchCount);
    for (const [speciesId, count] of state.species) {
      PerfCounters.set(`forestSpecies.${speciesId}`, count);
    }
    return placements;
  }

  invalidateAll() {
    this.cache.clear();
    this.contextCache.clear();
    this.pendingBuilds.clear();
    this.version++;
  }

  fell(stableId) {
    const changed = this.editStore.fell(stableId);
    if (changed) {
      this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
      this.editDocumentRef = this.terrainView.worldStore.forestEdits;
      this.editRevisions.fell(stableId, this.editStore.planted.get(stableId));
      this.version++;
    }
    return changed;
  }

  plant(record) {
    const planted = this.editStore.plant(record);
    this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
    this.editDocumentRef = this.terrainView.worldStore.forestEdits;
    this.editRevisions.touchPosition(planted.x, planted.z);
    this.version++;
    return planted;
  }

  setPatchState(patchId, state, progress = 0) {
    this.editStore.setPatchState(patchId, state, progress);
    this.terrainView.worldStore.forestEdits = this.editStore.toDocument();
    this.editDocumentRef = this.terrainView.worldStore.forestEdits;
    this.editRevisions.patch(patchId, this.forestField);
    this.version++;
  }

  setWindow(x, z, radius) {
    if (this.window?.x === x && this.window.z === z && this.window.radius === radius) return;
    this.window = { x, z, radius };
    this.setActive(new Set([...this.activeKeys].filter(key => {
      const [cx,cz] = key.split(':').map(Number);
      return withinPreparationWindow(cx,cz,this.window);
    })));
  }

  schedule(chunkX, chunkZ, rockSource) {
    if (!withinPreparationWindow(chunkX,chunkZ,this.window)) return;
    const key = `${chunkX}:${chunkZ}`;
    this.activeKeys.add(key);
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
    keys = new Set([...keys].filter(key => {
      const [x,z] = key.split(':').map(Number);
      return withinPreparationWindow(x,z,this.window);
    }));
    this.activeKeys = keys;
    this.queue.retain(job => {
      if (keys.has(job.key)) return true;
      this.pendingKeys.delete(job.key);
      return false;
    });
    if (this.cache.size > this.cacheLimit) {
      const unpinned = [...this.cache].filter(([key]) => !keys.has(key))
        .sort((a, b) => a[1].used - b[1].used);
      for (const [key] of unpinned.slice(0, this.cache.size - this.cacheLimit)) {
        this.cache.delete(key);
        this.contextCache.delete(key);
      }
    }
    for (const key of this.pendingBuilds.keys()) {
      if (!keys.has(key)) this.pendingBuilds.delete(key);
    }
    for (const key of this.contextCache.keys()) {
      if (!keys.has(key) && !this.cache.has(key)) this.contextCache.delete(key);
    }
  }

  flush({ consumeCompleted = true } = {}) {
    let completed = 0;
    const result = this.queue.flush((job, shouldYield) => {
      if (!this.activeKeys.has(job.key)) {
        this.pendingKeys.delete(job.key);
        this.pendingBuilds.delete(job.key);
        return false;
      }
      const before = this.pendingBuilds.get(job.key);
      const progressBefore = (before?.builder.progress ?? 0) + (before?.finalizer?.progress ?? 0);
      const placements = this.build(job.chunkX, job.chunkZ, job.rockSource, shouldYield);
      if (!placements) {
        // Rock blocker preparation and tree candidate generation are both
        // resumable; keep this job until the complete deterministic result exists.
        const after = this.pendingBuilds.get(job.key);
        const progressAfter = (after?.builder.progress ?? 0) + (after?.finalizer?.progress ?? 0);
        return { completed: false, advanced: progressAfter > progressBefore,
          blocked: progressAfter <= progressBefore, reason: after ? 'budget' : 'rock-manifest' };
      }
      PerfCounters.set('treeManifestReadyLatencyMs', performance.now() - job.requestedAt);
      this.pendingKeys.delete(job.key);
      completed++;
      this.onBuilt?.();
      return true;
    });
    PerfCounters.set('treeManifestQueueDepth', result.remaining);
    PerfCounters.set('treeManifestOldestJobMs', this.queue.size
      ? performance.now() - Math.min(...this.queue.queue.map(job => job.requestedAt)) : 0);
    // Preparation may receive an early scheduler turn before the view updates.
    // Retain those completions so the view still publishes newly ready trees.
    this.completedSinceUpdate = (this.completedSinceUpdate ?? 0) + completed;
    const reported = this.completedSinceUpdate;
    if (consumeCompleted) this.completedSinceUpdate = 0;
    return { ...result, completed: reported };
  }

  dispose() {
    this.queue.clear();
    this.pendingBuilds.clear();
    this.pendingKeys.clear();
    this.activeKeys.clear();
    this.cache.clear();
    this.contextCache.clear();
  }
}
