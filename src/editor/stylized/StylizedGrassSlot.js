import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { markAttributeRangeUpdated } from './attributeUpload.js';
import { createStylizedGrassMaterial } from './StylizedGrassMaterial.js';
import { cellSampleRandom01, sampleHeight } from './scatterMath.js';
import { clumpsPerCell, densityForDistance } from './grassLodMath.js';
import { filterScatterByForest } from './forest/ForestFloor.js';
import {
  compactGrassScatter,
} from './vegetationScatter.js';

const BLADE_SEGMENTS = 3;
const TWO_PI = Math.PI * 2;
const DEFAULT_BUILD_SLICE_CELLS = 64;
const DEFAULT_INACTIVE_RELEASE_FRAMES = 30;
const DEFAULT_BLADES_PER_CLUMP = 8;
const DEFAULT_INFLUENCE_TEXTURE_SIZE = 32;

function bladeHalfWidth(t) {
  return 0.5 * ((1 - t) ** 1.2);
}

function createClumpGeometry(maxInstances, bladesPerClump) {
  const verticesPerBlade = BLADE_SEGMENTS * 2 + 1;
  const positions = new Float32Array(bladesPerClump * verticesPerBlade * 3);
  const indices = [];

  for (let bladeIndex = 0; bladeIndex < bladesPerClump; bladeIndex += 1) {
    const phase = bladeIndex / bladesPerClump * TWO_PI;
    const radial = 1.25 + (bladeIndex % 3) * 1.15;
    const centerX = Math.cos(phase) * radial;
    const centerZ = Math.sin(phase) * radial;
    const axisX = Math.cos(phase + Math.PI * 0.5);
    const axisZ = Math.sin(phase + Math.PI * 0.5);
    const vertexBase = bladeIndex * verticesPerBlade;

    for (let segment = 0; segment < BLADE_SEGMENTS; segment += 1) {
      const t = segment / BLADE_SEGMENTS;
      const width = bladeHalfWidth(t);
      const left = (vertexBase + segment * 2) * 3;
      const right = left + 3;
      positions[left] = centerX - axisX * width;
      positions[left + 1] = t;
      positions[left + 2] = centerZ - axisZ * width;
      positions[right] = centerX + axisX * width;
      positions[right + 1] = t;
      positions[right + 2] = centerZ + axisZ * width;
    }

    const tip = (vertexBase + BLADE_SEGMENTS * 2) * 3;
    positions[tip] = centerX;
    positions[tip + 1] = 1;
    positions[tip + 2] = centerZ;

    for (let segment = 0; segment < BLADE_SEGMENTS - 1; segment += 1) {
      const left = vertexBase + segment * 2;
      const right = left + 1;
      const nextLeft = left + 2;
      const nextRight = right + 2;
      indices.push(left, nextLeft, right, right, nextLeft, nextRight);
    }
    const lastLeft = vertexBase + (BLADE_SEGMENTS - 1) * 2;
    indices.push(lastLeft, vertexBase + BLADE_SEGMENTS * 2, lastLeft + 1);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.setAttribute(
    'instanceBase',
    new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3),
  );
  geometry.setAttribute(
    'instanceParams',
    new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4),
  );
  geometry.instanceCount = 0;
  geometry.computeVertexNormals();
  return geometry;
}

function findTrample(worldX, worldZ, boulders, defaultRadius, falloff) {
  let strongest = 0;
  let directionX = 1;
  let directionZ = 0;
  for (const boulder of boulders) {
    const deltaX = worldX - boulder.x;
    const deltaZ = worldZ - boulder.z;
    const distance = Math.hypot(deltaX, deltaZ);
    const radius = boulder.radius ?? defaultRadius;
    const influence = 1 - Math.min(1, Math.max(0, (distance - radius) / Math.max(0.001, falloff)));
    if (influence <= strongest) continue;
    strongest = influence;
    if (distance > 0.0001) {
      directionX = deltaX / distance;
      directionZ = deltaZ / distance;
    }
  }
  return { directionX, directionZ, influence: strongest };
}

function setGeometryBounds(geometry, chunkWorldSize, minimumHeight, maximumHeight, maximumLength) {
  if (!Number.isFinite(minimumHeight) || !Number.isFinite(maximumHeight)) return;
  const half = chunkWorldSize / 2 + maximumLength + 1;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-half, minimumHeight - 1, -half),
    new THREE.Vector3(half, maximumHeight + maximumLength + 2, half),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);
}

function encodeDirection(value) {
  return Math.round((Math.max(-1, Math.min(1, value)) * 0.5 + 0.5) * 255);
}

export class StylizedGrassSlot {
  constructor({
    terrainSlot,
    terrainView,
    objectMap,
    config,
    sunDirection,
    forestFieldProvider = null,
  }) {
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.objectMap = objectMap;
    this.config = config;
    this.sunDirection = sunDirection;
    this.forestFieldProvider = forestFieldProvider;
    this.chunkSize = terrainView.worldStore.chunkSize;
    this.tileSize = terrainView.worldStore.tileSize;
    this.chunkWorldSize = this.chunkSize * this.tileSize;
    this.bladesPerCell = config.grass.bladesPerCell;
    this.bladesPerClump = config.grass.bladesPerClump ?? DEFAULT_BLADES_PER_CLUMP;
    this.clumpsPerCell = clumpsPerCell(this.bladesPerCell, this.bladesPerClump);
    this.maxInstances = this.chunkSize * this.chunkSize * this.clumpsPerCell;
    this.chunkCenter = uniform(new THREE.Vector2());
    this.time = uniform(0);
    this.emptyGeometry = new THREE.BufferGeometry();
    this.geometry = null;
    this.material = null;
    this.trampleTexture = null;
    this.tramplePixels = null;
    this.trampleKey = null;
    this.mesh = new THREE.Mesh(this.emptyGeometry, null);
    this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    this.mesh.name = `stylized-grass-${terrainSlot.slotIndex}`;
    terrainView.scene.add(this.mesh);
    this.readyKey = null;
    this.readyRevision = -1;
    this.readyClumpsPerCell = 0;
    this.pendingRebuild = null;
    this.buildState = null;
    this.inactiveFrames = 0;
  }

  createTrampleTexture() {
    const size = this.config.grass.influenceTextureSize ?? DEFAULT_INFLUENCE_TEXTURE_SIZE;
    this.tramplePixels = new Uint8Array(size * size * 4);
    for (let offset = 0; offset < this.tramplePixels.length; offset += 4) {
      this.tramplePixels[offset] = 255;
      this.tramplePixels[offset + 1] = 128;
      this.tramplePixels[offset + 2] = 0;
      this.tramplePixels[offset + 3] = 255;
    }
    this.trampleTexture = new THREE.DataTexture(
      this.tramplePixels,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.trampleTexture.colorSpace = THREE.NoColorSpace;
    this.trampleTexture.magFilter = THREE.LinearFilter;
    this.trampleTexture.minFilter = THREE.LinearFilter;
    this.trampleTexture.generateMipmaps = false;
    this.trampleTexture.needsUpdate = true;
  }

  ensureResources() {
    if (this.geometry) return;
    this.createTrampleTexture();
    this.geometry = createClumpGeometry(this.maxInstances, this.bladesPerClump);
    this.material = createStylizedGrassMaterial({
      surfaceMaskTexture: this.terrainSlot.surfaceMaskTexture,
      trampleTexture: this.trampleTexture,
      chunkCenter: this.chunkCenter,
      chunkWorldSize: this.chunkWorldSize,
      time: this.time,
      sunDirection: this.sunDirection,
      config: this.config,
    });
    this.mesh.geometry = this.geometry;
    this.mesh.material = this.material;
    this.mesh.receiveShadow = true;
    PerfCounters.inc('grassResourceAllocations');
  }

  releaseResources() {
    if (!this.geometry) return;
    this.geometry.dispose();
    this.material?.dispose();
    this.trampleTexture?.dispose();
    this.geometry = null;
    this.material = null;
    this.trampleTexture = null;
    this.tramplePixels = null;
    this.trampleKey = null;
    this.mesh.geometry = this.emptyGeometry;
    this.mesh.material = null;
    this.readyKey = null;
    this.readyRevision = -1;
    this.readyClumpsPerCell = 0;
    this.pendingRebuild = null;
    this.buildState = null;
    PerfCounters.inc('grassResourceReleases');
  }

  updateTrampleTexture(descriptor, boulders, objectSignature) {
    const key = `${descriptor.key}:${objectSignature}`;
    if (key === this.trampleKey || !this.trampleTexture) return;
    const startedAt = performance.now();
    const size = this.trampleTexture.image.width;
    const half = this.chunkWorldSize / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const worldX = descriptor.centerWorldX - half + (x + 0.5) / size * this.chunkWorldSize;
        const worldZ = descriptor.centerWorldZ + half - (y + 0.5) / size * this.chunkWorldSize;
        const influence = findTrample(
          worldX,
          worldZ,
          boulders,
          this.config.rocks.radius,
          this.config.rocks.falloff,
        );
        const offset = (y * size + x) * 4;
        this.tramplePixels[offset] = encodeDirection(influence.directionX);
        this.tramplePixels[offset + 1] = encodeDirection(influence.directionZ);
        this.tramplePixels[offset + 2] = Math.round(influence.influence * 255);
        this.tramplePixels[offset + 3] = 255;
      }
    }
    this.trampleTexture.needsUpdate = true;
    this.trampleKey = key;
    PerfCounters.inc('grassInfluenceTextureUploads');
    const elapsed = performance.now() - startedAt;
    PerfCounters.inc('grassTrampleMs', elapsed);
    PerfCounters.set('grassTrample', elapsed);
  }

  update(timestamp, focusChunk, objectSignature, localBoulders) {
    this.time.value = timestamp / 1000;
    const descriptor = this.terrainSlot.descriptor;
    const distance = descriptor && focusChunk
      ? Math.max(
        Math.abs(descriptor.chunkX - focusChunk.chunkX),
        Math.abs(descriptor.chunkZ - focusChunk.chunkZ),
      )
      : Number.POSITIVE_INFINITY;
    const withinRadius = distance <= this.config.grass.residentRadius;
    const active = Boolean(this.terrainSlot.mesh.visible && withinRadius && descriptor && this.terrainSlot.page);
    if (!active) {
      this.mesh.visible = false;
      this.pendingRebuild = null;
      this.buildState = null;
      this.inactiveFrames += 1;
      const releaseFrames = this.config.streaming?.inactiveReleaseFrames
        ?? DEFAULT_INACTIVE_RELEASE_FRAMES;
      if (this.inactiveFrames >= releaseFrames) this.releaseResources();
      return;
    }

    this.inactiveFrames = 0;
    this.ensureResources();
    this.updateTrampleTexture(descriptor, localBoulders, objectSignature);
    this.mesh.position.copy(this.terrainSlot.mesh.position);
    this.chunkCenter.value.set(descriptor.centerWorldX, descriptor.centerWorldZ);
    const farDensity = this.config.grass.outerRingDensity ?? 0.45;
    const density = densityForDistance(distance, this.config.grass.residentRadius, farDensity);
    const targetClumpsPerCell = Math.max(1, Math.round(this.clumpsPerCell * density));
    const isReadyForDescriptor = this.readyKey === descriptor.key;
    this.mesh.visible = Boolean(this.terrainSlot.mesh.visible && isReadyForDescriptor);

    // Rock/object influence is a trample texture — do not rebuild geometry for it.
    const needsBuild = this.readyKey !== descriptor.key
      || this.readyRevision !== this.terrainSlot.pageRevision
      || this.readyClumpsPerCell !== targetClumpsPerCell;
    if (!needsBuild) return;

    const buildSignature = [
      descriptor.key,
      this.terrainSlot.pageRevision,
      targetClumpsPerCell,
    ].join('|');
    if (this.pendingRebuild?.signature === buildSignature) return;
    this.pendingRebuild = {
      key: `grass:${this.terrainSlot.slotIndex}`,
      page: this.terrainSlot.page,
      descriptor,
      revision: this.terrainSlot.pageRevision,
      clumpsPerCell: targetClumpsPerCell,
      signature: buildSignature,
    };
    this.buildState = null;
  }

  startBuild(job) {
    PerfCounters.inc('grassRebuilds');
    this.buildState = {
      signature: job.signature,
      cellCursor: 0,
      count: 0,
      eligible: new Set(this.config.grass.tileIds),
      minimumHeight: Number.POSITIVE_INFINITY,
      maximumHeight: Number.NEGATIVE_INFINITY,
      usedWorkerScatter: false,
    };
  }

  applyPendingRebuild() {
    const job = this.pendingRebuild;
    if (!job) return false;
    this.ensureResources();

    const workerScatter = job.page.grassScatter;
    if (workerScatter?.base && workerScatter?.parameters) {
      const scatterStartedAt = performance.now();
      const compacted = compactGrassScatter(workerScatter, job.clumpsPerCell, this.chunkSize)
        ?? workerScatter;
      const scatter = filterScatterByForest({
        scatter: compacted,
        descriptor: job.descriptor,
        field: this.forestFieldProvider?.(),
        kind: 'grass',
        config: this.config.trees.forestFloor,
        chunkWorldSize: this.chunkWorldSize,
      });
      this.applyScatter(job, scatter);
      PerfCounters.inc('grassBuildSlices');
      const elapsed = performance.now() - scatterStartedAt;
      PerfCounters.inc('grassScatterMs', elapsed);
      PerfCounters.set('grassScatter', elapsed);
      return true;
    }

    if (!this.buildState || this.buildState.signature !== job.signature) {
      this.startBuild(job);
    }
    const state = this.buildState;
    const cellsPerSlice = this.config.streaming?.grassCellsPerBuildSlice
      ?? DEFAULT_BUILD_SLICE_CELLS;
    const totalCells = this.chunkSize * this.chunkSize;
    const endCell = Math.min(totalCells, state.cellCursor + cellsPerSlice);
    const scatterStartedAt = performance.now();
    this.buildCells(job, state, endCell);
    PerfCounters.inc('grassBuildSlices');
    PerfCounters.inc('grassScatterMs', performance.now() - scatterStartedAt);

    if (state.cellCursor < totalCells) return true;
    this.finishBuild(job, state);
    PerfCounters.set('grassScatter', performance.now() - scatterStartedAt);
    return true;
  }

  applyScatter(job, scatter) {
    const baseAttribute = this.geometry.getAttribute('instanceBase');
    const parameterAttribute = this.geometry.getAttribute('instanceParams');
    baseAttribute.array.set(scatter.base.subarray(0, scatter.count * 3));
    parameterAttribute.array.set(scatter.parameters.subarray(0, scatter.count * 4));
    this.finishBuild(job, {
      count: scatter.count,
      minimumHeight: scatter.minimumHeight,
      maximumHeight: scatter.maximumHeight,
    });
  }

  buildCells(job, state, endCell) {
    const base = this.geometry.getAttribute('instanceBase').array;
    const parameters = this.geometry.getAttribute('instanceParams').array;

    for (; state.cellCursor < endCell; state.cellCursor += 1) {
      const cellIndex = state.cellCursor;
      if (!state.eligible.has(job.page.tiles[cellIndex])) continue;
      const localX = cellIndex % this.chunkSize;
      const localZ = Math.floor(cellIndex / this.chunkSize);
      for (let clumpIndex = 0; clumpIndex < job.clumpsPerCell; clumpIndex += 1) {
        const jitterX = cellSampleRandom01(job.descriptor.chunkX, job.descriptor.chunkZ, cellIndex, clumpIndex, 0);
        const jitterZ = cellSampleRandom01(job.descriptor.chunkX, job.descriptor.chunkZ, cellIndex, clumpIndex, 1);
        const sampleX = localX + jitterX;
        const sampleZ = localZ + jitterZ;
        const localWorldX = -this.chunkWorldSize / 2 + sampleX * this.tileSize;
        const localWorldZ = this.chunkWorldSize / 2 - sampleZ * this.tileSize;
        const height = sampleHeight(job.page, sampleX, sampleZ, this.chunkSize);
        const width = this.config.grass.minWidth
          + cellSampleRandom01(job.descriptor.chunkX, job.descriptor.chunkZ, cellIndex, clumpIndex, 2)
            * (this.config.grass.maxWidth - this.config.grass.minWidth);
        const length = this.config.grass.minLength
          + cellSampleRandom01(job.descriptor.chunkX, job.descriptor.chunkZ, cellIndex, clumpIndex, 3)
            * (this.config.grass.maxLength - this.config.grass.minLength);
        const angle = cellSampleRandom01(job.descriptor.chunkX, job.descriptor.chunkZ, cellIndex, clumpIndex, 4) * TWO_PI;

        const baseOffset = state.count * 3;
        base[baseOffset] = localWorldX;
        base[baseOffset + 1] = height;
        base[baseOffset + 2] = localWorldZ;
        const parameterOffset = state.count * 4;
        parameters[parameterOffset] = width;
        parameters[parameterOffset + 1] = length;
        parameters[parameterOffset + 2] = angle;
        parameters[parameterOffset + 3] = cellSampleRandom01(
          job.descriptor.chunkX,
          job.descriptor.chunkZ,
          cellIndex,
          clumpIndex,
          5,
        );
        state.minimumHeight = Math.min(state.minimumHeight, height);
        state.maximumHeight = Math.max(state.maximumHeight, height);
        state.count += 1;
      }
    }
  }

  finishBuild(job, state) {
    const uploadStartedAt = performance.now();
    const baseAttribute = this.geometry.getAttribute('instanceBase');
    const parameterAttribute = this.geometry.getAttribute('instanceParams');
    this.geometry.instanceCount = state.count;
    const bytes = markAttributeRangeUpdated(baseAttribute, state.count)
      + markAttributeRangeUpdated(parameterAttribute, state.count);
    setGeometryBounds(
      this.geometry,
      this.chunkWorldSize,
      state.minimumHeight,
      state.maximumHeight,
      this.config.grass.maxLength,
    );
    this.readyKey = job.descriptor.key;
    this.readyRevision = job.revision;
    this.readyClumpsPerCell = job.clumpsPerCell;
    this.pendingRebuild = null;
    this.buildState = null;
    this.mesh.visible = Boolean(
      this.terrainSlot.mesh.visible
      && this.terrainSlot.descriptor?.key === this.readyKey,
    );
    const uploadMs = performance.now() - uploadStartedAt;
    PerfCounters.inc('grassBufferUploadMs', uploadMs);
    PerfCounters.set('grassBufferUpload', uploadMs);
    PerfCounters.set('grassLastChunkClumps', state.count);
    PerfCounters.set('grassLastChunkEffectiveBlades', state.count * this.bladesPerClump);
    PerfCounters.set('grassInstanceAttributeBytes', bytes);
  }

  dispose() {
    this.terrainView.scene.remove(this.mesh);
    this.releaseResources();
    this.emptyGeometry.dispose();
  }
}
