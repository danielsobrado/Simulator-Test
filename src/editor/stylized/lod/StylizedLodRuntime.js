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
import { extendInstanceBounds } from './InstanceBoundsUpdate.js';
import { NEUTRAL_BIOME_LOOK } from '../../biomes/BiomeLooks.js';
import { instanceGeometryArrays } from './instanceGeometryArrays.js';
import { completeIterator } from '../ResumableIterator.js';

const WAITING_FADE = Number.EPSILON;
const UNTINTED = Object.freeze([1, 1, 1]);
const LEAF_TINT = [1, 1, 1, 0];
const TRUNK_MORPHOLOGY = [0, 1, 1];
const IDENTITY_MORPHOLOGY = Object.freeze([1, 1, 1]);
const LOD_WORLD_POSITION = { x: 0, y: 0, z: 0 };

/**
 * WebGPU allows a pipeline only 8 vertex buffers, and every non-interleaved attribute
 * costs one. A tree leaf part already spends seven — position, normal, uv, the instance
 * matrix, morphology, leaf tint — so the three per-instance scalars share a single vec3
 * rather than taking a buffer each. Exceeding the limit does not degrade gracefully: the
 * pipeline fails to create and the mesh disappears entirely.
 *
 * x = signed LOD fade, y = stable dither seed, z = colour variation.
 */
function createGeometry(source, capacity, tinted, morphed, surface, plantMotion, reuseVertexArrays, biomeLook) {
  const geometry = reuseVertexArrays ? instanceGeometryArrays(source) : source.clone();
  const dither = new Float32Array(capacity * 3);
  // Colour variation is a multiplier, so it must default to 1 rather than 0.
  for (let index = 0; index < capacity; index += 1) dither[index * 3 + 2] = 1;
  geometry.setAttribute('instanceDither', new THREE.InstancedBufferAttribute(dither, 3));
  if (plantMotion) geometry.setAttribute('instancePlantRoot',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  if (surface) geometry.setAttribute('instanceSurface',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  // rgb = biome albedo multiplier, w = rock moss or understory saturation (biomes/BiomeLooks.js).
  if (biomeLook) geometry.setAttribute('instanceBiomeLook',
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4).fill(1), 4));
  if (morphed) {
    geometry.setAttribute(
      'instanceMorphology',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3),
    );
  }
  if (tinted) {
    // rgb = leaf tint (a multiplier, so it defaults to 1), w = canopy snow
    // (forest/canopySnow.js), which shares the buffer rather than taking one.
    const tint = new Float32Array(capacity * 4).fill(1);
    for (let index = 0; index < capacity; index += 1) tint[index * 4 + 3] = 0;
    geometry.setAttribute('instanceLeafTint', new THREE.InstancedBufferAttribute(tint, 4));
  }
  return geometry;
}

export function treeMorphologyPivotY(geometry, kind) {
  if (kind !== 'leaf') return 0;
  geometry.computeBoundingBox();
  // Scaling around local zero drags every shortened crown toward the ground.
  // Its authored lower edge is the stable attachment point to the trunk.
  return Number.isFinite(geometry.boundingBox?.min.y)
    ? geometry.boundingBox.min.y
    : 0;
}

function crownBounds(geometry) {
  const box = geometry.boundingBox;
  return box && !box.isEmpty() ? { min: box.min.toArray(), max: box.max.toArray() } : null;
}

export function treeMorphologyPivot(parts, part) {
  const pivotY = treeMorphologyPivotY(part.geometry, part.kind);
  const center = treeMorphologyCenter(parts);
  return { x: center.x, y: pivotY, z: center.z };
}

function treeMorphologyCenter(parts, boundsReady = false) {
  const horizontalBounds = new THREE.Box3();
  horizontalBounds.makeEmpty();
  const trunkParts = parts.filter((candidate) => candidate.kind === 'trunk');
  for (const candidate of trunkParts.length > 0 ? trunkParts : parts) {
    if (!boundsReady) candidate.geometry.computeBoundingBox();
    horizontalBounds.union(candidate.geometry.boundingBox);
  }
  const center = horizontalBounds.isEmpty()
    ? new THREE.Vector3()
    : horizontalBounds.getCenter(new THREE.Vector3());
  return center;
}

export function createInstancedRenderers(options) {
  return completeIterator(iterateInstancedRenderers(options));
}

export function* iterateInstancedRenderers({
  root,
  partsByPrototype,
  capacity,
  name,
  castShadow,
  tintLeaves = false,
  renderer = null,
  reuseVertexArrays = false,
}) {
  const result = [];
  for (const [prototypeIndex, parts] of partsByPrototype.entries()) {
    const meshes = [];
    result.push(meshes);
    let morphologyCenter = null;
    if (tintLeaves) {
      // Bounds belong to the prototype. A building needs none of this work,
      // and a tree scans each geometry once regardless of its material count.
      for (const geometry of new Set(parts.map(part => part.geometry))) geometry.computeBoundingBox();
      morphologyCenter = treeMorphologyCenter(parts, true);
    }
    for (const [partIndex, part] of parts.entries()) {
      yield;
      const tinted = tintLeaves && part.kind === 'leaf';
      const morphed = tintLeaves;
      const geometry = createGeometry(part.geometry, capacity, tinted, morphed, part.instanceSurface,
        part.material.userData.plantMotionAnchor, reuseVertexArrays, part.instanceBiomeLook);
      if (morphed && part.kind === 'trunk') {
        geometry.setAttribute('instanceRootPlane', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
      }
      yield geometry;
      const material = createDitheredMaterial(part.material, {
        tinted,
        kind: morphed ? part.kind : null,
        morphologyPivot: morphologyCenter ? { x: morphologyCenter.x,
          y: part.kind === 'leaf' && Number.isFinite(part.geometry.boundingBox?.min.y) ? part.geometry.boundingBox.min.y : 0,
          z: morphologyCenter.z } : null,
        crownBounds: tinted ? crownBounds(part.geometry) : null,
      });
      yield material;
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      // The matrices as a storage buffer, not an instanced vertex attribute. Past the
      // uniform-buffer limit (~1000 matrices) three wraps a vertex attribute in an
      // interleaved buffer and gives every material build its own views onto it; a
      // view created after a partial write believes the buffer current and never
      // uploads it. When a rebuild lands between our write and the old view's next
      // draw (the environment arriving, a material swap), those instances keep the
      // matrices the buffer was created with — the donor rock pack drew nothing at
      // all until forced to re-upload. A storage buffer is its own binding with one
      // version, so every tracked range reaches the GPU.
      // WebGL cannot bind a mat4 storage attribute. Its standard instancing path
      // uses a uniform buffer or four interleaved columns instead.
      if (!renderer?.backend?.isWebGLBackend) {
        mesh.instanceMatrix = new THREE.StorageInstancedBufferAttribute(mesh.instanceMatrix.array, 16);
      }
      mesh.count = 0;
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = Boolean(castShadow && part.kind !== 'leaf');
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.name = `${name}-${prototypeIndex}-${partIndex}`;
      root.add(mesh);
      meshes.push(mesh);
    }
  }
  return result;
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

function writeDitherInstance(attribute, index, fade, seed, colorVariation, range) {
  const array = attribute.array;
  const offset = index * 3;
  // Compare the float32 values the GPU buffer holds, as for instance matrices.
  fade = Math.fround(fade);
  seed = Math.fround(seed);
  colorVariation = Math.fround(colorVariation);
  if (
    array[offset] === fade
    && array[offset + 1] === seed
    && array[offset + 2] === colorVariation
  ) return;
  array[offset] = fade;
  array[offset + 1] = seed;
  array[offset + 2] = colorVariation;
  widenDirtyRange(range, index);
}

function writeVector4Instance(attribute, index, value, range) {
  const array = attribute.array;
  const offset = index * 4;
  let changed = false;
  for (let channel = 0; channel < 4; channel += 1) {
    const component = Math.fround(value[channel]);
    if (array[offset + channel] !== component) {
      array[offset + channel] = component;
      changed = true;
    }
  }
  if (changed) widenDirtyRange(range, index);
}

function writeVector3Instance(attribute, index, value, range) {
  const array = attribute.array;
  const offset = index * 3;
  const x = Math.fround(value[0]);
  const y = Math.fround(value[1]);
  const z = Math.fround(value[2]);
  if (
    array[offset] === x
    && array[offset + 1] === y
    && array[offset + 2] === z
  ) return;
  array[offset] = x;
  array[offset + 1] = y;
  array[offset + 2] = z;
  widenDirtyRange(range, index);
}

/**
 * Writes one instance matrix, translated by (−offsetX, −offsetZ) (see
 * InstanceAnchor). Compared as the float32 values the array will hold: against
 * the float64 matrix nearly every element differed, so every rebuild re-uploaded
 * every instance it kept.
 */
function writeMatrixInstance(attribute, index, matrix, range, offsetX, offsetZ) {
  const array = attribute.array;
  const offset = index * 16;
  const elements = matrix.elements;
  for (let element = 0; element < 16; element += 1) {
    const value = element === 12
      ? elements[12] - offsetX
      : element === 14 ? elements[14] - offsetZ : elements[element];
    if (array[offset + element] !== Math.fround(value)) {
      array.set(elements, offset);
      array[offset + 12] = elements[12] - offsetX;
      array[offset + 14] = elements[14] - offsetZ;
      widenDirtyRange(range, index);
      return;
    }
  }
}

const MATRIX_RANGE = { min: Infinity, max: -1 };
const DITHER_RANGE = { min: Infinity, max: -1 };
const TINT_RANGE = { min: Infinity, max: -1 };
const MORPHOLOGY_RANGE = { min: Infinity, max: -1 };
const SURFACE_RANGE = { min: Infinity, max: -1 };
const PLANT_ROOT_RANGE = { min: Infinity, max: -1 };
const PLANT_ROOT = [0, 0, 0];
const DRY_SURFACE = Object.freeze([0, 0, 0]);
const BIOME_LOOK_RANGE = { min: Infinity, max: -1 };

/**
 * @param {Array<Array<THREE.InstancedMesh>>} renderers parts per prototype
 * @param {Array<Array<object>>} instancesByPrototype
 * @param {?{ x: number, z: number }} [anchor] canonical point the matrices are
 *   written relative to (InstanceAnchor); the root must sit at anchor − origin
 * @param {?(number[] | null)[]} [rowsByPrototype] complete dirty row indices per
 *   prototype; null entries compare the full publication, empty entries only set counts
 */
export function writeInstances(renderers, instancesByPrototype, anchor = null, rowsByPrototype = null) {
  const offsetX = anchor?.x ?? 0;
  const offsetZ = anchor?.z ?? 0;
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
      // Three updates object/material bindings before rejecting a zero-count
      // draw. Empty prototype pools should not reach that work every frame.
      mesh.visible = writableCount > 0;
      const dither = mesh.geometry.getAttribute('instanceDither');
      const tints = mesh.geometry.getAttribute('instanceLeafTint');
      const morphologies = mesh.geometry.getAttribute('instanceMorphology');
      const roots = mesh.geometry.getAttribute('instanceRootPlane');
      const surfaces = mesh.geometry.getAttribute('instanceSurface');
      const plantRoots = mesh.geometry.getAttribute('instancePlantRoot');
      const biomeLooks = mesh.geometry.getAttribute('instanceBiomeLook');
      const biomeLookRange = resetDirtyRange(BIOME_LOOK_RANGE);
      const matrixRange = resetDirtyRange(MATRIX_RANGE);
      const ditherRange = resetDirtyRange(DITHER_RANGE);
      const tintRange = resetDirtyRange(TINT_RANGE);
      const morphologyRange = resetDirtyRange(MORPHOLOGY_RANGE);
      const surfaceRange = resetDirtyRange(SURFACE_RANGE);
      const plantRange = resetDirtyRange(PLANT_ROOT_RANGE);
      const selectedRows = rowsByPrototype?.[prototypeIndex];
      // A partial write never reads the unselected rows, so keep the largest scale seen.
      let plantScaleSquared = selectedRows && plantRoots ? mesh.userData.plantScaleSquared ?? 1 : 1;
      const visits = selectedRows?.length ?? writableCount;
      PerfCounters.inc('stylizedInstanceRowsCompared', visits);
      for (let visit = 0; visit < visits; visit += 1) {
        const index = selectedRows ? selectedRows[visit] : visit;
        if (index >= writableCount) continue;
        const instance = instances[index];
        if (plantRoots) {
          const e = instance.matrix.elements;
          plantScaleSquared = Math.max(plantScaleSquared,
            e[0] ** 2 + e[1] ** 2 + e[2] ** 2,
            e[4] ** 2 + e[5] ** 2 + e[6] ** 2,
            e[8] ** 2 + e[9] ** 2 + e[10] ** 2);
          PLANT_ROOT[0] = e[12] - offsetX; PLANT_ROOT[1] = e[13]; PLANT_ROOT[2] = e[14] - offsetZ;
          writeVector3Instance(plantRoots, index, PLANT_ROOT, plantRange);
        }
        if (surfaces) writeVector3Instance(surfaces, index, instance.surfaceData ?? DRY_SURFACE, surfaceRange);
        if (biomeLooks) writeVector4Instance(biomeLooks, index, instance.biomeLook ?? NEUTRAL_BIOME_LOOK, biomeLookRange);
        if (roots) {
          const fit = instance.rootFit;
          const e = instance.matrix.elements;
          const up = e[5];
          const bend = fit && Math.abs(up) > 1e-6
            ? [(fit.slopeX * e[0] + fit.slopeZ * e[2]) / up,
              (fit.slopeX * e[8] + fit.slopeZ * e[10]) / up, fit.conformHeight]
            : [0, 0, 0];
          writeVector3Instance(roots, index, bend, morphologyRange);
        }
        writeMatrixInstance(mesh.instanceMatrix, index, instance.matrix, matrixRange, offsetX, offsetZ);
        writeDitherInstance(
          dither,
          index,
          instance.fade * (instance.ditherDirection ?? 1),
          instance.seed,
          instance.colorVariation ?? 1,
          ditherRange,
        );
        if (tints) {
          const tint = instance.leafTint ?? UNTINTED;
          LEAF_TINT[0] = tint[0];
          LEAF_TINT[1] = tint[1];
          LEAF_TINT[2] = tint[2];
          LEAF_TINT[3] = instance.leafSnow ?? 0;
          writeVector4Instance(tints, index, LEAF_TINT, tintRange);
        }
        if (morphologies) {
          let morphology = instance.morphology ?? IDENTITY_MORPHOLOGY;
          // A trunk reads only z (its scale); its x carries the tree's canopy snow
          // to the bark (StylizedDitheredMaterial), sparing a vertex buffer.
          if (roots) {
            TRUNK_MORPHOLOGY[0] = instance.leafSnow ?? 0;
            TRUNK_MORPHOLOGY[1] = morphology[1];
            TRUNK_MORPHOLOGY[2] = morphology[2];
            morphology = TRUNK_MORPHOLOGY;
          }
          writeVector3Instance(morphologies, index, morphology, morphologyRange);
        }
      }
      markAttributeSubrangeUpdated(mesh.instanceMatrix, matrixRange.min, matrixRange.max);
      markAttributeSubrangeUpdated(dither, ditherRange.min, ditherRange.max);
      if (tints) markAttributeSubrangeUpdated(tints, tintRange.min, tintRange.max);
      if (roots) markAttributeSubrangeUpdated(roots, morphologyRange.min, morphologyRange.max);
      if (surfaces) markAttributeSubrangeUpdated(surfaces, surfaceRange.min, surfaceRange.max);
      if (biomeLooks) markAttributeSubrangeUpdated(biomeLooks, biomeLookRange.min, biomeLookRange.max);
      if (plantRoots) markAttributeSubrangeUpdated(plantRoots, plantRange.min, plantRange.max);
      if (morphologies) {
        markAttributeSubrangeUpdated(
          morphologies,
          morphologyRange.min,
          morphologyRange.max,
        );
      }
      if (plantRoots) mesh.userData.plantScaleSquared = plantScaleSquared;
      if (matrixRange.max >= 0 || writableCount !== previousCount) {
        if (selectedRows && !plantRoots) extendInstanceBounds(mesh, selectedRows);
        else mesh.computeBoundingSphere();
        if (plantRoots) mesh.boundingSphere.radius += (mesh.material.userData.plantMotionReach ?? 0)
          * Math.sqrt(plantScaleSquared);
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
  distanceForChunk = null,
  onTransition = null,
}) {
  const entries = [];
  let signature = '';
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
      LOD_WORLD_POSITION.x = canonicalX - origin.x;
      LOD_WORLD_POSITION.y = (anchor?.y ?? 0) + worldHeight * 0.5;
      LOD_WORLD_POSITION.z = canonicalZ - origin.z;
      const pixels = projectedPixelHeight({
        camera,
        worldPosition: LOD_WORLD_POSITION,
        worldHeight,
        viewportHeight,
      });
      const key = `${chunkX}:${chunkZ}`;
      const storedState = transitionStates.get(key) ?? null;
      const previous = storedState?.target ?? null;
      const selected = selectProjectedLod({ pixels, previous, ...thresholds });
      const target = clampLodToRadii({
        band: selected,
        chunkDistance: distanceForChunk?.(chunkX, chunkZ) ?? chunkDistance,
        ...radii,
      });
      if (previous !== null && previous !== target) {
        onTransition?.({
          chunkX,
          chunkZ,
          from: previous,
          to: target,
          durationMs: transitionMs,
        });
      }
      let state;
      if (!ready && target !== 'culled') {
        state = storedState?.waitingForData && storedState.target === target
          ? storedState
          : waitingState(target, timestamp);
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

      let entrySignature = `${key}:${target}:${ready ? 'ready' : 'waiting'}`;
      for (const representation of state.representations) {
        entrySignature += `:${representation.band}:${
          quantizeFade(representation.fade, fadeSteps)
        }:${representation.ditherDirection}`;
      }
      signature += signature.length === 0 ? entrySignature : `|${entrySignature}`;
    }
  }

  return { entries, signature };
}

export function pruneStateMap(states, entries) {
  const active = new Set();
  for (const entry of entries) active.add(`${entry.chunkX}:${entry.chunkZ}`);
  for (const key of states.keys()) {
    if (!active.has(key)) states.delete(key);
  }
}
