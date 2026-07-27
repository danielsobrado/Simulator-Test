import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import {
  treeColorVariation,
  treeLeanAngles,
  treeMorphology,
  treeRenderSeed,
} from './forest/TreeAppearance.js';
import { aggregateCanopyClusters } from './lod/canopyCluster.js';
import { writeInstances } from './lod/StylizedLodRuntime.js';

const UNTINTED = Object.freeze([1, 1, 1]);

function createInstances(count) {
  return Array.from({ length: count }, () => []);
}

const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchEuler = new THREE.Euler();

function createMatrix({
  x,
  y,
  z,
  rotationX = 0,
  rotationY = 0,
  rotationZ = 0,
  scaleX = 1,
  scaleY = scaleX,
  scaleZ = scaleX,
}) {
  return new THREE.Matrix4().compose(
    scratchPosition.set(x, y, z),
    scratchQuaternion.setFromEuler(scratchEuler.set(rotationX, rotationY, rotationZ)),
    scratchScale.set(scaleX, scaleY, scaleZ),
  );
}

function recordBatchStats(statsByMode, stats) {
  const target = statsByMode[stats.mode];
  target.requested += stats.requested;
  target.accepted += stats.accepted;
  target.dropped += stats.dropped;
}

function leafAppearance(placement, resolveLeafTint) {
  const tint = resolveLeafTint?.(placement) ?? UNTINTED;
  const morphology = treeMorphology(placement);
  return {
    morphology,
    colorVariation: treeColorVariation(placement),
    leafTint: tint,
    impostorAppearance: [
      morphology[0],
      tint[0],
      tint[1],
      tint[2],
    ],
  };
}

function geometryInstance(placement, fade, ditherDirection, resolveLeafTint) {
  const heightScale = placement.heightScale ?? placement.scale;
  const appearance = leafAppearance(placement, resolveLeafTint);
  const lean = treeLeanAngles(placement);
  return {
    matrix: createMatrix({
      x: placement.x,
      y: placement.height,
      z: placement.z,
      rotationX: lean.rotationX,
      rotationY: placement.rotationY,
      rotationZ: lean.rotationZ,
      scaleX: heightScale,
      scaleY: heightScale,
      scaleZ: heightScale,
    }),
    fade,
    ditherDirection,
    seed: treeRenderSeed(placement),
    colorVariation: appearance.colorVariation,
    leafTint: appearance.leafTint,
    morphology: appearance.morphology,
  };
}

function impostorRecord(placement, atlas, fade, ditherDirection, resolveLeafTint) {
  const heightScale = placement.heightScale ?? placement.scale;
  const appearance = leafAppearance(placement, resolveLeafTint);
  const seed = treeRenderSeed(placement);
  return {
    x: placement.x,
    y: placement.height + (atlas.centerY ?? atlas.height * 0.5) * heightScale,
    z: placement.z,
    scale: heightScale,
    radius: atlas.radius * heightScale * Math.max(1, appearance.impostorAppearance[0]),
    yaw: placement.rotationY,
    fade: fade * ditherDirection,
    seed,
    appearance: appearance.impostorAppearance,
    speciesId: placement.speciesId,
    ageClass: placement.ageClass,
    crownAspect: placement.crownAspect,
    colorSeed: placement.colorSeed,
    windPhase: seed,
  };
}

export function selectTreePhysicalRepresentation({ band, hasImpostor }) {
  if (band === 'impostor') return hasImpostor ? 'impostor' : 'fallback';
  return band;
}

export function rebuildTreeLod({
  plan,
  rockSource,
  manifestStore,
  prototypeCount,
  prototypeWidth,
  prototypeHeight,
  impostorAtlases,
  impostorBatches,
  renderers,
  proxyRenderers,
  fallbackImpostorRenderers,
  clusterRenderers,
  understoryRenderers = [],
  resolveLeafTint = null,
  resolvePrototypeIndex = null,
}) {
  PerfCounters.inc('treeRebuilds');
  const near = createInstances(prototypeCount);
  const proxy = createInstances(prototypeCount);
  const fallback = createInstances(prototypeCount);
  const clusters = [[]];
  const impostors = createInstances(prototypeCount);
  const understory = createInstances(1);
  const active = new Set();
  const ordered = [...plan.entries].sort((left, right) => (
    left.chunkDistance - right.chunkDistance
    || left.chunkZ - right.chunkZ
    || left.chunkX - right.chunkX
  ));

  for (const entry of ordered) {
    const visible = entry.representations.some((value) => (
      value.band !== 'culled' && value.fade > 0
    ));
    if (!visible) continue;
    const key = `${entry.chunkX}:${entry.chunkZ}`;
    active.add(key);
    const placements = manifestStore.getOrSchedule(entry.chunkX, entry.chunkZ, rockSource);
    if (!placements) continue;

    for (const representation of entry.representations) {
      if (representation.band === 'culled' || representation.fade <= 0) continue;
      const ditherDirection = representation.ditherDirection ?? 1;
      if (representation.band === 'cluster') {
        const minimumWidth = prototypeWidth * 1.6;
        const minimumHeight = prototypeHeight * 0.55;
        const aggregate = manifestStore.canopyAggregate?.(
          entry.chunkX,
          entry.chunkZ,
          minimumWidth,
          minimumHeight,
        ) ?? null;
        const patchClusters = aggregate?.clusters ?? aggregateCanopyClusters({
          chunkX: entry.chunkX,
          chunkZ: entry.chunkZ,
          placements,
          minimumWidth,
          minimumHeight,
        });
        for (const cluster of patchClusters) {
          clusters[0].push({
            matrix: createMatrix({
              x: cluster.x,
              y: cluster.y,
              z: cluster.z,
              rotationY: cluster.seed * Math.PI * 2,
              scaleX: cluster.width,
              scaleY: cluster.height,
              scaleZ: cluster.depth,
            }),
            fade: representation.fade,
            ditherDirection,
            seed: cluster.seed,
            colorVariation: 0.9 + cluster.seed * 0.2,
            leafTint: resolveLeafTint?.(cluster),
          });
        }
        const emergent = aggregate?.emergent ?? (() => {
          const emergentCount = Math.max(0, Math.round(placements.length * 0.04));
          return [...placements]
            .sort((left, right) => (
              (right.heightScale ?? right.scale) - (left.heightScale ?? left.scale)
              || left.stableId.localeCompare(right.stableId)
            ))
            .slice(0, emergentCount);
        })();
        for (const placement of emergent) {
          const prototypeIndex = resolvePrototypeIndex?.(placement)
            ?? placement.prototypeIndex;
          const atlas = impostorAtlases[prototypeIndex];
          const batch = impostorBatches[prototypeIndex];
          if (atlas && batch) {
            impostors[prototypeIndex].push(impostorRecord(
              placement,
              atlas,
              representation.fade,
              ditherDirection,
              resolveLeafTint,
            ));
          } else {
            fallback[prototypeIndex].push(geometryInstance(
              placement,
              representation.fade,
              ditherDirection,
              resolveLeafTint,
            ));
          }
        }
        continue;
      }

      for (const placement of placements) {
        const prototypeIndex = resolvePrototypeIndex?.(placement)
          ?? placement.prototypeIndex;
        const seed = treeRenderSeed(placement);
        if (representation.band === 'near' && placement.ageClass === 'dead') {
          understory[0].push({
            matrix: createMatrix({
              x: placement.x,
              y: placement.height,
              z: placement.z,
              rotationY: placement.rotationY,
              scaleX: 0.8 + placement.scale * 0.2,
            }),
            fade: representation.fade,
            ditherDirection,
            seed,
            colorVariation: 0.82 + (placement.colorSeed ?? seed) * 0.16,
          });
        }

        if (representation.band === 'impostor') {
          const atlas = impostorAtlases[prototypeIndex];
          const batch = impostorBatches[prototypeIndex];
          const physical = selectTreePhysicalRepresentation({
            band: representation.band,
            hasImpostor: Boolean(atlas && batch),
          });
          if (physical === 'impostor') {
            impostors[prototypeIndex].push(impostorRecord(
              placement,
              atlas,
              representation.fade,
              ditherDirection,
              resolveLeafTint,
            ));
          } else {
            fallback[prototypeIndex].push(geometryInstance(
              placement,
              representation.fade,
              ditherDirection,
              resolveLeafTint,
            ));
          }
          continue;
        }

        const instance = geometryInstance(
          placement,
          representation.fade,
          ditherDirection,
          resolveLeafTint,
        );
        const target = representation.band === 'near' ? near : proxy;
        target[prototypeIndex].push(instance);
      }
    }
  }

  manifestStore.setActive(active);
  const nearCount = writeInstances(renderers, near);
  const proxyCount = writeInstances(proxyRenderers, proxy);
  const fallbackCount = writeInstances(fallbackImpostorRenderers, fallback);
  const clusterCount = writeInstances(clusterRenderers, clusters);
  const understoryCount = writeInstances(understoryRenderers, understory);
  const requestedGeometryInstances = [near, proxy, fallback, clusters, understory]
    .flat()
    .reduce((total, records) => total + records.length, 0);
  const writtenGeometryInstances = nearCount + proxyCount + fallbackCount
    + clusterCount + understoryCount;
  PerfCounters.set(
    'forestInstancesDroppedByCapacity',
    Math.max(0, requestedGeometryInstances - writtenGeometryInstances),
  );
  let impostorCount = 0;
  const statsByMode = {
    cpu: { requested: 0, accepted: 0, dropped: 0 },
    gpu: { requested: 0, accepted: 0, dropped: 0 },
  };
  for (let index = 0; index < impostorBatches.length; index += 1) {
    const records = impostors[index] ?? [];
    const stats = impostorBatches[index].setRecords(records);
    recordBatchStats(statsByMode, stats);
    impostorCount += stats.accepted;
  }
  for (const mode of ['cpu', 'gpu']) {
    PerfCounters.set(`treeImpostorRecordsRequested.${mode}`, statsByMode[mode].requested);
    PerfCounters.set(`treeImpostorRecordsAccepted.${mode}`, statsByMode[mode].accepted);
    PerfCounters.set(`treeImpostorRecordsDropped.${mode}`, statsByMode[mode].dropped);
  }
  PerfCounters.set('treeNearInstances', nearCount);
  PerfCounters.set('treeProxyInstances', proxyCount);
  PerfCounters.set('treeImpostorInstances', impostorCount);
  PerfCounters.set('treeFallbackImpostorInstances', fallbackCount);
  PerfCounters.set('treeCanopyClusters', clusterCount);
  PerfCounters.set('forestUnderstoryInstances', understoryCount);
}
