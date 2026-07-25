import * as THREE from 'three/webgpu';
import { attribute, vec3 } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { instanceCapacity } from './scatterMath.js';
import { buildStableChunkManifest, placementSignature } from './StableScatterManifest.js';
import {
  buildChunkLodPlan,
  createInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
  writeInstances,
} from './lod/StylizedLodRuntime.js';
import { createForestBushPrototypeGeometry } from './forest/ForestBushGeometry.js';
import { ScatterClusterField } from './forest/ScatterClusterField.js';
import { forestFloorDensity } from './forest/ForestFloor.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';
import { createPathClearanceField } from './TreeManifestStore.js';

const BUSH_CLUSTER_SEED_OFFSET = 0x5b;
const BUSH_PRIORITY_CHANNEL = 31;

function lodSettings(config) {
  const bush = config.lod?.bush ?? {};
  const meshRadius = bush.meshRadius ?? config.bushes.residentRadius;
  const proxyRadius = Math.max(meshRadius, bush.proxyRadius ?? meshRadius + 1);
  return Object.freeze({
    enabled: config.lod?.enabled !== false,
    meshRadius,
    proxyRadius,
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

function createMaterial(color, doubleSided) {
  const value = new THREE.Color(color);
  const material = new THREE.MeshLambertNodeMaterial({
    side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.colorNode = vec3(value.r, value.g, value.b).mul(attribute('color', 'vec3'));
  material.flatShading = true;
  return material;
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
 * direction. Canopy thinning plus the trees' own 3.5 m clearance keeps overlap
 * rare without that coupling.
 */
export class StylizedBushView {
  constructor({ terrainView, config, revisionTracker, forestFieldProvider = null }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.forestFieldProvider = forestFieldProvider;
    this.enabled = Boolean(config.bushes?.enabled);
    this.prototypes = [];
    this.meshes = [];
    this.proxyMeshes = [];
    this.placements = [];
    this.manifestCache = new Map();
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.clusterField = null;
    this.root = new THREE.Group();
    this.root.name = 'stylized-bushes';
    terrainView.scene.add(this.root);
  }

  build() {
    if (!this.enabled || this.disposed) return;
    const bushes = this.config.bushes;
    this.clusterField = new ScatterClusterField({
      kind: 'bush',
      seed: resolveForestSeed(this.terrainView.worldStore),
      seedOffset: BUSH_CLUSTER_SEED_OFFSET,
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      slopeSampleDistance: this.config.trees.habitat?.slopeSampleDistance ?? 4,
      config: bushes,
    });
    this.pathClearance = createPathClearanceField(this.terrainView, this.config);

    const generated = createForestBushPrototypeGeometry();
    this.prototypes = generated.map((prototype, index) => ({
      geometry: prototype.geometry,
      material: createMaterial(
        index === 0 ? bushes.colorLarge : (index === 1 ? bushes.colorSmall : bushes.colorFern),
        prototype.doubleSided,
      ),
      kind: 'bush',
      height: prototype.height,
      prototypeId: prototype.prototypeId,
    }));
    this.prototypeHeight = Math.max(...this.prototypes.map((prototype) => prototype.height));

    const settings = lodSettings(this.config);
    const capacity = instanceCapacity({
      residentRadius: settings.proxyRadius + 1,
      perChunk: bushes.perChunk,
    });
    const partsByPrototype = this.prototypes.map((prototype) => [prototype]);
    this.meshes = createInstancedRenderers({
      root: this.root,
      partsByPrototype,
      capacity,
      name: 'stylized-bush-near',
      castShadow: true,
    });
    this.proxyMeshes = createInstancedRenderers({
      root: this.root,
      partsByPrototype,
      capacity,
      name: 'stylized-bush-proxy',
      castShadow: false,
    });
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
      if (cluster.density <= 0) return null;
      const forestField = this.forestFieldProvider?.();
      const habitat = forestField?.sample(candidate.x, candidate.z) ?? null;
      const canopy = habitat
        ? forestFloorDensity(habitat, 'bush', forestFloorConfig)
        : 1;
      // Fringes are the densest band: cluster edge and forest edge both add.
      const fringe = 1 + edgeAffinity * Math.max(cluster.edge, habitat?.patchEdge ?? 0);
      const density = Math.min(1, cluster.density * canopy * fringe);
      if (candidate.priority >= density) return null;
      return {
        clusterId: cluster.clusterId,
        bushCoverage: cluster.coverage,
        bushEdge: cluster.edge,
        bushCanopy: canopy,
        bushSlope: cluster.slope,
        forestPatchId: habitat?.patchId ?? null,
      };
    };
  }

  manifestForChunk(chunkX, chunkZ, blockers) {
    const key = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.clusterField.signature,
      this.forestFieldProvider?.()?.signature ?? 'uniform',
      this.pathClearance?.signature ?? 'nopath',
      blockers.signature,
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) return cached.placements;

    const bushes = this.config.bushes;
    const placements = buildStableChunkManifest({
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
      minScale: bushes.minScale,
      maxScale: bushes.maxScale,
      radiusForScale: (scale) => bushes.radius * scale,
      blockers: blockers.placements,
      priorityChannel: BUSH_PRIORITY_CHANNEL,
      candidateEvaluator: this.createCandidateEvaluator(),
    });
    this.manifestCache.set(cacheKey, { key, placements });
    return placements;
  }

  update(timestamp, camera, rockSource = null) {
    if (this.disposed || !this.enabled || this.prototypes.length === 0) return;
    if (!this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.root.position.set(-origin.x, 0, -origin.z);
    const settings = lodSettings(this.config);
    const renderRadius = settings.enabled
      ? settings.proxyRadius
      : this.config.bushes.residentRadius;
    const viewportHeight = this.terrainView.renderer.domElement.clientHeight
      || this.terrainView.renderer.domElement.height
      || 1;
    const plan = settings.enabled
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
        },
        transitionStates: this.chunkLodStates,
        timestamp,
        transitionMs: settings.transitionMs,
      })
      : {
        entries: this.createNearOnlyPlan(focus, renderRadius),
        signature: `near:${focus.chunkX}:${focus.chunkZ}:${renderRadius}`,
      };
    pruneStateMap(this.chunkLodStates, plan.entries);
    const revisionSignature = this.revisionTracker.windowSignature(focus, renderRadius + 1, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${plan.signature}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    this.pendingRebuild = {
      key: `bush-lod:${updateKey}`,
      updateKey,
      focus,
      placementRadius: renderRadius + 1,
      plan,
      rockSource,
    };
  }

  applyPendingRebuild() {
    const job = this.pendingRebuild;
    if (!job) return false;
    this.pendingRebuild = null;
    this.lastUpdateKey = job.updateKey;
    this.rebuild(job.focus, job.placementRadius, job.plan, job.rockSource);
    return true;
  }

  createNearOnlyPlan(focus, radius) {
    const entries = [];
    for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
      for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
        entries.push({
          chunkX,
          chunkZ,
          representations: [{ band: 'near', fade: 1 }],
        });
      }
    }
    return entries;
  }

  blockersFor(chunkX, chunkZ, rockSource) {
    const placements = rockSource?.getBlockersForChunk?.(chunkX, chunkZ, 1) ?? [];
    return {
      placements,
      signature: placementSignature(placements),
    };
  }

  rebuild(focus, placementRadius, plan, rockSource) {
    PerfCounters.inc('bushRebuilds');
    const near = this.prototypes.map(() => []);
    const proxy = this.prototypes.map(() => []);
    const placements = [];
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
        const entry = planByChunk.get(key);
        if (!entry) continue;
        const visible = entry.representations.some((representation) => (
          representation.band !== 'culled' && representation.fade > 0
        ));
        if (!visible) continue;
        const manifest = this.manifestForChunk(
          chunkX,
          chunkZ,
          this.blockersFor(chunkX, chunkZ, rockSource),
        );
        placements.push(...manifest);
        for (const representation of entry.representations) {
          if (representation.band === 'culled' || representation.fade <= 0) continue;
          const target = representation.band === 'near' ? near : proxy;
          for (const placement of manifest) {
            target[placement.prototypeIndex].push({
              matrix: new THREE.Matrix4().compose(
                new THREE.Vector3(placement.x, placement.height, placement.z),
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  placement.rotationY,
                ),
                new THREE.Vector3(placement.scale, placement.scale, placement.scale),
              ),
              fade: representation.fade,
              seed: placement.priority,
              colorVariation: 0.84 + placement.priority * 0.32,
            });
          }
        }
      }
    }

    const nearCount = writeInstances(this.meshes, near);
    const proxyCount = writeInstances(this.proxyMeshes, proxy);
    this.placements = placements;
    PerfCounters.set('bushNearInstances', nearCount);
    PerfCounters.set('bushProxyInstances', proxyCount);
    PerfCounters.set('bushPlacementInstances', placements.length);
    PerfCounters.set('bushClusterFieldBuilds', this.clusterField.stats.builds);
    PerfCounters.set('bushClusterFieldCacheHits', this.clusterField.stats.cacheHits);

    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key)) this.manifestCache.delete(key);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.meshes);
    disposeInstancedRenderers(this.root, this.proxyMeshes);
    for (const prototype of this.prototypes) {
      prototype.geometry?.dispose();
      prototype.material?.dispose();
    }
    this.prototypes.length = 0;
    this.placements.length = 0;
    this.manifestCache.clear();
    this.chunkLodStates.clear();
  }
}
