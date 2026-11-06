import { applyJungleMist } from './ambient/jungleMistOutput.js';
import { authoredFoliageColor, cloneAuthoredNodeMaterial } from './AuthoredFoliageMaterial.js';
import { rockShadeEmission } from './forest/foliageLight.js';
import { cachedLodPlan } from './lod/CachedLodPlan.js';
import { completeIterator, ITERATOR_PENDING } from './ResumableIterator.js';
import { stepViewRebuild } from './StagedViewRebuild.js';
import { RockManifestStore } from './RockManifestStore.js';
import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList } from '../assets/assetUrl.js';
import { iterateAuthoredMeshPrototypes } from './StylizedPrototypeBake.js';
import { instanceCapacity } from './scatterMath.js';
import {
  placementSignature,
} from './StableScatterManifest.js';
import {
  buildChunkLodPlan,
  iterateInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
} from './lod/StylizedLodRuntime.js';
import { drawnRepresentations, ScatterInstanceRows } from './lod/ScatterInstanceRows.js';
import { InstanceAnchor } from './lod/InstanceAnchor.js';
import { ScatterClusterField } from './forest/ScatterClusterField.js';
import { resolveForestSeed } from './forest/ForestRuntimeConfig.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { createBiomePrototypeSelector } from './BiomePrototypeSelector.js';

// Reused across a rebuild: `compose` reads out of these, so only the matrix
// itself has to be a fresh object per instance.
const ROCK_UP = new THREE.Vector3(0, 1, 0);
const ROCK_SCRATCH = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  scale: new THREE.Vector3(),
};
import { createPathClearanceField } from './TreeManifestStore.js';
import { iterateRiverbankRocks, DEFAULT_RIVERBANK_ROCKS } from './riverbankRocks.js';
import { RiverRockSource } from './RiverRockSource.js';
import { iterateCoastStones, DEFAULT_COAST_STONES } from './coastStones.js';
import { iterateSeabedRocks, DEFAULT_SEABED_ROCKS } from './seabedRocks.js';
import { iterateRockFormations, DEFAULT_ROCK_FORMATIONS } from './rockFormations.js';
import { applyRockWeathering, resolveRockWeathering } from './rockWeathering.js';
import { biomeLook, placementTileId } from '../biomes/BiomeLooks.js';
import { fitRockToGround } from './rockGroundFit.js';
import { rockWaterContact } from './localRockWater.js';
import { staticWaterContactAt } from '../water/StaticWaterSample.js';
import { createOceanDistanceField } from '../water/OceanDistanceField.js';

const ROCK_CLUSTER_SEED_OFFSET = 0xa7;

/**
 * Keep the source GLB's authored stylized texture. Upstream only overrides the
 * PBR response (roughness, metalness and flat shading); deleting the map turns
 * its warm, painted rocks into featureless silhouettes.
 */
export function createStylizedRockMaterial(mesh, config, weathering) {
  const source = materialList(mesh)[0];
  const material = cloneAuthoredNodeMaterial(source);
  if ('roughness' in material) material.roughness = 1;
  if ('metalness' in material) material.metalness = 0;
  if (config?.rocks?.color && 'color' in material) {
    material.color = new THREE.Color(config.rocks.color);
  }
  material.flatShading = true;
  // Preserve painted planes while adding moss, local wetness and contact tone.
  if (weathering) {
    applyRockWeathering(material, {
      settings: weathering.settings,
      seaLevel: weathering.seaLevel,
      localWater: true,
      biomeLook: true,
    });
  }
  material.emissiveNode = rockShadeEmission(material.colorNode ?? authoredFoliageColor(material));
  applyJungleMist(material, config?.ambientEffects);
  material.needsUpdate = true;
  return material;
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
  constructor({
    terrainView,
    config,
    revisionTracker,
    biomeAssetPalette = null,
    regionalCharacterField = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.revisionTracker = revisionTracker;
    this.riverRocks = new RiverRockSource(() => terrainView.worldStore?.generator ?? null);
    this.riverbankConfig = { ...DEFAULT_RIVERBANK_ROCKS, ...(config.rocks?.riverbank ?? {}) };
    this.coastStoneConfig = { ...DEFAULT_COAST_STONES, ...(config.rocks?.coast ?? {}) };
    this.seabedRockConfig = { ...DEFAULT_SEABED_ROCKS, ...(config.rocks?.seabed ?? {}) };
    this.formationConfig = { ...DEFAULT_ROCK_FORMATIONS, ...(config.rocks?.formations ?? {}) };
    this.rockWeatheringSettings = resolveRockWeathering(config.rocks?.weathering);
    this.oceanDistance = this.coastStoneConfig.enabled
      ? createOceanDistanceField(terrainView, config.shoreLife?.coastalReachMeters ?? 48) : null;
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.prototypeIndicesByAsset = new Map();
    this.prototypeBiomeRules = [];
    this.prototypeIndexForRoll = null;
    // Bumped by every `appendVariants`, so the resident-window key notices a
    // variant that streamed in while the camera stood still.
    this.prototypeRevision = 0;
    this.prototypes = [];
    this.proxyPrototypes = [];
    this.prototypeHeights = [];
    this.prototypeFootprints = [];
    this.meshes = [];
    this.proxyMeshes = [];
    this.placements = [];
    this.placementsByChunk = new Map();
    this.clusterField = null;
    this.signature = '';
    this.manifestBuildBudgetMs = config.streaming?.rockManifestBuildBudgetMs
      ?? config.streaming?.heavyBuildBudgetMs
      ?? 3;
    this.manifestStore = new RockManifestStore(this);
    this.manifestCache = this.manifestStore.cache;
    this.pendingManifestBuilds = this.manifestStore.pending;
    this.manifestFrameTimestamp = null;
    this.prototypeBiomeRulesSignature = '[]';
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.pendingRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    // Instances are written relative to this, not in canonical metres (InstanceAnchor).
    this.instanceAnchor = new InstanceAnchor();
    this.instanceRows = new ScatterInstanceRows('rock', placement => this.placementMatrix(placement),
      placement => this.placementAppearance(placement));
    this.root.name = 'stylized-rocks';
    terrainView.scene.add(this.root);
  }

  /** Sink each boulder by a fraction of its height so it reads as embedded in the ground. */
  placementMatrix(placement) {
    const burial = Math.max(0, Number(this.config.rocks.burial) || 0)
      * (this.prototypeHeights[placement.prototypeIndex] ?? this.prototypeHeight) * placement.scale;
    return new THREE.Matrix4().compose(
      ROCK_SCRATCH.position.set(placement.x, placement.height - burial, placement.z),
      ROCK_SCRATCH.quaternion.setFromAxisAngle(ROCK_UP, placement.rotationY),
      ROCK_SCRATCH.scale.setScalar(placement.scale),
    );
  }

  placementAppearance(placement) {
    const colorRange = Math.max(0, Number(this.config.rocks.colorVariation) || 0);
    return {
      seed: placement.priority,
      colorVariation: 1 - colorRange * 0.5 + placement.priority * colorRange,
      surfaceData: placement.surfaceData,
      biomeLook: biomeLook(this.config.biomeLooks, 'rock', placementTileId(this.terrainView, placement)),
    };
  }

  /**
   * Install more authored rock variants alongside whatever is already resident.
   *
   * Variants stream in as the camera approaches the biomes they belong to, so
   * this is additive: existing prototypes keep their indices and their
   * instances, and only the new ones get renderers.
   */
  appendVariants(authoredVariants = []) {
    return completeIterator(this.appendVariantsJob(authoredVariants));
  }

  *appendVariantsJob(authoredVariants = []) {
    if (!this.config.rocks.enabled || this.disposed || authoredVariants.length === 0) return;
    const firstNewPrototype = this.prototypes.length;
    const extracted = [];
    for (const { scene, definition } of authoredVariants) {
      const firstIndex = firstNewPrototype + extracted.length;
      const variants = yield* iterateAuthoredMeshPrototypes(scene, {
        scale: definition.scale,
        rootNames: definition.rootNames,
      });
      if (variants.length === 0) {
        throw new Error(`Rock variant ${definition.scene} produced no prototypes.`);
      }
      extracted.push(...variants);
      for (let index = 0; index < variants.length; index += 1) {
        this.prototypeBiomeRules.push({
          tileIds: definition.tileIds ?? null,
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
    this.prototypeBiomeRulesSignature = JSON.stringify(this.prototypeBiomeRules);
    const newPrototypes = [];
    for (const { geometry, source } of extracted) {
      const material = createStylizedRockMaterial(source, this.config, this.rockWeathering());
      newPrototypes.push({ geometry, material, kind: 'rock',
        instanceSurface: Boolean(this.rockWeatheringSettings),
        instanceBiomeLook: Boolean(this.rockWeatheringSettings) });
      yield material;
    }
    this.prototypes.push(...newPrototypes);
    // Both fields describe the terrain, not the prop set, so they are built once
    // on the first variant and reused by every one that streams in later.
    this.clusterField ??= new ScatterClusterField({
      kind: 'rock',
      seed: resolveForestSeed(this.terrainView.worldStore),
      seedOffset: ROCK_CLUSTER_SEED_OFFSET,
      heightAt: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      slopeSampleDistance: this.config.trees.habitat?.slopeSampleDistance ?? 4,
      config: this.config.rocks,
    });
    this.clusterField.localRevisionProvider = (x, z) => this.revisionTracker.signature(
      Math.floor(x / this.terrainView.chunkWorldSize), Math.floor(-z / this.terrainView.chunkWorldSize), 1);
    this.clusterField.preparedProvider = (x, z) => this.terrainView.preparedPlacement?.rockNode(x, z, this.clusterField.sampleSpacing);
    this.pathClearance ??= createPathClearanceField(this.terrainView, this.config);

    const settings = lodSettings(this.config);
    const capacity = instanceCapacity({
      residentRadius: settings.proxyRadius + 1,
      perChunk: this.config.rocks.perChunk,
    });
    // These authored meshes are already compact enough for the complete rock
    // residency window. Keeping cloned authored parts in the proxy band avoids
    // reverting to the old textureless dodecahedron in the mid-ground.
    const newProxyPrototypes = [];
    for (const prototype of newPrototypes) {
      const geometry = prototype.geometry.clone();
      yield geometry;
      const material = prototype.material.clone();
      yield material;
      newProxyPrototypes.push([{ geometry, material, kind: 'rock',
        instanceSurface: prototype.instanceSurface, instanceBiomeLook: prototype.instanceBiomeLook }]);
    }
    this.proxyPrototypes.push(...newProxyPrototypes);
    this.prototypeHeights.push(...newPrototypes.map((prototype) => {
      prototype.geometry.computeBoundingBox();
      return Math.max(
        0.1,
        prototype.geometry.boundingBox.max.y - prototype.geometry.boundingBox.min.y,
      );
    }));
    this.prototypeHeight = Math.max(...this.prototypeHeights);
    this.prototypeFootprints.push(...newPrototypes.map(({ geometry }) => Math.max(
      geometry.boundingBox.max.x - geometry.boundingBox.min.x,
      geometry.boundingBox.max.z - geometry.boundingBox.min.z,
    )));
    this.meshes.push(...yield* iterateInstancedRenderers({
      root: this.root,
      partsByPrototype: newPrototypes.map((prototype) => [prototype]),
      renderer: this.terrainView.renderer,
      capacity,
      name: `stylized-rock-near-${firstNewPrototype}`,
      castShadow: true,
    }));
    this.proxyMeshes.push(...yield* iterateInstancedRenderers({
      root: this.root,
      partsByPrototype: newProxyPrototypes,
      renderer: this.terrainView.renderer,
      capacity,
      name: `stylized-rock-proxy-${firstNewPrototype}`,
      castShadow: false,
    }));
    this.prototypeRevision += 1;
  }

  beginFrame(timestamp) {
    if (this.manifestFrameTimestamp === timestamp) return;
    this.manifestFrameTimestamp = timestamp;
    this.manifestStore.flush();
  }

  update(timestamp, camera) {
    this.beginFrame(timestamp);
    if (this.disposed || this.prototypes.length === 0 || !this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.place(this.root, origin);
    const settings = lodSettings(this.config);
    const renderRadius = settings.enabled ? settings.proxyRadius : this.config.rocks.residentRadius;
    const placementRadius = renderRadius + 1;
    const viewportHeight = this.terrainView.viewportHeight
      ?? this.terrainView.renderer.domElement.height ?? 1;
    const planKey = `${focus.chunkX}:${focus.chunkZ}:${this.revisionTracker.revision}:${viewportHeight}:${
      camera.fov}:${camera.zoom}:${this.prototypeRevision}`;
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
    const revisionSignature = this.revisionTracker.windowSignature(focus, placementRadius, 1);
    const updateKey = `${focus.chunkX}:${focus.chunkZ}:${revisionSignature}:${
      plan.signature
    }:${this.biomeAssetPalette?.revision ?? 0}:p${this.prototypeRevision}`;
    if (updateKey === this.lastUpdateKey && !this.pendingRebuild) return;
    this.pendingRebuild = {
      key: `rock-lod:${updateKey}`,
      updateKey,
      focus: { ...focus },
      placementRadius,
      plan,
    };
  }

  applyPendingRebuild(shouldYield = null) {
    return stepViewRebuild(this, this.pendingRebuild, shouldYield,
      job => this.iterateRebuild(job.focus, job.placementRadius, job.plan));
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
      const regionalRocky = this.regionalCharacterField?.sampleChannel(
        candidate.x,
        candidate.z,
        'rocky',
      ) ?? 1;
      if (candidate.priority >= cluster.density * regionalRocky) return null;
      return {
        clusterId: cluster.clusterId,
        rockCoverage: cluster.coverage,
        rockEdge: cluster.edge,
        rockSlope: cluster.slope,
        regionalRocky,
      };
    };
  }

  manifestKey(chunkX, chunkZ) {
    return [
      this.revisionTracker.signature(chunkX, chunkZ, 1),
      this.prototypes.length,
      this.clusterField?.signature ?? 'uniform',
      this.regionalCharacterField?.signature ?? 'uniform-regions',
      this.prototypeBiomeRulesSignature,
      this.pathClearance?.signature ?? 'nopath',
      this.biomeAssetPalette?.revision ?? 0,
      this.riverRocks.signature,
    ].join('|');
  }

  cachedManifestForChunk(chunkX, chunkZ) {
    return this.manifestStore.get(chunkX, chunkZ);
  }

  *resolveGroundPlacements(placements) {
    const heightAt = (x, z) => this.terrainView.getCanonicalHeight(x, z);
    const waterAt = (x, z) => staticWaterContactAt(this.terrainView, x, z);
    const resolved = [];
    for (const placement of placements) {
      yield;
      const footprint = this.prototypeFootprints[placement.prototypeIndex] ?? placement.radius * 2 / placement.scale;
      const fit = fitRockToGround(placement, footprint, heightAt);
      if (!fit) continue;
      resolved.push(Object.freeze({ ...placement, height: fit.groundFitHeight,
        surfaceData: Object.freeze(this.rockWeatheringSettings ? rockWaterContact(placement, footprint, waterAt) : [0, 0, 0]) }));
    }
    return resolved;
  }

  manifestOptions(chunkX, chunkZ) {
    return {
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
      prototypeIndexForRoll: (roll, tileId, x, z) => {
        const automaticIndex = this.prototypeIndexForRoll(roll, tileId, x, z);
        return this.biomeAssetPalette?.resolvePrototypeIndex({
          tileId,
          layerId: 'rocks',
          automaticIndex,
          prototypeIndicesByAsset: this.prototypeIndicesByAsset,
          roll,
        }) ?? automaticIndex;
      },
      minScale: this.config.rocks.minScale,
      maxScale: this.config.rocks.maxScale,
      radiusForScale: (scale) => this.config.rocks.radius * scale,
      candidateEvaluator: this.createCandidateEvaluator(),
    };
  }

  /** Beach pebbles on ground just above the sea in a chunk. */
  coastStonesForChunk(chunkX, chunkZ) {
    const seaLevel = this.terrainView.worldStore?.generator?.seaLevel;
    if (!this.coastStoneConfig.enabled || !Number.isFinite(seaLevel)) return (function* () { return []; })();
    const tileSize = this.terrainView.worldStore.tileSize;
    const options = this.manifestOptions(chunkX, chunkZ);
    return iterateCoastStones({
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize,
      seaLevel,
      heightAt: options.heightAt,
      prototypeIndexForRoll: (roll, x, z) => options.prototypeIndexForRoll(
        roll,
        options.tileAt(Math.floor(x / tileSize), Math.floor(-z / tileSize)),
        x,
        z,
      ),
      radiusForScale: options.radiusForScale,
      config: this.coastStoneConfig,
      coastalDistanceAt: (x, z) => this.oceanDistance.worldDistanceAt(x, z),
    });
  }

  /**
   * The weathering settings, plus the one water level this world has globally.
   *
   * Read at prototype-build time rather than stored, because the sea level arrives
   * with the imported world: a world imported after the view was built would
   * otherwise carry a splash line at whatever the sea was before it.
   */
  rockWeathering() {
    if (!this.rockWeatheringSettings) return null;
    const seaLevel = this.terrainView.worldStore?.generator?.seaLevel;
    return {
      settings: this.rockWeatheringSettings,
      seaLevel: Number.isFinite(seaLevel) ? seaLevel : null,
    };
  }

  /** Boulders sitting on the seabed in a chunk's shallows. */
  seabedRocksForChunk(chunkX, chunkZ) {
    const seaLevel = this.terrainView.worldStore?.generator?.seaLevel;
    if (!this.seabedRockConfig.enabled || !Number.isFinite(seaLevel)) return (function* () { return []; })();
    const tileSize = this.terrainView.worldStore.tileSize;
    const options = this.manifestOptions(chunkX, chunkZ);
    return iterateSeabedRocks({
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize,
      seaLevel,
      heightAt: options.heightAt,
      prototypeIndexForRoll: (roll, x, z) => options.prototypeIndexForRoll(
        roll,
        options.tileAt(Math.floor(x / tileSize), Math.floor(-z / tileSize)),
        x,
        z,
      ),
      radiusForScale: options.radiusForScale,
      config: this.seabedRockConfig,
    });
  }

  /** Bank stones, fall-lip boulders and plunge-pool blocks the rivers place in a chunk. */
  riverbankRocksForChunk(chunkX, chunkZ) {
    const chunkSize = this.terrainView.worldStore.chunkSize;
    const tileSize = this.terrainView.worldStore.tileSize;
    const rivers = this.riverbankConfig.enabled
      ? this.riverRocks.forChunk(chunkX, chunkZ, chunkSize, tileSize)
      : null;
    if (!rivers) return (function* () { return []; })();
    const options = this.manifestOptions(chunkX, chunkZ);
    return iterateRiverbankRocks({
      chunkX,
      chunkZ,
      chunkSize,
      tileSize,
      segments: rivers.segments,
      falls: rivers.falls,
      heightAt: options.heightAt,
      prototypeIndexForRoll: (roll, x, z) => options.prototypeIndexForRoll(
        roll,
        options.tileAt(Math.floor(x / tileSize), Math.floor(-z / tileSize)),
        x,
        z,
      ),
      radiusForScale: options.radiusForScale,
      config: this.riverbankConfig,
    });
  }

  /** Tors and outcrops of scaled-up stones, where the biome grows them (biome-looks `formations`). */
  formationRocksForChunk(chunkX, chunkZ) {
    const share = this.config.biomeLooks?.formations;
    if (!this.formationConfig.enabled || !share?.some((value) => value > 0)) return (function* () { return []; })();
    const tileSize = this.terrainView.worldStore.tileSize;
    const options = this.manifestOptions(chunkX, chunkZ);
    const tileAt = (x, z) => options.tileAt(Math.floor(x / tileSize), Math.floor(-z / tileSize));
    return iterateRockFormations({
      chunkX,
      chunkZ,
      chunkSize: this.terrainView.worldStore.chunkSize,
      tileSize,
      heightAt: options.heightAt,
      seaLevel: this.terrainView.worldStore?.generator?.seaLevel,
      shareAt: (x, z) => share[tileAt(x, z)] ?? 0,
      blocked: this.pathClearance?.enabled ? (x, z) => this.pathClearance.blocks(x, z) : null,
      prototypeIndexForRoll: (roll, x, z) => options.prototypeIndexForRoll(roll, tileAt(x, z), x, z),
      radiusForScale: options.radiusForScale,
      config: this.formationConfig,
    });
  }

  manifestForChunk(chunkX, chunkZ) {
    return this.manifestStore.request(chunkX, chunkZ);
  }

  prepareManifestForChunk(chunkX, chunkZ) {
    return this.manifestStore.request(chunkX, chunkZ);
  }

  *iterateRebuild(focus, placementRadius, plan) {
    PerfCounters.inc('rockRebuilds');
    const job = this.instanceRows.begin();
    const planByChunk = new Map(plan.entries.map((entry) => [`${entry.chunkX}:${entry.chunkZ}`, entry]));

    for (let chunkZ = focus.chunkZ - placementRadius;
      chunkZ <= focus.chunkZ + placementRadius;
      chunkZ += 1) {
      for (let chunkX = focus.chunkX - placementRadius;
        chunkX <= focus.chunkX + placementRadius;
        chunkX += 1) {
        const key = `${chunkX}:${chunkZ}`;
        let manifest;
        while ((manifest = this.manifestForChunk(chunkX, chunkZ)) === null) yield ITERATOR_PENDING;
        yield;
        yield* this.instanceRows.stageChunk(job, key, manifest, drawnRepresentations(planByChunk.get(key)));
      }
    }
    yield* this.instanceRows.stageRetired(job);

    yield;
    const anchorOrigin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.follow(anchorOrigin);
    const counts = this.instanceRows.commit(job, this.meshes, this.proxyMeshes, this.instanceAnchor);
    this.instanceAnchor.place(this.root, anchorOrigin);
    if (counts.manifestsChanged) {
      this.placements = this.instanceRows.placements();
      this.signature = placementSignature(this.placements);
    }
    PerfCounters.set('rockNearInstances', counts.near);
    PerfCounters.set('rockProxyInstances', counts.proxy);
    PerfCounters.set('rockPlacementInstances', this.placements.length);
    return true;
  }

  getPlacements() { return this.placements; }

  blockerSnapshotForChunk(x, z, halo = 1) {
    return this.manifestStore.blockerSnapshot(x, z, halo);
  }

  getBlockersForChunk(x, z, halo = 1) {
    return this.blockerSnapshotForChunk(x, z, halo)?.placements ?? null;
  }

  getPreparedBlockersForChunk(x, z, halo = 1) {
    return this.getBlockersForChunk(x, z, halo);
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
    this.prototypeHeights.length = 0;
    this.prototypeFootprints.length = 0;
    this.oceanDistance?.cache.clear();
    disposePrototypeParts(this.proxyPrototypes);
    this.prototypeIndicesByAsset.clear();
    this.placements.length = 0;
    this.manifestStore.dispose();
    this.manifestCache.clear();
    this.pendingManifestBuilds.clear();
    this.placementsByChunk.clear();
    this.chunkLodStates.clear();
  }
}
