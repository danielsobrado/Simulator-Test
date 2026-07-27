import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  PERF_COUNTER_WATER_UPLOAD_BYTES,
  PerfCounters,
} from '../performance/qa/PerfCounters.js';
import { createStylizedWaterMaterial } from './StylizedWaterMaterial.js';

const WATER_FIELD_CHANNELS = 4;

export class StylizedWaterSlot {
  constructor({ terrainSlot, terrainView, config }) {
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.config = config;
    this.time = uniform(0);
    this.surfaceOrigin = uniform(0);
    this.fieldSize = terrainView.chunkSize + 1;
    this.waterFieldPixels = new Uint16Array(
      this.fieldSize * this.fieldSize * WATER_FIELD_CHANNELS,
    );
    this.waterFieldTexture = new THREE.DataTexture(
      this.waterFieldPixels,
      this.fieldSize,
      this.fieldSize,
      THREE.RGBAFormat,
      THREE.HalfFloatType,
    );
    this.waterFieldTexture.magFilter = THREE.LinearFilter;
    this.waterFieldTexture.minFilter = THREE.LinearFilter;
    this.waterFieldTexture.generateMipmaps = false;
    this.waterFieldTexture.colorSpace = THREE.NoColorSpace;
    this.waterFieldTexture.unpackAlignment = 1;
    this.waterFieldTexture.needsUpdate = true;
    this.uploadedPage = null;
    this.uploadedFieldRevision = -1;
    this.material = createStylizedWaterMaterial({
      surfaceMaskTexture: terrainSlot.surfaceMaskTexture,
      waterFieldTexture: this.waterFieldTexture,
      waterFieldSize: this.fieldSize,
      waterSurfaceOrigin: this.surfaceOrigin,
      chunkCenter: terrainSlot.chunkCenter,
      chunkWorldSize: terrainView.chunkWorldSize,
      time: this.time,
      config,
    });
    this.material.side = THREE.DoubleSide;
    this.material.needsUpdate = true;
    this.mesh = new THREE.Mesh(terrainView.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.name = `stylized-water-${terrainSlot.slotIndex}`;
    terrainView.scene.add(this.mesh);
  }

  uploadField(page) {
    if (page.waterFieldWidth !== this.fieldSize || page.waterFieldHeight !== this.fieldSize
        || page.waterFieldPixels?.length !== this.waterFieldPixels.length) {
      throw new Error('Terrain page water field does not match its render slot.');
    }
    this.waterFieldPixels.set(page.waterFieldPixels);
    this.waterFieldTexture.needsUpdate = true;
    this.surfaceOrigin.value = page.waterFieldSurfaceOrigin ?? 0;
    this.uploadedPage = page;
    this.uploadedFieldRevision = page.waterFieldRevision ?? 0;
    PerfCounters.inc(PERF_COUNTER_WATER_UPLOAD_BYTES, page.waterFieldPixels.byteLength);
    PerfCounters.inc('textureBytesUploaded', page.waterFieldPixels.byteLength);
  }

  update(timestamp) {
    if (!this.config.water.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.time.value = timestamp / 1000;
    const descriptor = this.terrainSlot.descriptor;
    const page = this.terrainSlot.page;
    const ready = Boolean(
      this.terrainSlot.mesh.visible
      && descriptor
      && page?.waterFieldPixels,
    );
    this.mesh.visible = ready;
    if (!ready) return;
    if (page !== this.uploadedPage
        || (page.waterFieldRevision ?? 0) !== this.uploadedFieldRevision) {
      this.uploadField(page);
    }
    this.mesh.position.copy(this.terrainSlot.mesh.position);
  }

  dispose() {
    this.terrainView.scene.remove(this.mesh);
    this.waterFieldTexture.dispose();
    this.material.dispose();
  }
}
