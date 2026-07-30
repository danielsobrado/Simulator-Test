import {
  deriveTreeCollisionProfiles,
  treeCollisionProfileSignature,
} from './TreeCollisionProfiles.js';
import { COLLISION_BUILD_DEFERRED } from '../CollisionBuildResult.js';
import { TREE_COLLISION_SIGNATURE_SCALE } from './TreeCollisionConstants.js';
import { prototypeCollisionKeys } from './PrototypeCollisionKeys.js';

function quantize(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * TREE_COLLISION_SIGNATURE_SCALE);
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

export function treeCollisionPlacementSignature(placements) {
  let accumulator = 0;
  let count = 0;
  for (const placement of placements) {
    let hash = hashText(placement.stableId);
    hash = mix(hash, quantize(placement.x));
    hash = mix(hash, quantize(placement.z));
    hash = mix(hash, quantize(placement.height));
    hash = mix(hash, quantize(placement.rotationY));
    hash = mix(hash, quantize(placement.scale));
    hash = mix(hash, quantize(placement.heightScale ?? placement.scale));
    hash = mix(hash, placement.prototypeIndex ?? 0);
    hash = mix(hash, hashText(placement.speciesId));
    hash = mix(hash, hashText(placement.ageClass));
    accumulator = (accumulator + hash) >>> 0;
    count += 1;
  }
  return `${count}:${accumulator.toString(16).padStart(8, '0')}`;
}

function sourceEpoch(treeView, rockSource) {
  const manifestStore = treeView.manifestStore;
  return [
    treeView.revisionTracker?.revision ?? 0,
    manifestStore?.editStore?.revision ?? 0,
    manifestStore?.pathClearance?.signature ?? 'path:unknown',
    manifestStore?.forestField?.signature ?? 'forest:uniform',
    manifestStore?.speciesRegistry?.signature ?? 'species:unknown',
    treeView.objectMap?.revision ?? 0,
    treeView.biomeAssetPalette?.revision ?? 0,
    treeView.prototypeSignature ?? 'prototype:unknown',
    rockSource?.prototypeRevision ?? 0,
  ].join(':');
}

export function createTreeCollisionSource({ treeView, rockSource = null, config }) {
  if (!treeView?.manifestStore || !Array.isArray(treeView.prototypes)) {
    throw new Error('Tree collision source requires initialized tree prototypes and manifests.');
  }
  const prototypeKeys = prototypeCollisionKeys({
    prototypeCount: treeView.prototypes.length,
    prototypeIndicesByAsset: treeView.prototypeIndicesByAsset,
  });
  const profiles = deriveTreeCollisionProfiles({
    prototypes: treeView.prototypes,
    prototypeKeys,
    config,
  });
  const profileSignature = treeCollisionProfileSignature(profiles);
  const manifestStore = treeView.manifestStore;

  return Object.freeze({
    descriptor: Object.freeze({
      id: 'production-tree-trunks',
      profileCount: profiles.length,
      profileSignature,
    }),
    profiles,
    profileSignature,
    minimumTrunkRadius: config.minimumTrunkRadius,
    epoch: () => sourceEpoch(treeView, rockSource),
    resolvePrototypeIndex: (placement) => treeView.resolvePalettePrototypeIndex(placement),
    snapshotChunk(chunkX, chunkZ) {
      let placements = manifestStore.get(chunkX, chunkZ, rockSource);
      if (!placements) placements = manifestStore.build(chunkX, chunkZ, rockSource);
      if (!placements) return COLLISION_BUILD_DEFERRED;
      const context = manifestStore.context(chunkX, chunkZ, rockSource);
      if (!context) return COLLISION_BUILD_DEFERRED;
      return Object.freeze({
        chunkX,
        chunkZ,
        signature: `${context.signature}|${treeCollisionPlacementSignature(placements)}`,
        placements,
      });
    },
  });
}
