import {
  authoredCollisionProxyForGeometry,
  releaseAuthoredCollisionProxy,
} from '../../stylized/StylizedPrototypeBake.js';
import { createMeshColliderPrototype } from '../mesh/MeshColliderPrototype.js';
import { createRockCollisionProxy } from './RockCollisionProxy.js';
import { prototypeCollisionKeys } from './PrototypeCollisionKeys.js';
import {
  deriveRockCollisionProfiles,
  rockCollisionProfileSignature,
} from './RockCollisionProfiles.js';
import { ROCK_COLLISION_SIGNATURE_SCALE } from './RockCollisionConstants.js';

const EMPTY_PLACEMENTS = Object.freeze([]);
const EMPTY_PROFILES = Object.freeze([]);

function quantize(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * ROCK_COLLISION_SIGNATURE_SCALE);
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function mix(hash, value) {
  return Math.imul(hash ^ (value >>> 0), 0x01000193) >>> 0;
}

export function rockCollisionPlacementSignature(placements) {
  let accumulator = 0;
  let count = 0;
  for (const placement of placements) {
    let hash = hashText(placement.stableId);
    hash = mix(hash, quantize(placement.x));
    hash = mix(hash, quantize(placement.z));
    hash = mix(hash, quantize(placement.height));
    hash = mix(hash, quantize(placement.rotationY));
    hash = mix(hash, quantize(placement.scale));
    hash = mix(hash, placement.prototypeIndex ?? 0);
    accumulator = (accumulator + hash) >>> 0;
    count += 1;
  }
  return `${count}:${accumulator.toString(16).padStart(8, '0')}`;
}

function sourceEpoch(rockView) {
  return [
    rockView.revisionTracker?.revision ?? 0,
    rockView.prototypeRevision ?? 0,
    rockView.biomeAssetPalette?.revision ?? 0,
    rockView.pathClearance?.signature ?? 'path:unknown',
    rockView.clusterField?.signature ?? 'cluster:unknown',
    rockView.regionalCharacterField?.signature ?? 'regions:unknown',
  ].join(':');
}

function prototypeId(profile) {
  return `rock-walkable:${encodeURIComponent(profile.id)}`;
}

export function createRockCollisionSource({ rockView, config }) {
  if (!rockView || !Array.isArray(rockView.prototypes)
      || typeof rockView.manifestForChunk !== 'function') {
    throw new Error('Rock collision source requires a stylized rock view.');
  }

  let observedPrototypeRevision = -1;
  let profiles = EMPTY_PROFILES;
  let profileSignature = 'profiles:empty';
  const meshPrototypes = new Map();

  function ensureProfiles() {
    const revision = rockView.prototypeRevision ?? 0;
    if (revision === observedPrototypeRevision && profiles.length === rockView.prototypes.length) {
      return profiles;
    }
    if (rockView.prototypes.length === 0) {
      profiles = EMPTY_PROFILES;
      profileSignature = 'profiles:empty';
      observedPrototypeRevision = revision;
      return profiles;
    }
    const prototypeKeys = prototypeCollisionKeys({
      prototypeCount: rockView.prototypes.length,
      prototypeIndicesByAsset: rockView.prototypeIndicesByAsset,
    });
    const nextProfiles = deriveRockCollisionProfiles({
      prototypes: rockView.prototypes,
      prototypeKeys,
      config,
    });
    const nextSignature = rockCollisionProfileSignature(nextProfiles);
    profiles = nextProfiles;
    profileSignature = nextSignature;
    observedPrototypeRevision = revision;
    return profiles;
  }

  function ensureWalkablePrototype(prototypeIndex, world) {
    if (!world?.registerPrototype) {
      throw new Error('Walkable rock collision requires a collision world.');
    }
    const currentProfiles = ensureProfiles();
    const profile = currentProfiles[prototypeIndex];
    const visual = rockView.prototypes[prototypeIndex]?.geometry;
    if (!profile || !visual) {
      throw new Error(`Walkable rock collision prototype ${prototypeIndex} is unavailable.`);
    }
    const id = prototypeId(profile);
    const cached = meshPrototypes.get(id);
    if (cached) return world.registerPrototype(cached);

    const authored = authoredCollisionProxyForGeometry(visual);
    const proxy = createRockCollisionProxy({
      visualGeometry: visual,
      authoredGeometry: authored?.geometry ?? null,
      config,
      prototypeId: profile.id,
      allowGenerated: config.allowGeneratedProxyFallback,
    });
    let descriptor;
    try {
      descriptor = createMeshColliderPrototype({
        id,
        geometry: proxy.geometry,
        maximumTriangles: config.maximumProxyTriangles,
        maxLeafTriangles: config.bvhMaxLeafTriangles,
        metadata: {
          source: 'rock',
          assetKey: profile.id,
          proxyNode: authored?.name ?? null,
          generated: proxy.generated,
          overlap: proxy.overlap,
        },
      });
    } finally {
      proxy.geometry.dispose();
    }
    meshPrototypes.set(id, descriptor);
    if (authored) releaseAuthoredCollisionProxy(visual);
    return world.registerPrototype(descriptor);
  }

  function meshPrototypeStatus() {
    let triangles = 0;
    let generated = 0;
    for (const prototype of meshPrototypes.values()) {
      triangles += prototype.resource?.triangleCount ?? 0;
      if (prototype.metadata.generated) generated += 1;
    }
    return Object.freeze({ count: meshPrototypes.size, triangles, generated });
  }

  return Object.freeze({
    descriptor: Object.freeze({ id: 'production-rock-collision' }),
    getProfiles: () => ensureProfiles(),
    getCachedProfileCount: () => profiles.length,
    getProfileSignature() {
      ensureProfiles();
      return profileSignature;
    },
    getMeshPrototype: ensureWalkablePrototype,
    getMeshPrototypeStatus: meshPrototypeStatus,
    epoch() {
      ensureProfiles();
      return `${sourceEpoch(rockView)}:${profileSignature}`;
    },
    resolvePrototypeIndex: (placement) => placement.prototypeIndex,
    burialFor(placement, profile) {
      const scale = placement.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`Rock placement ${placement.stableId} has an invalid burial scale.`);
      }
      const burialFraction = Math.max(0, Number(rockView.config?.rocks?.burial) || 0);
      const prototypeHeight = rockView.prototypeHeights?.[placement.prototypeIndex]
        ?? profile.height;
      return prototypeHeight * scale * burialFraction;
    },
    snapshotChunk(chunkX, chunkZ) {
      const currentProfiles = ensureProfiles();
      if (currentProfiles.length === 0) {
        return Object.freeze({
          chunkX,
          chunkZ,
          signature: `empty:${observedPrototypeRevision}`,
          placements: EMPTY_PLACEMENTS,
        });
      }
      const placements = rockView.manifestForChunk(chunkX, chunkZ);
      return Object.freeze({
        chunkX,
        chunkZ,
        signature: `${profileSignature}|${rockCollisionPlacementSignature(placements)}`,
        placements,
      });
    },
    dispose() {
      for (const prototype of meshPrototypes.values()) prototype.resource?.dispose?.();
      meshPrototypes.clear();
      for (const prototype of rockView.prototypes) {
        releaseAuthoredCollisionProxy(prototype.geometry);
      }
    },
  });
}
