import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { markAttributeRangeUpdated } from './attributeUpload.js';
import { createFlowerCrossGeometry, setFlowerGeometryBounds } from './StylizedFlowerGeometry.js';
import { createStylizedFlowerMaterial } from './StylizedFlowerMaterial.js';
import { buildFlowerScatter } from './vegetationScatter.js';
import { filterScatterByForest } from './forest/ForestFloor.js';

function densityForDistance(distance, radius, farDensity) {
  if (radius <= 0 || distance <= 0) return 1;
  const amount = Math.min(1, distance / radius);
  return 1 + (farDensity - 1) * amount;
}

export class StylizedFlowerSlot {
  constructor({ terrainSlot, terrainView, config, textures, forestFieldProvider = null }) {
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.config = config;
    this.textures = textures;
    this.forestFieldProvider = forestFieldProvider;
    this.chunkSize = terrainView.worldStore.chunkSize;
    this.tileSize = terrainView.worldStore.tileSize;
    this.chunkWorldSize = this.chunkSize * this.tileSize;
    this.maxInstances = config.flowers.perChunk;
    this.chunkCenter = uniform(new THREE.Vector2());
    this.time = uniform(0);
    this.geometry = createFlowerCrossGeometry(this.maxInstances);
    this.material = createStylizedFlowerMaterial({
      textures,
      surfaceMaskTexture: terrainSlot.surfaceMaskTexture,
      chunkCenter: this.chunkCenter,
      chunkWorldSize: this.chunkWorldSize,
      time: this.time,
      config,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    this.mesh.name = `stylized-flowers-${terrainSlot.slotIndex}`;
    terrainView.scene.add(this.mesh);
    this.readyKey = null;
    this.readyRevision = -1;
    this.readySampleLimit = 0;
    this.pendingRebuild = null;
  }

  update(timestamp, focusChunk) {
    this.time.value = timestamp / 1000;
    const descriptor = this.terrainSlot.descriptor;
    const distance = descriptor && focusChunk
      ? Math.max(
        Math.abs(descriptor.chunkX - focusChunk.chunkX),
        Math.abs(descriptor.chunkZ - focusChunk.chunkZ),
      )
      : Number.POSITIVE_INFINITY;
    const withinRadius = distance <= this.config.flowers.residentRadius;
    const active = Boolean(this.terrainSlot.mesh.visible && withinRadius && descriptor && this.terrainSlot.page);
    this.mesh.visible = Boolean(active && this.readyKey === descriptor?.key && this.hasInstances());
    if (!active) {
      this.pendingRebuild = null;
      return;
    }

    this.mesh.position.copy(this.terrainSlot.mesh.position);
    this.chunkCenter.value.set(descriptor.centerWorldX, descriptor.centerWorldZ);
    const farDensity = this.config.flowers.outerRingDensity ?? 0.5;
    const density = densityForDistance(distance, this.config.flowers.residentRadius, farDensity);
    const sampleLimit = Math.max(1, Math.round(this.config.flowers.perChunk * density));
    const needsBuild = this.readyKey !== descriptor.key
      || this.readyRevision !== this.terrainSlot.pageRevision
      || this.readySampleLimit !== sampleLimit;
    if (!needsBuild) return;

    const signature = `${descriptor.key}:${this.terrainSlot.pageRevision}:${sampleLimit}`;
    if (this.pendingRebuild?.signature === signature) return;
    this.pendingRebuild = {
      key: `flower:${this.terrainSlot.slotIndex}`,
      page: this.terrainSlot.page,
      descriptor,
      revision: this.terrainSlot.pageRevision,
      sampleLimit,
      signature,
    };
  }

  applyPendingRebuild() {
    if (!this.pendingRebuild) return false;
    const job = this.pendingRebuild;
    this.pendingRebuild = null;
    this.rebuild(job.page, job.descriptor, job.sampleLimit);
    this.readyKey = job.descriptor.key;
    this.readyRevision = job.revision;
    this.readySampleLimit = job.sampleLimit;
    this.mesh.visible = Boolean(
      this.terrainSlot.mesh.visible
      && this.terrainSlot.descriptor?.key === this.readyKey
      && this.hasInstances(),
    );
    return true;
  }

  // A chunk of open sea scatters no flowers; drawing it would only cost a
  // cull test and an empty draw.
  hasInstances() {
    return this.geometry.instanceCount > 0;
  }

  rebuild(page, descriptor, sampleLimit) {
    PerfCounters.inc('flowerRebuilds');
    const scatterStartedAt = performance.now();
    let scatter = null;
    if (page.flowerScatter?.base && page.flowerScatter.sampleLimit === sampleLimit) {
      scatter = page.flowerScatter;
    } else {
      scatter = buildFlowerScatter({
        page,
        chunkSize: this.chunkSize,
        tileSize: this.tileSize,
        sampleLimit,
        tileIds: this.config.flowers.tileIds,
        minSize: this.config.flowers.minSize,
        maxSize: this.config.flowers.maxSize,
      });
    }
    scatter = filterScatterByForest({
      scatter,
      descriptor,
      field: this.forestFieldProvider?.(),
      kind: 'flower',
      config: this.config.trees.forestFloor,
      chunkWorldSize: this.chunkWorldSize,
    });
    PerfCounters.inc('flowerScatterMs', performance.now() - scatterStartedAt);
    PerfCounters.set('flowerScatter', performance.now() - scatterStartedAt);

    const uploadStartedAt = performance.now();
    const baseAttribute = this.geometry.getAttribute('instanceBase');
    const parameterAttribute = this.geometry.getAttribute('instanceParams');
    baseAttribute.array.set(scatter.base.subarray(0, scatter.count * 3));
    parameterAttribute.array.set(scatter.parameters.subarray(0, scatter.count * 4));
    this.geometry.instanceCount = scatter.count;
    markAttributeRangeUpdated(baseAttribute, scatter.count);
    markAttributeRangeUpdated(parameterAttribute, scatter.count);
    setFlowerGeometryBounds(this.geometry, {
      chunkWorldSize: this.chunkWorldSize,
      minimumHeight: scatter.minimumHeight,
      maximumHeight: scatter.maximumHeight,
      maximumSize: this.config.flowers.maxSize,
    });
    PerfCounters.inc('flowerBufferUploadMs', performance.now() - uploadStartedAt);
    PerfCounters.set('flowerLastChunkInstances', scatter.count);
  }

  dispose() {
    this.terrainView.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
