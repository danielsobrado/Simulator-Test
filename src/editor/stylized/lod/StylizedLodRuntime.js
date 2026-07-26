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

function createGeometry(source, capacity, tinted) {
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
  if (tinted) {
    geometry.setAttribute(
      'instanceLeafTint',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3),
    );
  }
  return geometry;
}

/**
 * `tintLeaves` opts the leaf parts of every prototype into a per-instance hue.
 * Trunks are deliberately excluded — a grove's autumn tint belongs to its canopy.
 */
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
    const geometry = createGeometry(part.geometry, capacity, tinted);
    const material = createDitheredMaterial(part.material, { tinted });
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

/**
 * Lowest and highest instance index whose data actually changed. `max < min` means
 * the attribute is untouched and needs no upload.
 */
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

/** Scalar writer's vec3 counterpart, for the per-instance leaf tint. */
function writeTintInstance(attribute, index, tint, range) {
  const array = attribute.array;
  const offset = index * 3;
  if (
    array[offset] === tint[0]
    && array[offset + 1] === tint[1]
    && array[offset + 2] === tint[2]
  ) return;
  array[offset] = tint[0];
  array[offset + 1] = tint[1];
  array[offset + 2] = tint[2];
  widenDirtyRange(range, index);
}

/** Equivalent to `setMatrixAt`, but skips the write when the matrix is unchanged. */
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

// Reused across calls so a rebuild allocates nothing here.
const MATRIX_RANGE = { min: Infinity, max: -1 };
const FADE_RANGE = { min: Infinity, max: -1 };
const SEED_RANGE = { min: Infinity, max: -1 };
const COLOR_RANGE = { min: Infinity, max: -1 };
const TINT_RANGE = { min: Infinity, max: -1 };
const UNTINTED = Object.freeze([1, 1, 1]);

/**
 * Write instance data, uploading only what changed.
 *
 * Rebuilds are usually triggered by an LOD cross-fade, which changes `fade` for the
 * transitioning chunks and leaves every matrix byte-identical. Re-uploading the
 * whole buffer on each of those cost hundreds of kilobytes per rebuild and showed up
 * as hitches whose phase timers were all cheap, because the upload lands
 * asynchronously between frames. Instances are written in chunk order, so a single
 * chunk's change stays a tight contiguous range.
 */
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
      const seeds = mesh.geometry.getAttribute('instanceStableSeed');
      const colors = mesh.geometry.getAttribute('instanceColorVariation');
      const tints = mesh.geometry.getAttribute('instanceLeafTint');
      const matrixRange = resetDirtyRange(MATRIX_RANGE);
      const fadeRange = resetDirtyRange(FADE_RANGE);
      const seedRange = resetDirtyRange(SEED_RANGE);
      const colorRange = resetDirtyRange(COLOR_RANGE);
      const tintRange = resetDirtyRange(TINT_RANGE);
      for (let index = 0; index < writableCount; index += 1) {
        const instance = instances[index];
        writeMatrixInstance(mesh.instanceMatrix, index, instance.matrix, matrixRange);
        writeScalarInstance(fades, index, instance.fade, fadeRange);
        writeScalarInstance(seeds, index, instance.seed, seedRange);
        if (colors) {
          writeScalarInstance(colors, index, instance.colorVariation ?? 1, colorRange);
        }
        if (tints) {
          writeTintInstance(tints, index, instance.leafTint ?? UNTINTED, tintRange);
        }
      }
      markAttributeSubrangeUpdated(mesh.instanceMatrix, matrixRange.min, matrixRange.max);
      markAttributeSubrangeUpdated(fades, fadeRange.min, fadeRange.max);
      markAttributeSubrangeUpdated(seeds, seedRange.min, seedRange.max);
      if (colors) markAttributeSubrangeUpdated(colors, colorRange.min, colorRange.max);
      if (tints) markAttributeSubrangeUpdated(tints, tintRange.min, tintRange.max);
      // The bounding sphere depends on the matrices and on how many are drawn.
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
