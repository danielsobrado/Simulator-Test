import { ITERATOR_PENDING } from './ResumableIterator.js';
import { cachedLodPlan } from './lod/CachedLodPlan.js';
import { stepViewRebuild } from './StagedViewRebuild.js';
import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { instanceCapacity } from './scatterMath.js';
import { createStableChunkManifestBuilder, placementSignature } from './StableScatterManifest.js';
import {
  buildChunkLodPlan,
  createInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
} from './lod/StylizedLodRuntime.js';
import { drawnRepresentations, ScatterInstanceRows } from './lod/ScatterInstanceRows.js';
import { InstanceAnchor } from './lod/InstanceAnchor.js';
import { ScatterClusterField } from './forest/ScatterClusterField.js';
import { forestFloorDensity, understoryClusterDensity } from './forest/ForestFloor.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';
import { createPathClearanceField } from './TreeManifestStore.js';
import { extractAuthoredMeshPrototypes } from './StylizedPrototypeBake.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { createBiomePrototypeSelector } from './BiomePrototypeSelector.js';
import { biomeLook, placementTileId } from '../biomes/BiomeLooks.js';
import {
  BUSH_CAST_SHADOW,
  cloneBushMaterial,
  createBushProxyPrototype,
} from './BushRenderAssets.js';

const BUSH_CLUSTER_SEED_OFFSET = 0x5b;
const BUSH_PRIORITY_CHANNEL = 31;
const BUSH_RANDOM_CHANNEL_OFFSET = 64;

// Reused across a rebuild; see the matching note in StylizedRockView.
const BUSH_UP = new THREE.Vector3(0, 1, 0);
const BUSH_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};

function lodSettings(config) {
  const bush = config.lod?.bush ?? {};
  const meshRadius = bush.meshRadius ?? config.bushes.residentRadius;
  const proxyRadius = Math.max(meshRadius, bush.proxyRadius ?? meshRadius + 1);
  return Object.freeze({
    enabled: config.lod?.enabled !== false,
    meshRadius,
    proxyRadius,
    forceNearWithinMeshRadius: bush.forceNearWithinMeshRadius === true,
    transitionMs: bush.transitionMs ?? 220,
    thresholds: {
      nearPixels: bush.nearPixels ?? 12,
      proxyPixels: bush.proxyPixels ?? 3,
      impostorPixels: bush.impostorPixels ?? 1,
      clusterPixels: bush.clusterPixels ?? 0.5,
      hysteresisRatio: bush.hysteresisRatio ?? 0.15,
    },
  });
}

function bushMatrix(placement) {
  return new THREE.Matrix4().compose(
    BUSH_SCRATCH.position.set(placement.x, placement.height, placement.z),
    BUSH_SCRATCH.quaternion.setFromAxisAngle(BUSH_UP, placement.rotationY),
    BUSH_SCRATCH.scale.setScalar(placement.scale),
  );
}

/** Seed, brightness variation and the understory look of the biome the bush stands in. */
function bushAppearance(placement, terrainView, looks) {
  return {
    seed: placement.priority,
    colorVariation: 0.84 + placement.priority * 0.32,
    biomeLook: biomeLook(looks, 'understory', placementTileId(terrainView, placement)),
  };
}

function disposePrototypes(prototypes) {
  for (const prototype of prototypes) {
    prototype.geometry?.dispose();
    prototype.material?.dispose();
  }
  prototypes.length = 0;
}

/**
 * Undergrowth as a first-class scatter layer.
 *
 * Bushes used to exist only as a side effect of saplings at forest edges, which
 * left glades bare. This places them from their own cluster field — thickets and
 * clear ground rather than even scatter — thinned under canopy by the shared
 * forest-floor rule so they ring woods instead of carpeting them.
 *
 * Boulders are hard blockers. Trees deliberately are not: reading the tree
 * manifest would make bush acceptance depend on whether that manifest happens to
 * be cached, and placement must stay independent of residency and approach
 * direction. Bushes instead use an independent deterministic random channel,
 * preventing exact tree/bush coordinate collisions without that coupling.
 */
export class StylizedBushView {
  constructor({
    terrainView,
    config,
    revisionTracker,
    forestFieldProvider = null,
    biomeAssetPalette = null,
    regionalCharacterField = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.forestFieldProvider = forestFieldProvider;
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.prototypeIndicesByAsset = new Map();
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
    // Bumped by every `appendVariants`, so the resident-window key notices a
    // variant that streamed in while the camera stood still.
    this.prototypeRevision = 0;
    this.enabled = Boolean(config.bushes?.enabled);
    this.prototypes = [];
    this.proxyPrototypes = [];
    this.meshes = [];
    this.proxyMeshes = [];
    this.placements = [];
    this.manifestCache = new Map();
    this.pendingManifests = new Map();
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.clusterField = null;
    this.root = new THREE.Group();
    // Instances are written relative to this, not in canonical metres (InstanceAnchor).
    this.instanceAnchor = new InstanceAnchor();
    this.instanceRows = new ScatterInstanceRows('bush', bushMatrix,
      (placement) => bushAppearance(placement, this.terrainView, this.config.biomeLooks));
    this.root.name = 'stylized-bushes';
    terrainView.scene.add(this.root);
  }

  /**
   * Install more authored bush variants alongside whatever is already resident.
   *
   * Variants stream in as the camera approaches the biomes they belong to, so
   * this is additive: existing prototypes keep their indices and their
   * instances, and only the new ones get renderers.
   */
  appendVariants(authoredVariants = []) {
    if (!this.enabled || this.disposed || authoredVariants.length === 0) return;
    const bushes = this.config.bushes;
    // Both fields describe the terrain, not the prop set, so they are built once
    // on the first variant and reused by every one that streams in later.
    this.clusterField ??= new ScatterClusterField({
      kind: 'bush',
      seed: resolveForestSeed(this.terrainView.worldStore),
      seedOffset: BUSH_CLUSTER_SEED_OFFSET,
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      slopeSampleDistance: this.config.trees.habitat?.slopeSampleDistance ?? 4,
      config: bushes,
    });
    this.clusterField.localRevisionProvider = (x, z) => this.revisionTracker.signature(
      Math.floor(x / this.terrainView.chunkWorldSize), Math.floor(-z / this.terrainView.chunkWorldSize), 1);
    this.pathClearance ??= createPathClearanceField(this.terrainView, this.config);

    const firstNewPrototype = this.prototypes.length;
    const extracted = [];
    for (const { scene, definition } of authoredVariants) {
      const firstIndex = firstNewPrototype + extracted.length;
      const variants = extractAuthoredMeshPrototypes(scene, { scale: definition.scale });
      if (variants.length === 0) {
        throw new Error(`Bush variant ${definition.scene} produced no prototypes.`);
      }
      extracted.push(...variants.map(part => ({ ...part, motion: definition.motion })));
      for (let index = 0; index < variants.length; index += 1) {
        this.prototypeBiomeRules.push({
          tileIds: definition.tileIds ?? null,
          paletteTileId: definition.paletteTileId ?? definition.tileIds?.[0],
          weight: definition.weight ?? 1,
          character: definition.character ?? null,
          characterStrength: definition.characterStrength,
          canopy: definition.canopy,
        });
      }
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id ?? definition.scene,
        firstIndex,
        variants.length,
      );
    }
    this.prototypeIndexForRoll = createBiomePrototypeSelector({
      rules: this.prototypeBiomeRules,
      regionalCharacterField: this.regionalCharacterField,
    });
    const newPrototypes = extracted.map(({ geometry, source, motion }, index) => {
      const sourceMaterial = materialList(source)[0];
      if (!sourceMaterial) {
        geometry.dispose();
        throw new Error(`Bush prototype ${source.name || index} has no material.`);
      }
      const rule = this.prototypeBiomeRules[firstNewPrototype + index];
      return {
        geometry,
        material: cloneBushMaterial(sourceMaterial, {
          config: this.config,
          motion,
          height: geometry.boundingBox.max.y - geometry.boundingBox.min.y,
          tileId: rule?.paletteTileId ?? rule?.tileIds?.[0],
          biomeLook: true,
        }),
        kind: 'bush',
        instanceBiomeLook: true,
        height: geometry.boundingBox.max.y - geometry.boundingBox.min.y,
        prototypeId: `authored-bush-${firstNewPrototype + index}`,
      };
    });
    const proxyColor = bushes.proxyColor ?? bushes.colorLarge;
    const newProxyPrototypes = newPrototypes.map((prototype, index) => {
      const rule = this.prototypeBiomeRules[firstNewPrototype + index];
      return createBushProxyPrototype(
        prototype,
        { color: proxyColor, config: this.config, tileId: rule?.paletteTileId ?? rule?.tileIds?.[0], biomeLook: true },
      );
    });
    this.prototypes.push(...newPrototypes);
    this.proxyPrototypes.push(...newProxyPrototypes);
    this.prototypeHeight = Math.max(...this.prototypes.map((prototype) => prototype.height));

    const settings = lodSettings(this.config);
    const capacity = instanceCapacity({
      residentRadius: settings.proxyRadius + 1,
      perChunk: bushes.perChunk,
    });
    this.meshes.push(...createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: newPrototypes.map((prototype) => [prototype]),
      capacity,
      name: `stylized-bush-near-${firstNewPrototype}`,
      castShadow: BUSH_CAST_SHADOW,
    }));
    this.proxyMeshes.push(...createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: newProxyPrototypes.map((prototype) => [prototype]),
      capacity,
      name: `stylized-bush-proxy-${firstNewPrototype}`,
      castShadow: BUSH_CAST_SHADOW,
    }));
    this.prototypeRevision += 1;
  }

  /**
   * Cluster coverage gates acceptance the same way forest suitability gates
   * trees: a candidate survives only when its stable priority falls under the
   * local density, so raising density reveals new bushes without moving existing
   * ones.
   */
  createCandidateEvaluator() {
    const bushes = this.config.bushes;
    const forestFloorConfig = this.config.trees.forestFloor ?? {};
    const edgeAffinity = Number.isFinite(bushes.edgeAffinity) ? bushes.edgeAffinity : 0.45;
    const blocksPath = this.pathClearance?.exclusion();
    return (candidate) => {
      if (blocksPath?.(candidate)) return null;
      const cluster = this.clusterField.sample(candidate.x, candidate.z);
      const forestField = this.forestFieldProvider?.();
      const habitat = forestField?.sample(candidate.x, candidate.z) ?? null;
      const regionalScrub = this.regionalCharacterField?.sampleChannel(
        candidate.x,
        candidate.z,
        'scrub',
      ) ?? 1;
      // Scrub districts thin thickets, not the shrub layer of a wood.
      const clusterDensity = understoryClusterDensity(
        cluster.density * regionalScrub,
        habitat,
        bushes.understoryDensity,
      );
      if (clusterDensity <= 0) return null;
      const canopy = habitat
        ? forestFloorDensity(habitat, 'bush', forestFloorConfig)
        : 1;
      // Fringes are the densest band: cluster edge and forest edge both add.
      const fringe = 1 + edgeAffinity * Math.max(cluster.edge, habitat?.patchEdge ?? 0);
      // How thick a biome's undergrowth runs: a rainforest floor is a thicket,
      // a taiga's is thin, a savanna's is scattered scrub.
      const biome = bushes.densityByTile?.[candidate.tileId] ?? 1;
      const density = Math.min(1, clusterDensity * canopy * fringe * biome);
      if (candidate.priority >= density) return null;
      return {
        clusterId: cluster.clusterId,
        bushCoverage: cluster.coverage,
        bushEdge: cluster.edge,
        bushCanopy: canopy,
        bushSlope: cluster.slope,
        forestPatchId: habitat?.patchId ?? null,
        regionalScrub,
      };
    };
  }

  manifestForChunk(chunkX, chunkZ, blockers, shouldYield = null) {
    const key = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.clusterField.signature,
      this.forestFieldProvider?.()?.signature ?? 'uniform',
      this.regionalCharacterField?.signature ?? 'uniform-regions',
      JSON.stringify(this.prototypeBiomeRules),
      this.pathClearance?.signature ?? 'nopath',
      blockers.signature,
      this.biomeAssetPalette?.revision ?? 0,
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) return cached.placements;

    const bushes = this.config.bushes;
    const options = {
      kind: 'bush',
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize: this.terrainView.worldStore.tileSize,
      perChunk: bushes.perChunk,
      tileIds: bushes.tileIds,
      tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      prototypeCount: this.prototypes.length,
      prototypeIndexForRoll: (roll, tileId, x, z) => {
        const automaticIndex = this.prototypeIndexForRoll(
          roll,
          tileId,
          x,
          z,
          this.prototypeIndexForRoll.usesCanopy
            ? this.forestFieldProvider?.()?.sample(x, z) ?? null
            : null,
        );
        return this.biomeAssetPalette?.resolvePrototypeIndex({
          tileId,
          layerId: 'bushes',
          automaticIndex,
          prototypeIndicesByAsset: this.prototypeIndicesByAsset,
          roll,
        }) ?? automaticIndex;
      },
      minScale: bushes.minScale,
      maxScale: bushes.maxScale,
      radiusForScale: (scale) => bushes.radius * scale,
      blockers: blockers.placements,
      randomChannelOffset: BUSH_RANDOM_CHANNEL_OFFSET,
      priorityChannel: BUSH_PRIORITY_CHANNEL,
      candidateEvaluator: this.createCandidateEvaluator(),
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

  update(timestamp, camera, rockSource = null) {
    if (this.disposed || !this.enabled || this.prototypes.length === 0) return;
    if (!this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.place(this.root, origin);
    const settings = lodSettings(this.config);
    const renderRadius = settings.enabled
      ? settings.proxyRadius
      : this.config.bushes.residentRadius;
    const viewportHeight = this.terrainView.viewportHeight
      ?? this.terrainView.renderer.domElement.height ?? 1;
    const planKey = `${focus.chunkX}:${focus.chunkZ}:${this.revisionTracker.revision}:${viewportHeight}:${camera.fov}:${camera.zoom}:${this.prototypeRevision}`;
    const plan = cachedLodPlan(this, planKey, timestamp, settings.transitionMs / 8, () => settings.enabled
      ? buildChunkLodPlan({
        focus,
        radius: renderRadius + 1,
        chunkWorldSize: this.terrainView.chunkWorldSize,
        floatingOrigin: this.terrainView.floatingOrigin,
        camera,
        viewportHeight,
        objectHeight: this.prototypeHeight,
        thresholds: settings.thresholds,
        radii: {
          meshRadius: settings.meshRadius,
          proxyRadius: settings.proxyRadius,
          impostorRadius: settings.proxyRadius,
          clusterRadius: settings.proxyRadius,
          forceNearWithinMeshRadius: settings.forceNearWithinMeshRadius,
        },
        transitionStates: this.chunkLodStates,
        timestamp,
        transitionMs: settings.transitionMs,
        onTransition: ({ durationMs }) => {
          this.terrainView.postProcessing?.notifyReactive(
            'VEGETATION_LOD_CHANGED',
            Math.ceil(durationMs / (1000 / 60)),
          );
        },
      })
      : {
        entries: this.createNearOnlyPlan(focus, renderRadius),
        signature: `near:${focus.chunkX}:${focus.chunkZ}:${renderRadius}`,
      });
    if (this.previousPlan !== plan) {
      pruneStateMap(this.chunkLodStates, plan.entries);
      this.previousPlan = plan;
    }
    const revisionSignature = this.revisionTracker.windowSignature(focus, renderRadius + 1, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${
      plan.signature
    }:${this.biomeAssetPalette?.revision ?? 0}:p${this.prototypeRevision}`
      // Boulders block bush placement, so a rock variant that streams in has to
      // reschedule this layer too — otherwise a stationary camera keeps bushes
      // that were scattered before the boulders existed.
      + `:r${rockSource?.prototypeRevision ?? 0}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    if (this.pendingRebuild?.updateKey === updateKey) return;
    this.pendingRebuild = {
      key: `bush-lod:${updateKey}`,
      updateKey,
      focus: { ...focus },
      placementRadius: renderRadius + 1,
      plan,
      rockSource,
    };
  }

  applyPendingRebuild(shouldYield = null) {
    return stepViewRebuild(this, this.pendingRebuild, shouldYield,
      job => this.iterateRebuild(job.focus, job.placementRadius, job.plan, job.rockSource));
  }

  createNearOnlyPlan(focus, radius) {
    const entries = [];
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        entries.push({
          chunkX,
          chunkZ,
          representations: [{ band: 'near', fade: 1, ditherDirection: 1 }],
        });
      }
    }
    return entries;
  }

  blockersFor(chunkX, chunkZ, rockSource) {
    const snapshot = rockSource?.blockerSnapshotForChunk?.(chunkX, chunkZ, 1);
    if (rockSource?.blockerSnapshotForChunk) return snapshot;
    const placements = rockSource?.getBlockersForChunk?.(chunkX, chunkZ, 1) ?? [];
    return {
      placements,
      signature: placementSignature(placements),
    };
  }

  *iterateRebuild(focus, placementRadius, plan, rockSource) {
    PerfCounters.inc('bushRebuilds');
    const job = this.instanceRows.begin();
    const activeChunks = new Set();
    const planByChunk = new Map(
      plan.entries.map((entry) => [`${entry.chunkX}:${entry.chunkZ}`, entry]),
    );

    for (let chunkZ = focus.chunkZ - placementRadius;
      chunkZ <= focus.chunkZ + placementRadius;
      chunkZ += 1) {
      for (let chunkX = focus.chunkX - placementRadius;
        chunkX <= focus.chunkX + placementRadius;
        chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        activeChunks.add(key);
        const representations = drawnRepresentations(planByChunk.get(key));
        if (representations.length === 0) continue;
        let manifest = null;
        while (manifest === null) {
          const blockers = this.blockersFor(chunkX, chunkZ, rockSource);
          if (blockers) manifest = this.manifestForChunk(chunkX, chunkZ, blockers, this.currentShouldYield);
          if (manifest === null) {
            this.blockedDependency = { reason: blockers ? 'prepared-field' : 'rock-manifest',
              dependencyType: blockers ? 'prepared-field' : 'rock-manifest',
              chunkKeys: [`${chunkX}:${chunkZ}`] };
            yield ITERATOR_PENDING;
          }
        }
        yield* this.instanceRows.stageChunk(job, key, manifest, representations);
      }
    }
    yield* this.instanceRows.stageRetired(job);

    const anchorOrigin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.follow(anchorOrigin);
    const counts = this.instanceRows.commit(job, this.meshes, this.proxyMeshes, this.instanceAnchor);
    this.instanceAnchor.place(this.root, anchorOrigin);
    if (counts.manifestsChanged) this.placements = this.instanceRows.placements();
    PerfCounters.set('bushNearInstances', counts.near);
    PerfCounters.set('bushProxyInstances', counts.proxy);
    PerfCounters.set('bushPlacementInstances', this.placements.length);
    PerfCounters.set('bushClusterFieldBuilds', this.clusterField.stats.builds);
    PerfCounters.set('bushClusterFieldCacheHits', this.clusterField.stats.cacheHits);

    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key)) this.manifestCache.delete(key);
    }
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.meshes);
    disposeInstancedRenderers(this.root, this.proxyMeshes);
    disposePrototypes(this.prototypes);
    disposePrototypes(this.proxyPrototypes);
    this.prototypeIndicesByAsset.clear();
    this.placements.length = 0;
    this.manifestCache.clear();
    this.chunkLodStates.clear();
  }
}
