import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { extractRockPrototypes } from './StylizedPrototypeBake.js';
import { instanceCapacity } from './scatterMath.js';
import {
  buildStableChunkManifest,
  placementSignature,
} from './StableScatterManifest.js';
import {
  buildChunkLodPlan,
  createInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
  writeInstances,
} from './lod/StylizedLodRuntime.js';
import { createRockProxyPrototype } from './lod/StylizedProxyGeometry.js';
import { ScatterClusterField } from './forest/ScatterClusterField.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';

// Reused across a rebuild: `compose` reads out of these, so only the matrix
// itself has to be a fresh object per instance.
const ROCK_UP = new THREE.Vector3(0, 1, 0);
const ROCK_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};
import { createPathClearanceField } from './TreeManifestStore.js';

const ROCK_CLUSTER_SEED_OFFSET = 0xa7;

/**
 * Boulders read as dark, hard-faceted stone. `rocks.color` tints the source GLB
 * material toward that; instance colour variation then spreads each cluster over
 * a range so a scree field is not a field of clones.
 */
function cloneMaterial(mesh, config) {
  const source = materialList(mesh)[0];
  const material = source.clone();
  if ('roughness' in material) material.roughness = 1;
  if ('metalness' in material) material.metalness = 0;
  if (config?.rocks?.color && 'color' in material) {
    material.color = new THREE.Color(config.rocks.color);
    if ('map' in material) material.map = null;
  }
  material.flatShading = true;
  material.needsUpdate = true;
  return material;
}

function createInstances(prototypeCount) {
  return Array.from({ length: prototypeCount }, () => []);
}

function lodSettings(config) {
  const rock = config.lod?.rock ?? {};
  const meshRadius = rock.meshRadius ?? config.rocks.residentRadius;
  const proxyRadius = Math.max(meshRadius, rock.proxyRadius ?? 3);
  return Object.freeze({
    enabled: config.lod?.enabled !== false,
    meshRadius,
    proxyRadius,
    transitionMs: rock.transitionMs ?? 240,
    thresholds: {
      nearPixels: rock.nearPixels ?? 16,
      proxyPixels: rock.proxyPixels ?? 1.5,
      impostorPixels: rock.impostorPixels ?? 0.5,
      clusterPixels: rock.clusterPixels ?? 0.25,
      hysteresisRatio: rock.hysteresisRatio ?? 0.15,
    },
  });
}

function disposePrototypeParts(prototypes) {
  for (const parts of prototypes) {
    for (const part of parts) {
      part.geometry?.dispose();
      part.material?.dispose();
    }
  }
  prototypes.length = 0;
}

export class StylizedRockView {
  constructor({ terrainView, config, revisionTracker }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.prototypes = [];
    this.proxyPrototypes = [];
    this.meshes = [];
    this.proxyMeshes = [];
    this.placements = [];
    this.placementsByChunk = new Map();
    this.clusterField = null;
    this.signature = '';
    this.manifestCache = new Map();
    // Chunks other scatter layers asked about since the last prune. Bounded by
    // their request windows, which are a few hundred chunks of ~14 placements.
    this.blockerRequests = new Set();
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    this.root.name = 'stylized-rocks';
    terrainView.scene.add(this.root);
  }

  async buildFromScene(scene) {
    if (!this.config.rocks.enabled || !scene || this.disposed) return;
    scene.updateMatrixWorld(true);
    const extracted = extractRockPrototypes(scene, this.config.assets.rockMaterial);
    this.prototypes = extracted.map(({ geometry, source }) => ({
      geometry,
      material: cloneMaterial(source, this.config),
      kind: 'rock',
    }));
    if (this.prototypes.length === 0) {
      throw new Error(`No rock meshes use material ${this.config.assets.rockMaterial}.`);
    }
    this.clusterField = new ScatterClusterField({
      kind: 'rock',
      seed: resolveForestSeed(this.terrainView.worldStore),
      seedOffset: ROCK_CLUSTER_SEED_OFFSET,
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      slopeSampleDistance: this.config.trees.habitat?.slopeSampleDistance ?? 4,
      config: this.config.rocks,
    });
    this.pathClearance = createPathClearanceField(this.terrainView, this.config);

    const settings = lodSettings(this.config);
    const capacity = instanceCapacity({
      residentRadius: settings.proxyRadius + 1,
      perChunk: this.config.rocks.perChunk,
    });
    const proxies = this.prototypes.map((prototype) => createRockProxyPrototype(prototype));
    this.proxyPrototypes = proxies.map((prototype) => prototype.parts);
    this.prototypeHeight = Math.max(...proxies.map((prototype) => prototype.height));
    this.meshes = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.prototypes.map((prototype) => [prototype]),
      capacity,
      name: 'stylized-rock-near',
      castShadow: true,
    });
    this.proxyMeshes = createInstancedRenderers({
      root: this.root,
      partsByPrototype: this.proxyPrototypes,
      capacity,
      name: 'stylized-rock-proxy',
      castShadow: false,
    });
  }

  update(timestamp, camera) {
    if (this.disposed || this.prototypes.length === 0 || !this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.root.position.set(-origin.x, 0, -origin.z);
    const settings = lodSettings(this.config);
    const renderRadius = settings.enabled ? settings.proxyRadius : this.config.rocks.residentRadius;
    const placementRadius = renderRadius + 1;
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
    const revisionSignature = this.revisionTracker.windowSignature(focus, placementRadius, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${plan.signature}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    this.pendingRebuild = {
      key: `rock-lod:${updateKey}`,
      updateKey,
      focus,
      placementRadius,
      plan,
    };
  }

  applyPendingRebuild() {
    const job = this.pendingRebuild;
    if (!job) return false;
    this.pendingRebuild = null;
    this.lastUpdateKey = job.updateKey;
    this.rebuild(job.focus, job.placementRadius, job.plan);
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

  /**
   * Boulders gather into scree groups instead of scattering evenly: the cluster
   * field concentrates them into patches, and its slope term thins them on flat
   * meadow while letting them accumulate on broken ground.
   */
  createCandidateEvaluator() {
    if (!this.clusterField) return null;
    const blocksPath = this.pathClearance?.exclusion();
    return (candidate) => {
      if (blocksPath?.(candidate)) return null;
      const cluster = this.clusterField.sample(candidate.x, candidate.z);
      if (candidate.priority >= cluster.density) return null;
      return {
        clusterId: cluster.clusterId,
        rockCoverage: cluster.coverage,
        rockEdge: cluster.edge,
        rockSlope: cluster.slope,
      };
    };
  }

  manifestForChunk(chunkX, chunkZ) {
    const key = [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.clusterField?.signature ?? 'uniform',
      this.pathClearance?.signature ?? 'nopath',
    ].join('|');
    const cacheKey = `${chunkX}:${chunkZ}`;
    const cached = this.manifestCache.get(cacheKey);
    if (cached?.key === key) {
      this.placementsByChunk.set(cacheKey, cached.placements);
      return cached.placements;
    }

    const placements = buildStableChunkManifest({
      kind: 'rock',
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize: this.terrainView.worldStore.tileSize,
      perChunk: this.config.rocks.perChunk,
      tileIds: this.config.rocks.tileIds,
      tileAt: (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      prototypeCount: this.prototypes.length,
      minScale: this.config.rocks.minScale,
      maxScale: this.config.rocks.maxScale,
      radiusForScale: (scale) => this.config.rocks.radius * scale,
      candidateEvaluator: this.createCandidateEvaluator(),
    });
    this.manifestCache.set(cacheKey, { key, placements });
    this.placementsByChunk.set(cacheKey, placements);
    return placements;
  }

  rebuild(focus, placementRadius, plan) {
    PerfCounters.inc('rockRebuilds');
    // Sink each boulder by a fraction of its height so it reads as embedded in
    // the ground rather than resting on it.
    const burial = Math.max(0, Number(this.config.rocks.burial) || 0);
    const colorRange = Math.max(0, Number(this.config.rocks.colorVariation) || 0);
    const burialFor = (placement) => this.prototypeHeight * placement.scale * burial;
    const near = createInstances(this.prototypes.length);
    const proxy = createInstances(this.prototypes.length);
    const placements = [];
    const activeChunks = new Set();
    const planByChunk = new Map(plan.entries.map((entry) => [`${entry.chunkX}:${entry.chunkZ}`, entry]));

    for (let chunkZ = focus.chunkZ - placementRadius;
      chunkZ <= focus.chunkZ + placementRadius;
      chunkZ += 1) {
      for (let chunkX = focus.chunkX - placementRadius;
        chunkX <= focus.chunkX + placementRadius;
        chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        activeChunks.add(key);
        const manifest = this.manifestForChunk(chunkX, chunkZ);
        placements.push(...manifest);
        const entry = planByChunk.get(key);
        if (!entry) continue;
        for (const representation of entry.representations) {
          if (representation.band === 'culled' || representation.fade <= 0) continue;
          for (const placement of manifest) {
            const instance = {
              matrix: new THREE.Matrix4().compose(
                ROCK_SCRATCH.position.set(
                  placement.x,
                  placement.height - burialFor(placement),
                  placement.z,
                ),
                ROCK_SCRATCH.quaternion.setFromAxisAngle(ROCK_UP, placement.rotationY),
                ROCK_SCRATCH.scale.setScalar(placement.scale),
              ),
              fade: representation.fade,
              seed: placement.priority,
              colorVariation: 1 - colorRange * 0.5 + placement.priority * colorRange,
            };
            const target = representation.band === 'near' ? near : proxy;
            target[placement.prototypeIndex].push(instance);
          }
        }
      }
    }

    const nearCount = writeInstances(this.meshes, near);
    const proxyCount = writeInstances(this.proxyMeshes, proxy);
    this.placements = placements;
    this.signature = placementSignature(placements);
    PerfCounters.set('rockNearInstances', nearCount);
    PerfCounters.set('rockProxyInstances', proxyCount);
    PerfCounters.set('rockPlacementInstances', placements.length);

    for (const key of this.manifestCache.keys()) {
      if (!activeChunks.has(key) && !this.blockerRequests.has(key)) {
        this.manifestCache.delete(key);
        this.placementsByChunk.delete(key);
      }
    }
    // Consumers re-request every frame, so a fresh window is rebuilt before the
    // next prune; anything that stops being asked about is dropped then.
    this.blockerRequests.clear();
  }

  getPlacements() {
    return this.placements;
  }

  /**
   * Boulder blockers for a chunk and its halo, consumed by tree and bush
   * placement.
   *
   * Trees ask about chunks far outside the boulder render window (their cluster
   * band reaches much further than `proxyRadius`), so every requested chunk is
   * recorded here. Without that, `rebuild` would prune those manifests as
   * "inactive" and they would be rebuilt from scratch on the very next frame —
   * a continuous rebuild of the same far chunks.
   */
  getBlockersForChunk(chunkX, chunkZ, halo = 1) {
    const placements = [];
    for (let offsetZ = -halo; offsetZ <= halo; offsetZ += 1) {
      for (let offsetX = -halo; offsetX <= halo; offsetX += 1) {
        const neighbourX = chunkX + offsetX;
        const neighbourZ = chunkZ + offsetZ;
        this.blockerRequests.add(`${neighbourX}:${neighbourZ}`);
        placements.push(...this.manifestForChunk(neighbourX, neighbourZ));
      }
    }
    return placements;
  }

  getSignature() {
    return this.signature;
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
    disposePrototypeParts(this.proxyPrototypes);
    this.placements.length = 0;
    this.manifestCache.clear();
    this.placementsByChunk.clear();
    this.chunkLodStates.clear();
  }
}
