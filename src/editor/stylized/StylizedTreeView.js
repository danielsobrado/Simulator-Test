import { cachedLodPlan } from './lod/CachedLodPlan.js';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { materialList, normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import {
  attachRootCollar,
  extractPrototypeParts,
  extractPrototypePartsFromRoots,
  findPrototypeRoots,
  pivotOnTrunkBase,
  splitDisconnectedTreeParts,
} from './StylizedTreePrototypes.js';
import { resolveAuthoredPrototypeGroups } from './StylizedPrototypeBake.js';
import {
  createAuthoredTrunkMaterial,
  createStylizedLeafMaterial,
  createStylizedTrunkMaterial,
} from './StylizedTreeMaterials.js';
import { resolveBarkWeathering } from './barkWeathering.js';
import {
  FOREST_SPECIES_PALETTES,
  createForestSpeciesPrototypeGeometry,
  createSpeciesPrototypeIndex,
  uncoveredGeneratedSpecies,
} from './forest/ForestSpeciesGeometry.js';
import { createForestLeafTintTable } from './forest/forestLeafTint.js';
import { biomeCanopySnowAt, createCanopySnowResolver, setCanopySnowColor } from './forest/canopySnow.js';
import { createProceduralBarkTextures } from './forest/ProceduralBarkTextures.js';
import { instanceCapacity } from './scatterMath.js';
import { TreeManifestStore } from './TreeManifestStore.js';
import { iterateTreeLod } from './TreeLodAssembler.js';
import { stepViewRebuild } from './StagedViewRebuild.js';
import {
  buildChunkLodPlan,
  createInstancedRenderers,
  disposeInstancedRenderers,
  pruneStateMap,
} from './lod/StylizedLodRuntime.js';
import { InstanceAnchor } from './lod/InstanceAnchor.js';
import { createCameraChunkDistance } from './lod/chunkLodDistance.js';
import {
  createCanopyClusterPart,
  createForestUnderstoryPrototypes,
  createTreeProxyPrototype,
} from './lod/StylizedProxyGeometry.js';
import {
  TreeImpostorAssetLoader,
  disposeTreeImpostorAtlases,
  downloadTreeImpostorBundle,
} from './impostor/TreeImpostorAssets.js';
import { foliageTextureBytes } from './impostor/FoliageKtx2Loader.js';
import { TreeImpostorBaker } from './impostor/TreeImpostorBaker.js';
import { TreeImpostorBatch } from './impostor/TreeImpostorBatch.js';
import { createTreeImpostorSourceSignature } from './impostor/TreeImpostorManifest.js';
import { registerPrototypeIndices } from './BiomeAssetPalette.js';
import { applyCloudShadow } from './CloudShadow.js';
import { applyJungleMist } from './ambient/jungleMistOutput.js';
import { TreeRootFitter } from './forest/TreeRootFitter.js';

function firstMaterial(mesh, name) {
  return materialList(mesh).find((material) => material?.name === name) ?? materialList(mesh)[0];
}

function inferTreeMaterials(scene, definition) {
  if (definition.trunkMaterial && definition.leafMaterial) return definition;
  const names = new Set();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    for (const material of materialList(node)) {
      if (material?.name) names.add(material.name);
    }
  });
  const available = [...names];
  const find = (pattern, excluded = null) => available.find(
    (name) => name !== excluded && pattern.test(name),
  );
  const trunkMaterial = definition.trunkMaterial
    ?? find(/bark|trunk|wood|branch/i)
    ?? available[0];
  const leafMaterial = definition.leafMaterial
    ?? find(/leaf|leaves|foliage|needle|crown/i, trunkMaterial)
    ?? available.find((name) => name !== trunkMaterial);
  if (!trunkMaterial || !leafMaterial) return definition;
  return {
    ...definition,
    trunkMaterial,
    leafMaterial,
    species: definition.species ?? 'broadleaf_round',
  };
}

function configureBarkTexture(texture, colorSpace) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function disposeTextures(textures) {
  for (const texture of textures) texture?.dispose();
}

function lodSettings(config) {
  const tree = config.lod?.tree ?? {};
  const meshRadius = tree.meshRadius ?? config.trees.residentRadius;
  const proxyRadius = Math.max(meshRadius, tree.proxyRadius ?? 3);
  const impostorRadius = Math.max(proxyRadius, tree.impostorRadius ?? 5);
  // `clusterPixels: 0` switches the aggregate far-canopy band off. Its radius has
  // to collapse onto the impostor radius as well, or `clampLodToRadii` still
  // demotes anything past the impostor range to 'cluster' and the band comes back.
  const clusterPixels = tree.clusterPixels ?? 0;
  const clusterRadius = clusterPixels > 0
    ? Math.max(impostorRadius, tree.clusterRadius ?? 8)
    : impostorRadius;
  return Object.freeze({
    enabled: config.lod?.enabled !== false,
    meshRadius,
    proxyRadius,
    impostorRadius,
    clusterRadius,
    forceNearWithinMeshRadius: tree.forceNearWithinMeshRadius === true,
    transitionMs: tree.transitionMs ?? 320,
    thresholds: {
      nearPixels: tree.nearPixels ?? 32,
      proxyPixels: tree.proxyPixels ?? 8,
      impostorPixels: tree.impostorPixels ?? 2,
      clusterPixels,
      hysteresisRatio: tree.hysteresisRatio ?? 0.15,
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

export function shouldScheduleTreeLodRebuild({
  planChanged,
  manifestsBuilt,
  queueRemaining,
  lastRebuildAt,
  timestamp,
  minimumIntervalMs,
}) {
  if (!planChanged && !manifestsBuilt) return false;
  if (!Number.isFinite(lastRebuildAt)) return true;
  if (queueRemaining === 0 && manifestsBuilt) return true;
  return timestamp - lastRebuildAt >= minimumIntervalMs;
}

export class StylizedTreeView {
  constructor({
    terrainView,
    objectMap = null,
    config,
    revisionTracker,
    baseUrl = '/',
    biomeAssetPalette = null,
    regionalCharacterField = null,
    snowBand = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    // Bark moss, rain streaks and snow, resolved once: every trunk in the world
    // shares the settings. The snow band is handed down from the composition root
    // because it lives in the world configuration, and bark has to whiten where the
    // ground under it does.
    this.barkWeatheringSettings = resolveBarkWeathering(config, { snow: snowBand });
    this.revisionTracker = revisionTracker;
    this.objectMap = objectMap;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.biomeAssetPalette = biomeAssetPalette;
    this.regionalCharacterField = regionalCharacterField;
    this.prototypeIndicesByAsset = new Map();
    this.textureLoader = new THREE.TextureLoader();
    this.time = uniform(0);
    this.prototypes = [];
    this.prototypeSignature = null;
    this.impostorFailure = null;
    this.speciesPrototypeIndex = null;
    this.prototypeTileIds = null;
    this.prototypePreferredTileIds = null;
    this.preservePrototypeLeafColor = [];
    this.gradedPrototypeLeaf = [];
    this.leafTints = createForestLeafTintTable({ config });
    // Snow caps per tree: its biome's canopy snow, or the bark's (and ground's)
    // snow band at its height.
    if (config.biomeLooks) setCanopySnowColor(config.biomeLooks.snowColor);
    this.canopySnowByTile = config.biomeLooks?.snow?.canopy ?? null;
    // Placements are stable manifest records, so a tree's blurred biome snow
    // (121 tile reads) is resolved once rather than on every LOD rebuild.
    this.canopySnowCache = new WeakMap();
    this.canopySnow = createCanopySnowResolver({
      snowLine: this.barkWeatheringSettings?.snowBand?.line ?? snowBand?.snowLine,
      snowFade: this.barkWeatheringSettings?.snowBand?.fade ?? snowBand?.snowFade,
    });
    this.proxyPrototypes = [];
    this.renderers = [];
    this.proxyRenderers = [];
    this.fallbackImpostorRenderers = [];
    this.clusterRenderers = [];
    this.understoryRenderers = [];
    this.clusterPrototypes = [];
    this.understoryPrototypes = [];
    this.impostorAtlases = [];
    this.impostorBatches = [];
    this.impostorVersion = 0;
    this.impostorReady = Promise.resolve(null);
    this.textures = [];
    this.manifestStore = null;
    this.chunkLodStates = new Map();
    this.lastUpdateKey = null;
    this.lastLodRebuildAt = Number.NEGATIVE_INFINITY;
    this.lodRebuildIntervalMs = config.streaming?.treeLodRebuildIntervalMs ?? 33;
    this.pendingLodRebuild = null;
    this.disposed = false;
    this.root = new THREE.Group();
    // Instances are written relative to this, not in canonical metres (InstanceAnchor).
    this.instanceAnchor = new InstanceAnchor();
    this.root.name = 'stylized-trees';
    terrainView.scene.add(this.root);
  }

  resolveUrl(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async loadBarkTextures() {
    const results = await Promise.allSettled([
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkColor)),
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkAo)),
      this.textureLoader.loadAsync(this.resolveUrl(this.config.assets.barkHeight)),
    ]);
    const loaded = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure || this.disposed) {
      disposeTextures(loaded);
      if (failure) throw failure.reason;
      return null;
    }

    const [color, ao, height] = loaded;
    configureBarkTexture(color, THREE.SRGBColorSpace);
    configureBarkTexture(ao, THREE.NoColorSpace);
    configureBarkTexture(height, THREE.NoColorSpace);
    this.textures.push(color, ao, height);
    return { color, ao, height };
  }

  /**
   * Alpha card for the crown leaf quads. Clamped rather than repeated: each quad
   * maps the whole card once, so wrapping would only bleed neighbouring leaves
   * across the edge. Returns null when cards are switched off in config.
   */
  async loadFoliageCard() {
    const path = this.config.assets.foliageCard;
    if (!path || !(this.config.trees.cardsPerLobe > 0)) return null;
    const card = await this.textureLoader.loadAsync(this.resolveUrl(path));
    if (this.disposed) {
      card.dispose();
      return null;
    }
    card.wrapS = THREE.ClampToEdgeWrapping;
    card.wrapT = THREE.ClampToEdgeWrapping;
    card.colorSpace = THREE.NoColorSpace;
    card.needsUpdate = true;
    this.textures.push(card);
    return card;
  }

  async buildFromScene(scene, authoredVariants = []) {
    if (!this.config.trees.enabled || !scene || this.disposed) return;
    const textureStart = this.textures.length;
    const [barkResult, foliageResult] = await Promise.allSettled([
      this.loadBarkTextures(),
      this.loadFoliageCard(),
    ]);
    const failure = barkResult.status === 'rejected'
      ? barkResult.reason
      : foliageResult.status === 'rejected'
        ? foliageResult.reason
        : null;
    if (failure) {
      disposeTextures(this.textures.splice(textureStart));
      throw failure;
    }
    const barkTextures = barkResult.value;
    const foliageCard = foliageResult.value;
    if (this.disposed || !barkTextures) return;
    const primaryLeaf = this.config.assets.primaryLeaf;
    const primaryCount = this.appendScenePrototypes(scene, this.config, barkTextures, {
      gradeLeaf: Boolean(primaryLeaf),
      leafGain: primaryLeaf?.gain,
      leafAlphaTest: primaryLeaf?.alphaTest,
    });
    if (primaryCount === 0) {
      throw new Error('No pine prototype contains both configured trunk and leaf materials.');
    }

    const glbPrototypeCount = this.prototypes.length;
    registerPrototypeIndices(
      this.prototypeIndicesByAsset,
      this.config.assets.scene,
      0,
      glbPrototypeCount,
    );
    const additionalPrototypeIndicesBySpecies = new Map();
    const prototypeTileIds = new Map();
    const prototypePreferredTileIds = new Map();
    for (const { scene: variantScene, definition: inputDefinition } of authoredVariants) {
      const definition = inferTreeMaterials(variantScene, inputDefinition);
      const extractionConfig = {
        ...this.config,
        assets: {
          ...this.config.assets,
          leafMaterial: definition.leafMaterial,
          trunkMaterial: definition.trunkMaterial,
        },
      };
      const firstIndex = this.prototypes.length;
      const authoredBarkTextures = definition.barkProfile
        ? createProceduralBarkTextures({
          profile: definition.barkProfile,
          seed: definition.barkSeed,
        })
        : null;
      if (authoredBarkTextures) {
        this.textures.push(
          authoredBarkTextures.albedoHeight,
          authoredBarkTextures.normalRoughness,
        );
      }
      const count = this.appendScenePrototypes(variantScene, extractionConfig, barkTextures, {
        preserveSourceAppearance: true,
        scale: definition.scale,
        authoredBarkTextures,
        authoredBarkScale: definition.barkScale,
        leafGain: definition.leafGain,
        canopyGrade: definition.canopyGrade !== false,
        prototypeGroups: definition.prototypeGroups,
        sourceLabel: `Tree variant ${definition.scene}`,
        pivot: definition.pivot,
      });
      if (count === 0) {
        throw new Error(
          `Tree variant ${definition.scene} contains no upright prototype with its configured materials.`,
        );
      }
      const indices = Array.from({ length: count }, (_, offset) => firstIndex + offset);
      registerPrototypeIndices(
        this.prototypeIndicesByAsset,
        definition.id ?? definition.scene,
        firstIndex,
        count,
      );
      if (definition.tileIds) {
        const tiles = new Set(definition.tileIds);
        for (const index of indices) prototypeTileIds.set(index, tiles);
      }
      if (definition.preferredTileIds) {
        const tiles = new Set(definition.preferredTileIds);
        for (const index of indices) prototypePreferredTileIds.set(index, tiles);
      }
      // One geometry can serve several species. We have three authored broadleaf
      // crowns, not six, so a tropical emergent and a temperate beech share a
      // mesh and are told apart by the species registry's crown aspect, spacing
      // and trunk proportions plus the per-biome canopy hue. Listing the species
      // here is free; a second `scene:` entry would cost another pair of
      // full-capacity InstancedMeshes for identical geometry.
      const speciesIds = Array.isArray(definition.species)
        ? definition.species
        : [definition.species];
      for (const speciesId of speciesIds) {
        const existing = additionalPrototypeIndicesBySpecies.get(speciesId) ?? [];
        additionalPrototypeIndicesBySpecies.set(speciesId, [...existing, ...indices]);
      }
    }
    // Only now is authored coverage known, so only now can the fallback set be
    // decided. With the shipped configuration this generates nothing.
    const generatedFirstIndex = this.prototypes.length;
    const generatedSpeciesIds = this.appendGeneratedSpeciesPrototypes(
      barkTextures,
      foliageCard,
      uncoveredGeneratedSpecies(additionalPrototypeIndicesBySpecies.keys()),
    );
    this.speciesPrototypeIndex = createSpeciesPrototypeIndex({
      glbPrototypeCount,
      excludedPrimaryIndices: this.config.assets.excludePrimaryTreePrototypes ?? [],
      generatedSpeciesIds,
      generatedFirstIndex,
      additionalPrototypeIndicesBySpecies,
    });
    this.prototypeTileIds = prototypeTileIds;
    this.prototypePreferredTileIds = prototypePreferredTileIds;
    this.preservePrototypeLeafColor = this.prototypes.map(parts => parts.some(part =>
      part.kind === 'leaf' && Boolean(part.geometry.getAttribute('color'))));
    this.gradedPrototypeLeaf = this.prototypes.map(parts => parts.some(part =>
      part.kind === 'leaf' && part.material?.userData?.gradedCanopy === true));
    this.prototypeSignature = createTreeImpostorSourceSignature(this.prototypes, this.config);
    this.createRenderResources();
  }

  appendScenePrototypes(
    scene,
    extractionConfig,
    barkTextures,
    {
      preserveSourceAppearance = false,
      // The crown joins the shared canopy grade while its bark stays stylized.
      gradeLeaf = preserveSourceAppearance,
      leafAlphaTest = 0,
      scale = 1,
      authoredBarkTextures = null,
      authoredBarkScale = 0.8,
      leafGain = 1,
      canopyGrade = true,
      prototypeGroups = null,
      sourceLabel = 'Tree prototype',
      pivot = 'bounds',
    } = {},
  ) {
    scene.updateMatrixWorld(true);
    const rootGroups = prototypeGroups
      ? resolveAuthoredPrototypeGroups(scene, prototypeGroups, sourceLabel)
      : scene.children.flatMap(
        (child) => findPrototypeRoots(child, extractionConfig).map((root) => [root]),
    );
    const firstIndex = this.prototypes.length;
    for (const roots of rootGroups) {
      const extracted = roots.length === 1
        ? extractPrototypeParts(roots[0], extractionConfig)
        : extractPrototypePartsFromRoots(roots, extractionConfig);
      if (!extracted) continue;
      const prototypeGroupsForRoot = splitDisconnectedTreeParts(extracted);
      for (const baked of prototypeGroupsForRoot) {
        if (scale !== 1) {
          for (const part of baked) {
            part.geometry.scale(scale, scale, scale);
            part.geometry.computeBoundingBox();
            part.geometry.computeBoundingSphere();
          }
        }
        if (pivot === 'trunk') pivotOnTrunkBase(baked);
        const sway = this.treeSway(baked);
        const parts = baked.map((part) => {
          const source = firstMaterial(
            part.source,
            part.kind === 'leaf'
              ? extractionConfig.assets.leafMaterial
              : extractionConfig.assets.trunkMaterial,
          );
          let sourceMap = null;
          if (source?.map) {
            sourceMap = source.map.clone();
            sourceMap.needsUpdate = true;
            this.textures.push(sourceMap);
          }
          const material = part.kind === 'leaf'
            ? createStylizedLeafMaterial({
              source,
              leafMap: sourceMap,
              bounds: {
                minY: part.geometry.boundingBox.min.y,
                maxY: part.geometry.boundingBox.max.y,
              },
              treeTopY: sway.topY,
              time: this.time,
              config: this.config,
              preserveSourceColor: gradeLeaf,
              alphaTest: leafAlphaTest,
              vertexColor: Boolean(part.geometry.getAttribute('color')),
              leafGain,
              canopyGrade,
            })
            : (preserveSourceAppearance
              ? createAuthoredTrunkMaterial({
                source,
                sourceMap,
                barkTextures: authoredBarkTextures,
                barkScale: authoredBarkScale,
                barkWeathering: this.barkWeatheringSettings,
                barkGrade: this.config.trees.barkGrade,
                sway,
              })
              : createStylizedTrunkMaterial({ textures: barkTextures, config: this.config, sway }));
          return {
            geometry: part.geometry,
            material,
            kind: part.kind,
            sourceMap,
          };
        });
        // Imported variants already include their authored trunk base. The generic
        // collar is sized from all trunk/branch bounds, which can turn a spreading
        // broadleaf into a conspicuous polygonal plinth.
        if (!preserveSourceAppearance) attachRootCollar(parts);
        if (parts.length > 0) this.prototypes.push(this.withCloudShadow(parts));
      }
    }
    return this.prototypes.length - firstIndex;
  }

  /** Bark and crown bend about the ground through the tree's full height. */
  treeSway(parts) {
    let topY = 0.001;
    for (const { geometry } of parts) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      topY = Math.max(topY, geometry.boundingBox.max.y);
    }
    return { time: this.time, config: this.config, topY };
  }

  /**
   * Last-resort geometry for species no authored variant covers — a custom
   * preset naming a species its GLBs do not supply, for instance. These append
   * after both the source-GLB conifers and the authored variants, so they are
   * always the tail of the prototype range.
   *
   * Returns the species it actually generated, which may be empty.
   */
  appendGeneratedSpeciesPrototypes(barkTextures, foliageCard, speciesIds) {
    if (speciesIds.length === 0) return [];
    const generated = createForestSpeciesPrototypeGeometry(speciesIds, {
      cardsPerLobe: foliageCard ? this.config.trees.cardsPerLobe : 0,
      cardScale: this.config.trees.cardScale,
    });
    for (const prototype of generated) {
      const palette = FOREST_SPECIES_PALETTES[prototype.speciesId] ?? null;
      const sway = this.treeSway(prototype.parts);
      const parts = prototype.parts.map((part) => ({
        geometry: part.geometry,
        kind: part.kind,
        sourceMap: part.card ? foliageCard : null,
        material: part.kind === 'leaf'
          ? createStylizedLeafMaterial({
            source: null,
            // Only the card part is cut; the lobes stay solid so the canopy keeps
            // an interior and does not go see-through.
            leafMap: part.card ? foliageCard : null,
            alphaTest: part.card ? this.config.trees.cardAlphaTest : 0,
            bounds: {
              minY: part.geometry.boundingBox.min.y,
              maxY: part.geometry.boundingBox.max.y,
            },
            treeTopY: sway.topY,
            time: this.time,
            config: this.config,
            palette,
          })
          : createStylizedTrunkMaterial({
            textures: barkTextures,
            config: this.config,
            palette,
            sway,
          }),
      }));
      // No attachRootCollar here: these prototypes already carry a root flare,
      // and the collar it merges is indexed while these are de-indexed.
      this.prototypes.push(this.withCloudShadow(parts));
    }
    return generated.map((prototype) => prototype.speciesId);
  }

  /** Parts whose materials take cloud shadows and jungle mist; the LOD clones inherit both. */
  withCloudShadow(parts) {
    for (const part of parts) {
      applyCloudShadow(part.material, this.config.sky);
      applyJungleMist(part.material, this.config.ambientEffects);
    }
    return parts;
  }

  createRenderResources() {
    const settings = lodSettings(this.config);
    const acceptedPerChunk = Math.max(
      this.config.trees.perChunk,
      Math.trunc(this.config.trees.habitat?.maxAcceptedPerChunk) || 0,
    );
    // Each band is sized to its own radius around the camera. `clampLodToRadii`
    // limits 'near' to meshRadius and 'proxy' to proxyRadius; the extra ring
    // accommodates transitions as the camera crosses chunk boundaries. Thus
    // sizing every renderer for the impostor window (as this used to) wasted
    // several times the instance memory — which matters now that the accepted
    // budget is high enough for closed forest.
    const capacityFor = (radius) => instanceCapacity({
      residentRadius: radius + 1,
      perChunk: acceptedPerChunk,
    });
    const nearCapacity = capacityFor(settings.meshRadius);
    const proxyCapacity = capacityFor(settings.proxyRadius);
    const impostorCapacity = capacityFor(settings.impostorRadius);
    const proxies = this.prototypes.map((parts) => createTreeProxyPrototype(parts, this.config));
    this.proxyPrototypes = proxies.map((prototype) => this.withCloudShadow(prototype.proxyParts));
    this.prototypeHeight = Math.max(...proxies.map((prototype) => prototype.height));
    this.prototypeWidth = Math.max(...proxies.map((prototype) => prototype.width));
    this.renderers = createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: this.prototypes,
      capacity: nearCapacity,
      name: 'stylized-pine-near',
      castShadow: true,
      tintLeaves: true,
    });
    this.proxyRenderers = createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: this.proxyPrototypes,
      capacity: proxyCapacity,
      name: 'stylized-pine-proxy',
      castShadow: false,
      tintLeaves: true,
    });
    this.fallbackImpostorRenderers = createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: this.proxyPrototypes,
      capacity: impostorCapacity,
      name: 'stylized-pine-impostor-fallback',
      castShadow: false,
      tintLeaves: true,
    });
    // Skipped outright when the band is off rather than left empty: the renderer
    // sizes itself for the cluster radius, so an unreachable band still cost about
    // a megabyte of instance buffers.
    this.clusterPrototypes = settings.thresholds.clusterPixels > 0
      ? [this.withCloudShadow([createCanopyClusterPart(this.config)])]
      : [];
    this.clusterRenderers = createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: this.clusterPrototypes,
      capacity: capacityFor(settings.clusterRadius),
      name: 'stylized-canopy-cluster',
      castShadow: false,
      tintLeaves: true,
    });
    this.understoryPrototypes = createForestUnderstoryPrototypes(this.config).map(parts => this.withCloudShadow(parts));
    this.understoryRenderers = createInstancedRenderers({
      root: this.root,
      renderer: this.terrainView.renderer,
      partsByPrototype: this.understoryPrototypes,
      // Deadwood is emitted from the near band only.
      capacity: nearCapacity,
      name: 'stylized-forest-understory',
      castShadow: false,
    });
    const rootFitter = new TreeRootFitter({
      parts: this.prototypes,
      sampleHeight: (x, z) => this.terrainView.getCanonicalHeight(x, z),
      settings: this.config.trees.rootFit ?? { enabled: false },
      resolvePrototypeIndex: placement => this.resolvePalettePrototypeIndex(placement),
    });
    this.manifestStore = new TreeManifestStore({
      fitPlacement: placement => rootFitter.fit(placement),
      terrainView: this.terrainView,
      config: this.config,
      revisionTracker: this.revisionTracker,
      prototypeCount: this.prototypes.length,
      prototypeIndexBySpecies: this.speciesPrototypeIndex ?? null,
      prototypeTileIds: this.prototypeTileIds ?? null,
      prototypePreferredTileIds: this.prototypePreferredTileIds ?? null,
      objectMap: this.objectMap,
      regionalCharacterField: this.regionalCharacterField,
      onBuilt: () => {
        // Newly built manifests need a follow-up LOD write; the update loop
        // detects `manifestFlush.built > 0` and enqueues one budgeted rebuild.
      },
    });
    this.impostorReady = this.initializeImpostors(impostorCapacity).catch((error) => {
      this.impostorFailure = error.message;
      console.warn('Tree impostor initialization failed; low-poly proxy fallback remains active.', error);
      return null;
    });
  }

  async initializeImpostors(capacity) {
    const settings = this.config.lod?.impostor;
    if (!settings?.enabled || this.disposed) return null;
    const forceBake = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('bakeImpostors') === '1';
    const loader = new TreeImpostorAssetLoader({
      baseUrl: this.baseUrl,
      renderer: this.terrainView.renderer,
      compressed: settings.compressed !== false && (typeof location === 'undefined'
        || new URLSearchParams(location.search).get('impostorCompression') !== '0'),
      expectedPrototypeCount: this.prototypes.length,
      expectedSourceSignature: this.prototypeSignature,
    });
    let atlases = forceBake ? null : await loader.load(settings.manifest).catch((error) => {
      this.impostorFailure = error.message;
      console.warn(settings.runtimeBake !== false
        ? 'Tree impostor assets could not be loaded; runtime bake will be attempted.'
        : 'Tree impostor assets could not be loaded; low-poly proxy fallback remains active.', error);
      return null;
    });
    if (!atlases && (forceBake || settings.runtimeBake !== false)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      atlases = await new TreeImpostorBaker({
        renderer: this.terrainView.renderer,
        config: this.config,
      }).bake(this.prototypes);
    }
    if (!atlases) return null;
    if (this.disposed) {
      disposeTreeImpostorAtlases(atlases);
      return null;
    }

    this.impostorAtlases = [...atlases];
    this.impostorFailure = null;
    this.impostorBatches = this.impostorAtlases.map((atlas) => new TreeImpostorBatch({
      renderer: this.terrainView.renderer,
      scene: this.terrainView.scene,
      atlas,
      capacity,
      name: `stylized-pine-impostor-${atlas.prototypeIndex}`,
      ambientEffects: this.config.ambientEffects,
      gpuCulling: this.config.lod?.gpuCulling?.enabled !== false,
      auxiliaryViews: this.config.enhancements?.waterReflections?.enabled === true,
    }));
    for (const batch of this.impostorBatches) {
      applyCloudShadow(batch.batch.material, this.config.sky);
      if (batch.auxiliary) applyCloudShadow(batch.auxiliary.material, this.config.sky);
    }
    this.impostorVersion += 1;
    this.lastUpdateKey = null;
    PerfCounters.set('treeImpostorAtlasBytes', this.impostorAtlases.reduce((total, atlas) => (
      total + foliageTextureBytes(atlas.albedo) + foliageTextureBytes(atlas.normal)
    ), 0));
    PerfCounters.set('treeImpostorCompressedAtlases', this.impostorAtlases.filter(atlas => atlas.albedo.isCompressedTexture).length);
    return this.impostorAtlases;
  }

  update(timestamp, camera, rockSource = null) {
    this.time.value = timestamp / 1000;
    if (this.disposed || !this.manifestStore || !this.terrainView.focusChunkKey || !camera) return;
    const focus = this.terrainView.focusChunk;
    const origin = this.terrainView.floatingOrigin.getState();
    this.instanceAnchor.place(this.root, origin);
    const settings = lodSettings(this.config);
    const radius = settings.enabled ? settings.clusterRadius : this.config.trees.residentRadius;
    const viewportHeight = this.terrainView.viewportHeight
      ?? this.terrainView.renderer.domElement.height ?? 1;
    const planKey = `${focus.chunkX}:${focus.chunkZ}:${this.revisionTracker.revision}:${
      this.manifestStore.version ?? 0}:${viewportHeight}:${camera.fov}:${camera.zoom}:${this.impostorVersion}`;
    const plan = cachedLodPlan(this, planKey, timestamp,
      Math.min(this.lodRebuildIntervalMs, settings.transitionMs / 8), () => settings.enabled
      ? buildChunkLodPlan({
        focus,
        radius: radius + 1,
        chunkWorldSize: this.terrainView.chunkWorldSize,
        floatingOrigin: this.terrainView.floatingOrigin,
        camera,
        viewportHeight,
        objectHeight: this.prototypeHeight,
        thresholds: settings.thresholds,
        radii: settings,
        transitionStates: this.chunkLodStates,
        timestamp,
        transitionMs: settings.transitionMs,
        positionForChunk: (chunkX, chunkZ) => this.manifestStore.lodAnchor(chunkX, chunkZ),
        distanceForChunk: createCameraChunkDistance(camera, origin, this.terrainView.chunkWorldSize),
        onTransition: ({ from, to, durationMs }) => {
          this.terrainView.postProcessing?.notifyReactive(
            from === 'impostor' || to === 'impostor'
              ? 'IMPOSTOR_TRANSITION'
              : 'VEGETATION_LOD_CHANGED',
            Math.ceil(durationMs / (1000 / 60)),
          );
        },
      })
      : {
        entries: this.createNearOnlyPlan(focus, radius),
        signature: `near:${focus.chunkX}:${focus.chunkZ}:${radius}`,
      });
    if (this.previousPlan !== plan) pruneStateMap(this.chunkLodStates, plan.entries);
    const revision = this.revisionTracker.windowSignature(focus, radius + 1, 1);
    // Per-chunk rock blockers live in TreeManifestStore — do not use a global
    // rock signature that would rebuild every tree band when far rocks stream.
    const key = `${focus.chunkX}:${focus.chunkZ}:${revision}:${plan.signature}:${
      this.impostorVersion
    }:${this.biomeAssetPalette?.revision ?? 0}`;

    const rockVersion = rockSource?.manifestStore?.version;
    if (this.previousPlan !== plan || rockVersion === undefined || rockVersion !== this.previousRockVersion) {
      for (const entry of plan.entries) {
        const visible = entry.representations.some((value) => (
          value.band !== 'culled' && value.fade > 0
        ));
        if (!visible) continue;
        if (!this.manifestStore.get(entry.chunkX, entry.chunkZ, rockSource)) {
          this.manifestStore.schedule(entry.chunkX, entry.chunkZ, rockSource);
        }
      }
      this.manifestStore.setActive(new Set(
        plan.entries.map((entry) => `${entry.chunkX}:${entry.chunkZ}`),
      ));
      this.previousPlan = plan;
      this.previousRockVersion = rockVersion;
    }
    const manifestFlush = this.manifestStore.flush();

    if (shouldScheduleTreeLodRebuild({
      planChanged: key !== this.lastUpdateKey,
      manifestsBuilt: manifestFlush.completed > 0,
      queueRemaining: manifestFlush.remaining,
      lastRebuildAt: this.lastLodRebuildAt,
      timestamp,
      minimumIntervalMs: this.lodRebuildIntervalMs,
    })) {
      // Defer heavy instance writes to the budgeted tree build queue.
      this.pendingLodRebuild = {
        key: `tree-lod:${key}`,
        updateKey: key,
        focus: { ...focus },
        plan,
        rockSource,
        timestamp,
      };
    }

    const submitted = { cpu: 0, gpu: 0 };
    const known = { cpu: true, gpu: true };
    // One encoder for every species; each `compute` call otherwise costs its own.
    const renderer = this.terrainView.renderer;
    const computeQueue = typeof renderer?.compute === 'function' ? [] : null;
    for (const batch of this.impostorBatches) {
      const result = batch.update(camera, origin, timestamp, computeQueue);
      if (Number.isFinite(result.submitted)) {
        submitted[result.mode] += result.submitted;
      } else {
        known[result.mode] = false;
      }
    }
    if (computeQueue?.length) renderer.compute(computeQueue);
    for (const mode of ['cpu', 'gpu']) {
      PerfCounters.set(`treeImpostorSubmittedKnown.${mode}`, known[mode] ? 1 : 0);
      if (known[mode]) PerfCounters.set(`treeImpostorSubmitted.${mode}`, submitted[mode]);
    }
  }

  applyPendingRebuild(shouldYield = null) {
    const job = this.pendingLodRebuild;
    const completed = stepViewRebuild(this, job, shouldYield, job => iterateTreeLod({
      plan: job.plan,
      anchor: this.instanceAnchor,
      beforePublish: () => {
        const origin = this.terrainView.floatingOrigin.getState();
        this.instanceAnchor.follow(origin);
        this.instanceAnchor.place(this.root, origin);
      },
      rockSource: job.rockSource,
      manifestStore: this.manifestStore,
      prototypeCount: this.prototypes.length,
      prototypeWidth: this.prototypeWidth,
      prototypeHeight: this.prototypeHeight,
      impostorAtlases: this.impostorAtlases,
      impostorBatches: this.impostorBatches,
      renderers: this.renderers,
      proxyRenderers: this.proxyRenderers,
      fallbackImpostorRenderers: this.fallbackImpostorRenderers,
      clusterRenderers: this.clusterRenderers,
      understoryRenderers: this.understoryRenderers,
      resolveLeafTint: (record) => this.resolveLeafTint(record),
      resolveLeafSnow: (record) => this.resolveLeafSnow(record),
      resolvePrototypeIndex: (placement) => this.resolvePalettePrototypeIndex(placement),
    }), 'pendingLodRebuild');
    if (completed) this.lastLodRebuildAt = performance.now();
    return completed;
  }

  /** Canonical tile under a placement, in the same convention the scatter uses. */
  tileIdAt(x, z) {
    const tileSize = this.terrainView.worldStore.tileSize;
    return this.terrainView.tileMap.get(
      Math.floor(x / tileSize),
      Math.floor(-z / tileSize),
    );
  }

  /**
   * Per-instance canopy hue. A turned grove keeps its autumn colour; everything
   * else takes the hue of the biome it stands in, which is what makes a taiga
   * read differently from a rainforest when both draw the same authored crown.
   */
  resolveLeafTint(record) {
    const prototypeIndex = this.resolvePalettePrototypeIndex(record);
    return this.leafTints.tintFor(
      record.speciesId,
      record.groveSeed ?? 0,
      this.tileIdAt(record.x, record.z),
      this.preservePrototypeLeafColor[prototypeIndex] ?? false,
      this.gradedPrototypeLeaf?.[prototypeIndex] ?? false,
    );
  }

  /** Per-instance canopy snow (forest/canopySnow.js), cached per record. */
  resolveLeafSnow(record) {
    let snow = this.canopySnowCache.get(record);
    if (snow !== undefined) return snow;
    const tileSize = this.terrainView.worldStore.tileSize;
    const biome = biomeCanopySnowAt(
      this.canopySnowByTile,
      (cellX, cellZ) => this.terrainView.tileMap.get(cellX, cellZ),
      Math.floor(record.x / tileSize),
      Math.floor(-record.z / tileSize),
    );
    snow = this.canopySnow(biome, record.height, record.groveSeed ?? record.priority);
    this.canopySnowCache.set(record, snow);
    return snow;
  }

  resolvePalettePrototypeIndex(placement) {
    if (!this.biomeAssetPalette) return placement.prototypeIndex;
    const tileId = this.tileIdAt(placement.x, placement.z);
    return this.biomeAssetPalette.resolvePrototypeIndex({
      tileId,
      layerId: 'trees',
      automaticIndex: placement.prototypeIndex,
      prototypeIndicesByAsset: this.prototypeIndicesByAsset,
      roll: placement.priority,
    });
  }

  createNearOnlyPlan(focus, radius) {
    const entries = [];
    for (let z = focus.chunkZ - radius; z <= focus.chunkZ + radius; z += 1) {
      for (let x = focus.chunkX - radius; x <= focus.chunkX + radius; x += 1) {
        entries.push({
          chunkX: x,
          chunkZ: z,
          chunkDistance: Math.max(Math.abs(x - focus.chunkX), Math.abs(z - focus.chunkZ)),
          representations: [{ band: 'near', fade: 1 }],
        });
      }
    }
    return entries;
  }

  async exportImpostors() {
    await this.impostorReady;
    if (this.impostorAtlases.length === 0) {
      throw new Error('No runtime-baked tree impostors are available to export.');
    }
    return downloadTreeImpostorBundle(this.impostorAtlases, this.prototypeSignature);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.terrainView.scene.remove(this.root);
    disposeInstancedRenderers(this.root, this.renderers);
    disposeInstancedRenderers(this.root, this.proxyRenderers);
    disposeInstancedRenderers(this.root, this.fallbackImpostorRenderers);
    disposeInstancedRenderers(this.root, this.clusterRenderers);
    disposeInstancedRenderers(this.root, this.understoryRenderers);
    for (const batch of this.impostorBatches) batch.dispose();
    disposeTreeImpostorAtlases(this.impostorAtlases);
    disposePrototypeParts(this.prototypes);
    disposePrototypeParts(this.proxyPrototypes);
    disposePrototypeParts(this.clusterPrototypes);
    disposePrototypeParts(this.understoryPrototypes);
    this.prototypeIndicesByAsset.clear();
    this.textures.forEach((texture) => texture.dispose());
    this.manifestStore?.dispose();
    this.chunkLodStates.clear();
  }
}
