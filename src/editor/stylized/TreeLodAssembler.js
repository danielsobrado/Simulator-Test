import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { hash32 } from './scatterMath.js';
import { aggregateCanopyClusters } from './lod/canopyCluster.js';
import { writeInstances } from './lod/StylizedLodRuntime.js';

function createInstances(count) {
  return Array.from({ length: count }, () => []);
}

function stableSeed(placement) {
  if (Number.isFinite(placement.priority)) return placement.priority;
  return hash32(placement.index ?? 0) / 0xffffffff;
}

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
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotationX, rotationY, rotationZ)),
    new THREE.Vector3(scaleX, scaleY, scaleZ),
  );
}

function recordBatchStats(statsByMode, stats) {
  const target = statsByMode[stats.mode];
  target.requested += stats.requested;
  target.accepted += stats.accepted;
  target.dropped += stats.dropped;
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
}) {
  PerfCounters.inc('treeRebuilds');
  const near = createInstances(prototypeCount);
  const proxy = createInstances(prototypeCount);
  const fallback = createInstances(prototypeCount);
  const clusters = [[]];
  const impostors = createInstances(prototypeCount);
  const understory = createInstances(2);
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
      if (representation.band === 'cluster') {
        const patchClusters = aggregateCanopyClusters({
          chunkX: entry.chunkX,
          chunkZ: entry.chunkZ,
          placements,
          minimumWidth: prototypeWidth * 1.6,
          minimumHeight: prototypeHeight * 0.55,
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
            seed: cluster.seed,
            colorVariation: 0.9 + cluster.seed * 0.2,
          });
        }
        const emergentCount = Math.max(0, Math.round(placements.length * 0.04));
        const emergent = [...placements]
          .sort((left, right) => (
            (right.heightScale ?? right.scale) - (left.heightScale ?? left.scale)
            || left.stableId.localeCompare(right.stableId)
          ))
          .slice(0, emergentCount);
        for (const placement of emergent) {
          const atlas = impostorAtlases[placement.prototypeIndex];
          if (!atlas || !impostorBatches[placement.prototypeIndex]) continue;
          impostors[placement.prototypeIndex].push({
            x: placement.x,
            y: placement.height + (atlas.centerY ?? atlas.height * 0.5) * placement.scale,
            z: placement.z,
            scale: placement.scale,
            radius: atlas.radius * placement.scale,
            yaw: placement.rotationY,
            fade: representation.fade,
            seed: placement.windSeed ?? stableSeed(placement),
            speciesId: placement.speciesId,
            ageClass: placement.ageClass,
            crownAspect: placement.crownAspect,
            colorSeed: placement.colorSeed,
            windPhase: placement.windSeed,
          });
        }
        continue;
      }

      for (const placement of placements) {
        const seed = stableSeed(placement);
        if (representation.band === 'near') {
          if (placement.ageClass === 'sapling' && placement.forestPatchEdge > 0.35) {
            const angle = seed * Math.PI * 2;
            understory[0].push({
              matrix: createMatrix({
                x: placement.x + Math.cos(angle) * 1.2,
                y: placement.height,
                z: placement.z + Math.sin(angle) * 1.2,
                rotationY: angle,
                scaleX: 0.65 + (placement.crownScale ?? 1) * 0.25,
              }),
              fade: representation.fade,
              seed,
              colorVariation: 0.9 + (placement.colorSeed ?? seed) * 0.2,
            });
          }
          if (placement.ageClass === 'dead') {
            understory[1].push({
              matrix: createMatrix({
                x: placement.x,
                y: placement.height,
                z: placement.z,
                rotationY: placement.rotationY,
                scaleX: 0.8 + placement.scale * 0.2,
              }),
              fade: representation.fade,
              seed,
              colorVariation: 0.82 + (placement.colorSeed ?? seed) * 0.16,
            });
          }
        }
        if (representation.band === 'impostor' && impostorBatches.length > 0) {
          const atlas = impostorAtlases[placement.prototypeIndex];
          const batch = impostorBatches[placement.prototypeIndex];
          if (atlas && batch) {
            impostors[placement.prototypeIndex].push({
              x: placement.x,
              y: placement.height + (atlas.centerY ?? atlas.height * 0.5) * placement.scale,
              z: placement.z,
              scale: placement.scale,
              radius: atlas.radius * placement.scale,
              yaw: placement.rotationY,
              fade: representation.fade,
              seed,
              speciesId: placement.speciesId,
              ageClass: placement.ageClass,
              crownAspect: placement.crownAspect,
              colorSeed: placement.colorSeed,
              windPhase: placement.windSeed,
            });
            continue;
          }
        }

        const instance = {
          matrix: createMatrix({
            x: placement.x,
            y: placement.height,
            z: placement.z,
            rotationY: placement.rotationY,
            scaleX: (placement.heightScale ?? placement.scale) * (placement.crownScale ?? 1),
            scaleY: placement.heightScale ?? placement.scale,
            scaleZ: (placement.heightScale ?? placement.scale) * (placement.crownScale ?? 1),
          }),
          fade: representation.fade,
          seed,
          colorVariation: 0.9 + (placement.colorSeed ?? seed) * 0.2,
        };
        const target = representation.band === 'near' ? near : proxy;
        target[placement.prototypeIndex].push(instance);
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
    impostorCount += records.length;
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
