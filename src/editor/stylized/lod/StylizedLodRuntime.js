import * as THREE from 'three/webgpu';
import {
  clampLodToRadii,
  projectedPixelHeight,
  quantizeFade,
  selectProjectedLod,
  updateLodTransition,
} from './projectedLod.js';
import { createDitheredMaterial } from './StylizedDitheredMaterial.js';
import { markInstancedMeshRangeUpdated } from '../attributeUpload.js';
import { PerfCounters } from '../../performance/qa/PerfCounters.js';

function createGeometry(source, capacity) {
  const geometry = source.clone();
  geometry.setAttribute(
    'instanceLodFade',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'instanceStableSeed',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'instanceColorVariation',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1),
  );
  return geometry;
}

export function createInstancedRenderers({ root, partsByPrototype, capacity, name, castShadow }) {
  return partsByPrototype.map((parts, prototypeIndex) => parts.map((part, partIndex) => {
    const geometry = createGeometry(part.geometry, capacity);
    const material = createDitheredMaterial(part.material);
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.count = 0;
    mesh.castShadow = Boolean(castShadow && part.kind !== 'leaf');
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.name = `${name}-${prototypeIndex}-${partIndex}`;
    root.add(mesh);
    return mesh;
  }));
}

export function writeInstances(renderers, instancesByPrototype) {
  let total = 0;
  renderers.forEach((parts, prototypeIndex) => {
    const instances = instancesByPrototype[prototypeIndex] ?? [];
    for (const mesh of parts) {
      const capacity = mesh.instanceMatrix.count;
      const writableCount = Math.min(instances.length, capacity);
      const dropped = instances.length - writableCount;
      if (dropped > 0) PerfCounters.inc('stylizedInstancesDroppedByCapacity', dropped);
      mesh.count = writableCount;
      const fades = mesh.geometry.getAttribute('instanceLodFade');
      const seeds = mesh.geometry.getAttribute('instanceStableSeed');
      const colors = mesh.geometry.getAttribute('instanceColorVariation');
      for (let index = 0; index < writableCount; index += 1) {
        const instance = instances[index];
        mesh.setMatrixAt(index, instance.matrix);
        fades.array[index] = instance.fade;
        seeds.array[index] = instance.seed;
        if (colors) colors.array[index] = instance.colorVariation ?? 1;
      }
      markInstancedMeshRangeUpdated(
        mesh,
        writableCount,
        [fades, seeds, colors].filter(Boolean),
      );
      mesh.computeBoundingSphere();
    }
    total += Math.min(
      instances.length,
      parts[0]?.instanceMatrix.count ?? instances.length,
    );
  });
  return total;
}

export function disposeInstancedRenderers(root, renderers) {
  for (const parts of renderers) {
    for (const mesh of parts) {
      root.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }
  renderers.length = 0;
}

export function buildChunkLodPlan({
  focus,
  radius,
  chunkWorldSize,
  floatingOrigin,
  camera,
  viewportHeight,
  objectHeight,
  thresholds,
  radii,
  transitionStates,
  timestamp,
  transitionMs,
  fadeSteps = 8,
  positionForChunk = null,
}) {
  const entries = [];
  const signature = [];
  const origin = floatingOrigin.getState();

  for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
    for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
      const chunkDistance = Math.max(Math.abs(chunkX - focus.chunkX), Math.abs(chunkZ - focus.chunkZ));
      const anchor = positionForChunk?.(chunkX, chunkZ) ?? null;
      const canonicalX = anchor?.x ?? (chunkX + 0.5) * chunkWorldSize;
      const canonicalZ = anchor?.z ?? -(chunkZ + 0.5) * chunkWorldSize;
      const worldPosition = {
        x: canonicalX - origin.x,
        y: (anchor?.y ?? 0) + objectHeight * 0.5,
        z: canonicalZ - origin.z,
      };
      const pixels = projectedPixelHeight({
        camera,
        worldPosition,
        worldHeight: objectHeight,
        viewportHeight,
      });
      const key = `${chunkX}:${chunkZ}`;
      const previous = transitionStates.get(key)?.target ?? null;
      const selected = selectProjectedLod({ pixels, previous, ...thresholds });
      const target = clampLodToRadii({ band: selected, chunkDistance, ...radii });
      const state = updateLodTransition({
        state: transitionStates.get(key) ?? null,
        target,
        timestamp,
        durationMs: transitionMs,
      });
      transitionStates.set(key, state);
      entries.push({
        chunkX,
        chunkZ,
        chunkDistance,
        band: target,
        representations: state.representations,
        lodAnchor: Object.freeze({ x: canonicalX, y: anchor?.y ?? 0, z: canonicalZ }),
      });
      signature.push([
        key,
        target,
        ...state.representations.map((representation) => (
          `${representation.band}:${quantizeFade(representation.fade, fadeSteps)}`
        )),
      ].join(':'));
    }
  }

  return { entries, signature: signature.join('|') };
}

export function pruneStateMap(states, entries) {
  const active = new Set(entries.map((entry) => `${entry.chunkX}:${entry.chunkZ}`));
  for (const key of states.keys()) {
    if (!active.has(key)) states.delete(key);
  }
}
