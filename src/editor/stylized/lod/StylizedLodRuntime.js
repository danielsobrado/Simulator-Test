import * as THREE from 'three/webgpu';
import {
  clampLodToRadii,
  projectedPixelHeight,
  quantizeFade,
  selectProjectedLod,
  updateLodTransition,
} from './projectedLod.js';
import { createDitheredMaterial } from './StylizedDitheredMaterial.js';
import { markAttributeSubrangeUpdated } from '../attributeUpload.js';
import { PerfCounters } from '../../performance/qa/PerfCounters.js';

const WAITING_FADE = Number.EPSILON;
const UNTINTED = Object.freeze([1, 1, 1]);
const IDENTITY_MORPHOLOGY = Object.freeze([1, 1, 1]);

function createGeometry(source, capacity, tinted, morphed) {
  const geometry = source.clone();
  geometry.setAttribute(
    'instanceLodFade',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'instanceLodDitherDirection',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1),
  );
  geometry.setAttribute(
    'instanceStableSeed',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1),
  );
  geometry.setAttribute(
    'instanceColorVariation',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1),
  );
  if (morphed) {
    geometry.setAttribute(
      'instanceMorphology',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3),
    );
  }
  if (tinted) {
    geometry.setAttribute(
      'instanceLeafTint',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3),
    );
  }
  return geometry;
}

export function createInstancedRenderers({
  root,
  partsByPrototype,
  capacity,
  name,
  castShadow,
  tintLeaves = false,
}) {
  return partsByPrototype.map((parts, prototypeIndex) => parts.map((part, partIndex) => {
    const tinted = tintLeaves && part.kind === 'leaf';
    const morphed = tintLeaves;
    const geometry = createGeometry(part.geometry, capacity, tinted, morphed);
    const material = createDitheredMaterial(part.material, {
      tinted,
      kind: morphed ? part.kind : null,
    });
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

function resetDirtyRange(range) {
  range.min = Infinity;
  range.max = -1;
  return range;
}

function widenDirtyRange(range, index) {
  if (index < range.min) range.min = index;
  if (index > range.max) range.max = index;
}

function writeScalarInstance(attribute, index, value, range) {
  if (attribute.array[index] === value) return;
  attribute.array[index] = value;
  widenDirtyRange(range, index);
}

function writeVector3Instance(attribute, index, value, range) {
  const array = attribute.array;
  const offset = index * 3;
  if (
    array[offset] === value[0]
    && array[offset + 1] === value[1]
    && array[offset + 2] === value[2]
  ) return;
  array[offset] = value[0];
  array[offset + 1] = value[1];
  array[offset + 2] = value[2];
  widenDirtyRange(range, index);
}

function writeMatrixInstance(attribute, index, matrix, range) {
  const array = attribute.array;
  const offset = index * 16;
  const elements = matrix.elements;
  for (let element = 0; element < 16; element += 1) {
    if (array[offset + element] !== elements[element]) {
      array.set(elements, offset);
      widenDirtyRange(range, index);
      return;
    }
  }
}

const MATRIX_RANGE = { min: Infinity, max: -1 };
const FADE_RANGE = { min: Infinity, max: -1 };
const DIRECTION_RANGE = { min: Infinity, max: -1 };
const SEED_RANGE = { min: Infinity, max: -1 };
const COLOR_RANGE = { min: Infinity, max: -1 };
const TINT_RANGE = { min: Infinity, max: -1 };
const MORPHOLOGY_RANGE = { min: Infinity, max: -1 };

export function writeInstances(renderers, instancesByPrototype) {
  let total = 0;
  renderers.forEach((parts, prototypeIndex) => {
    const instances = instancesByPrototype[prototypeIndex] ?? [];
    for (const mesh of parts) {
      const capacity = mesh.instanceMatrix.count;
      const writableCount = Math.min(instances.length, capacity);
      const dropped = instances.length - writableCount;
      if (dropped > 0) PerfCounters.inc('stylizedInstancesDroppedByCapacity', dropped);
      const previousCount = mesh.count;
      mesh.count = writableCount;
      const fades = mesh.geometry.getAttribute('instanceLodFade');
      const directions = mesh.geometry.getAttribute('instanceLodDitherDirection');
      const seeds = mesh.geometry.getAttribute('instanceStableSeed');
      const colors = mesh.geometry.getAttribute('instanceColorVariation');
      const tints = mesh.geometry.getAttribute('instanceLeafTint');
      const morphologies = mesh.geometry.getAttribute('instanceMorphology');
      const matrixRange = resetDirtyRange(MATRIX_RANGE);
      const fadeRange = resetDirtyRange(FADE_RANGE);
      const directionRange = resetDirtyRange(DIRECTION_RANGE);
      const seedRange = resetDirtyRange(SEED_RANGE);
      const colorRange = resetDirtyRange(COLOR_RANGE);
      const tintRange = resetDirtyRange(TINT_RANGE);
      const morphologyRange = resetDirtyRange(MORPHOLOGY_RANGE);
      for (let index = 0; index < writableCount; index += 1) {
        const instance = instances[index];
        writeMatrixInstance(mesh.instanceMatrix, index, instance.matrix, matrixRange);
        writeScalarInstance(fades, index, instance.fade, fadeRange);
        writeScalarInstance(
          directions,
          index,
          instance.ditherDirection ?? 1,
          directionRange,
        );
        writeScalarInstance(seeds, index, instance.seed, seedRange);
        if (colors) {
          writeScalarInstance(colors, index, instance.colorVariation ?? 1, colorRange);
        }
        if (tints) {
          writeVector3Instance(tints, index, instance.leafTint ?? UNTINTED, tintRange);
        }
        if (morphologies) {
          writeVector3Instance(
            morphologies,
            index,
            instance.morphology ?? IDENTITY_MORPHOLOGY,
            morphologyRange,
          );
        }
      }
      markAttributeSubrangeUpdated(mesh.instanceMatrix, matrixRange.min, matrixRange.max);
      markAttributeSubrangeUpdated(fades, fadeRange.min, fadeRange.max);
      markAttributeSubrangeUpdated(directions, directionRange.min, directionRange.max);
      markAttributeSubrangeUpdated(seeds, seedRange.min, seedRange.max);
      if (colors) markAttributeSubrangeUpdated(colors, colorRange.min, colorRange.max);
      if (tints) markAttributeSubrangeUpdated(tints, tintRange.min, tintRange.max);
      if (morphologies) {
        markAttributeSubrangeUpdated(
          morphologies,
          morphologyRange.min,
          morphologyRange.max,
        );
      }
      if (matrixRange.max >= 0 || writableCount !== previousCount) {
        mesh.computeBoundingSphere();
      }
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

function waitingState(target, timestamp) {
  return {
    from: 'culled',
    target,
    startedAt: timestamp,
    complete: false,
    waitingForData: true,
    representations: Object.freeze([
      Object.freeze({ band: 'culled', fade: 1, ditherDirection: -1 }),
      Object.freeze({ band: target, fade: WAITING_FADE, ditherDirection: 1 }),
    ]),
  };
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
  const needsReadyAnchor = typeof positionForChunk === 'function';

  for (let chunkZ = focus.chunkZ - radius; chunkZ <= focus.chunkZ + radius; chunkZ += 1) {
    for (let chunkX = focus.chunkX - radius; chunkX <= focus.chunkX + radius; chunkX += 1) {
      const chunkDistance = Math.max(Math.abs(chunkX - focus.chunkX), Math.abs(chunkZ - focus.chunkZ));
      const anchor = positionForChunk?.(chunkX, chunkZ) ?? null;
      const ready = !needsReadyAnchor || anchor !== null;
      const canonicalX = anchor?.x ?? (chunkX + 0.5) * chunkWorldSize;
      const canonicalZ = anchor?.z ?? -(chunkZ + 0.5) * chunkWorldSize;
      const worldHeight = objectHeight * Math.max(0.05, anchor?.heightScale ?? 1);
      const worldPosition = {
        x: canonicalX - origin.x,
        y: (anchor?.y ?? 0) + worldHeight * 0.5,
        z: canonicalZ - origin.z,
      };
      const pixels = projectedPixelHeight({
        camera,
        worldPosition,
        worldHeight,
        viewportHeight,
      });
      const key = `${chunkX}:${chunkZ}`;
      const storedState = transitionStates.get(key) ?? null;
      const previous = storedState?.target ?? null;
      const selected = selectProjectedLod({ pixels, previous, ...thresholds });
      const target = clampLodToRadii({ band: selected, chunkDistance, ...radii });
      let state;
      if (!ready && target !== 'culled') {
        state = waitingState(target, timestamp);
      } else {
        state = updateLodTransition({
          state: storedState?.waitingForData ? null : storedState,
          target,
          timestamp,
          durationMs: transitionMs,
        });
      }
      transitionStates.set(key, state);
      entries.push({
        chunkX,
        chunkZ,
        chunkDistance,
        band: target,
        ready,
        representations: state.representations,
        lodAnchor: Object.freeze({ x: canonicalX, y: anchor?.y ?? 0, z: canonicalZ }),
      });
      signature.push([
        key,
        target,
        ready ? 'ready' : 'waiting',
        ...state.representations.map((representation) => (
          `${representation.band}:${quantizeFade(representation.fade, fadeSteps)}:$
{representation.ditherDirection}`
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
