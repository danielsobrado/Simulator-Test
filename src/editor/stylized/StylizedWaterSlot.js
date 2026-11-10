import { WATER_SLOT_OPTIONS } from './SharedWaterMaterials.js';
import { TERRAIN_SLOT_KEY } from '../materials/TerrainSlotBindings.js';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import {
  PERF_COUNTER_WATER_CHUNKS_WET,
  PERF_COUNTER_WATER_CHUNKS_DRY,
  PERF_COUNTER_WATER_CHUNKS_REFRACTIVE,
  PERF_COUNTER_WATER_UPLOAD_BYTES,
  PerfCounters,
} from '../performance/qa/PerfCounters.js';
import { WATER_FLOW_CHANNELS, waterFieldHasCoverage, waterFieldSurfaceRange } from '../water/WaterField.js';
import { createSlotGeometry, fitSlotBoundsToRange } from '../world/TerrainSlotBounds.js';
import { createStylizedWaterMaterial } from './StylizedWaterMaterial.js';
import { SEA_SWELL_COMPONENTS, seaSwellPhaseOrigin } from '../water/SeaSwell.js';
import { waterfallPatternOrigin } from './WaterfallShading.js';
import { createWaterPatternOrigins } from './WaterPatternOrigins.js';
import { updateWaterVisualClock } from '../water/WaterVisualClock.js';

const WATER_FIELD_CHANNELS = 4;
// Chebyshev radius, in chunks around the focus chunk, within which water is
// refracted. Wide enough that the swap happens well outside the range where
// refraction reads as anything but a faint tint, narrow enough that standing
// away from a shoreline submits no refractive material at all.
const REFRACTION_CHUNK_RADIUS = 2;

export class StylizedWaterSlot {
  constructor({ terrainSlot, terrainView, config, sunDirection = null, sharedMaterials = null }) {
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.config = config;
    this.sharedMaterials = sharedMaterials;
    this.time = uniform(0);
    this.surfaceOrigin = uniform(0);
    // Each swell component's phase at this chunk's centre, in double precision.
    this.seaPhaseOrigin = SEA_SWELL_COMPONENTS.map(() => uniform(0));
    this.rippleOrigin = uniform(new THREE.Vector2());
    // This chunk's centre wrapped for the fall strands, in double precision.
    this.patternOrigin = uniform(new THREE.Vector2());
    // Every surface pattern's origin at this chunk's centre, in double precision.
    this.surfacePatterns = createWaterPatternOrigins(config.water);
    this.seaPhaseDescriptor = null;
    this.fieldSize = terrainView.chunkSize + 1;
    this.waterFieldPixels = new Uint16Array(
      this.fieldSize * this.fieldSize * WATER_FIELD_CHANNELS,
    );
    this.waterFlowPixels = new Uint8Array(
      this.fieldSize * this.fieldSize * WATER_FLOW_CHANNELS,
    );
    // A still current (0.5 encodes zero) with no fall and no plunge.
    for (let index = 0; index < this.waterFlowPixels.length; index += WATER_FLOW_CHANNELS) {
      this.waterFlowPixels[index] = 128;
      this.waterFlowPixels[index + 1] = 128;
    }
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
    this.waterFlowTexture = new THREE.DataTexture(
      this.waterFlowPixels,
      this.fieldSize,
      this.fieldSize,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.waterFlowTexture.magFilter = THREE.LinearFilter;
    this.waterFlowTexture.minFilter = THREE.LinearFilter;
    this.waterFlowTexture.generateMipmaps = false;
    this.waterFlowTexture.colorSpace = THREE.NoColorSpace;
    this.waterFlowTexture.unpackAlignment = 1;
    this.waterFlowTexture.needsUpdate = true;
    this.waterAppearancePixels = new Uint8Array(this.fieldSize * this.fieldSize * 4);
    this.waterAppearanceTexture = new THREE.DataTexture(this.waterAppearancePixels, this.fieldSize, this.fieldSize);
    this.waterAppearanceTexture.minFilter = this.waterAppearanceTexture.magFilter = THREE.NearestFilter;
    this.waterAppearanceTexture.generateMipmaps = false;
    this.waterAppearanceTexture.needsUpdate = true;
    this.waterObstaclePixels = new Uint8Array(this.fieldSize * this.fieldSize * 2);
    this.waterObstacleTexture = new THREE.DataTexture(this.waterObstaclePixels, this.fieldSize, this.fieldSize, THREE.RGFormat);
    this.waterObstacleTexture.minFilter = this.waterObstacleTexture.magFilter = THREE.LinearFilter;
    this.waterObstacleTexture.generateMipmaps = false; this.waterObstacleTexture.needsUpdate = true;
    this.uploadedPage = null;
    this.uploadedFieldRevision = -1;
    this.hasWaterCoverage = false;
    const terrainData = terrainSlot.mesh.userData?.[TERRAIN_SLOT_KEY];
    if (terrainData) terrainData.waterSlot = this;
    this.materialOptions = {
      surfaceMaskTexture: terrainSlot.surfaceMaskTexture,
      waterFieldTexture: this.waterFieldTexture,
      waterFlowTexture: this.waterFlowTexture,
      waterAppearanceTexture: this.waterAppearanceTexture,
      waterObstacleTexture: this.waterObstacleTexture,
      waterFieldSize: this.fieldSize,
      waterSurfaceOrigin: this.surfaceOrigin,
      chunkCenter: terrainSlot.chunkCenter,
      chunkWorldSize: terrainView.chunkWorldSize,
      time: this.time,
      config,
      seaPhaseOrigin: this.seaPhaseOrigin,
      rippleOrigin: this.rippleOrigin,
      patternOrigin: this.patternOrigin,
      surfacePatterns: this.surfacePatterns,
      sunDirection,
    };
    this.material = this.createMaterial(false);
    // Built on first approach to water, never up front: a material carrying the
    // viewport-texture nodes costs the whole frame a colour copy, a depth copy
    // and a mip chain, so a session that never nears water must never create it.
    this.refractiveMaterial = null;
    this.refractionPrewarmed = false;
    this.mesh = new THREE.Mesh(createSlotGeometry(terrainView.geometry), this.material);
    this.mesh.userData[WATER_SLOT_OPTIONS] = this.materialOptions;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = `stylized-water-${terrainSlot.slotIndex}`;
    terrainView.scene.add(this.mesh);
  }

  createMaterial(enableRefraction) {
    if (this.sharedMaterials) return this.sharedMaterials.get(this.materialOptions, enableRefraction);
    const material = createStylizedWaterMaterial({
      ...this.materialOptions,
      enableRefraction,
    });
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
    return material;
  }

  /**
   * Whether this chunk is close enough to the camera to be worth refracting.
   *
   * Measured in chunks from the focus chunk rather than metres so it needs no
   * camera pose: the focus chunk already tracks the viewer. Distant water keeps
   * the plain variant, which is what lets a player away from the shore avoid the
   * viewport copies entirely.
   */
  isWithinRefractionRange() {
    const focus = this.terrainView.focusChunk;
    const descriptor = this.terrainSlot.descriptor;
    if (!focus || !descriptor) return false;
    return Math.abs(descriptor.chunkX - focus.chunkX) <= REFRACTION_CHUNK_RADIUS
      && Math.abs(descriptor.chunkZ - focus.chunkZ) <= REFRACTION_CHUNK_RADIUS;
  }

  resolveMaterial() {
    if (!this.hasWaterCoverage || !this.isWithinRefractionRange()) return this.material;
    const material = this.ensureRefractiveMaterial();
    const preparation = this.terrainView.drawPreparation;
    if (preparation && !preparation.isMaterialReady(this.mesh, material)) {
      preparation.requestMaterial(this.mesh, material);
      return this.material;
    }
    return material;
  }

  ensureRefractiveMaterial() {
    if (this.refractiveMaterial === null) {
      this.refractiveMaterial = this.createMaterial(true);
    }
    return this.refractiveMaterial;
  }

  uploadField(page) {
    if (page.waterFieldWidth !== this.fieldSize || page.waterFieldHeight !== this.fieldSize
        || page.waterFieldPixels?.length !== this.waterFieldPixels.length
        || page.waterFlowWidth !== this.fieldSize || page.waterFlowHeight !== this.fieldSize
        || page.waterFlowPixels?.length !== this.waterFlowPixels.length
        || page.waterAppearancePixels?.length !== this.waterAppearancePixels.length) {
      throw new Error('Terrain page water fields do not match their render slot.');
    }
    this.waterFieldPixels.set(page.waterFieldPixels);
    this.waterFlowPixels.set(page.waterFlowPixels);
    this.waterAppearancePixels.set(page.waterAppearancePixels);
    this.waterFieldTexture.needsUpdate = true;
    this.waterFlowTexture.needsUpdate = true;
    this.waterAppearanceTexture.needsUpdate = true;
    this.surfaceOrigin.value = page.waterFieldSurfaceOrigin ?? 0;
    this.uploadedPage = page;
    this.uploadedFieldRevision = page.waterFieldRevision ?? 0;
    // Recomputed per upload rather than carried on the page, so a runtime edit
    // that floods or drains this chunk re-decides whether it draws.
    this.hasWaterCoverage = waterFieldHasCoverage(this.waterFieldPixels);
    this.hasRiverWater = this.waterAppearancePixels.some((value, index) => index % 4 === 0 && value === 3);
    const uploadedBytes = page.waterFieldPixels.byteLength + page.waterFlowPixels.byteLength + page.waterAppearancePixels.byteLength;
    PerfCounters.inc(PERF_COUNTER_WATER_UPLOAD_BYTES, uploadedBytes);
    PerfCounters.inc('textureBytesUploaded', uploadedBytes);
    if (this.hasWaterCoverage) {
      const range = waterFieldSurfaceRange(this.waterFieldPixels);
      const origin = page.waterFieldSurfaceOrigin ?? 0;
      fitSlotBoundsToRange(
        this.mesh.geometry, range.min + origin, range.max + origin,
        this.terrainView.chunkWorldSize, 6,
      );
    }
  }

  update(timestamp) {
    if (!this.config.water.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.time.value = updateWaterVisualClock(timestamp / 1000);
    const descriptor = this.terrainSlot.descriptor;
    const page = this.terrainSlot.page;
    const ready = Boolean(
      this.terrainSlot.mesh.visible
      && descriptor
      && page?.waterFieldPixels
      && page?.waterFlowPixels,
    );
    if (!ready) {
      this.mesh.visible = false;
      return;
    }
    if (page !== this.uploadedPage
        || (page.waterFieldRevision ?? 0) !== this.uploadedFieldRevision) {
      this.uploadField(page);
    }
    // A chunk with no coverage anywhere must not draw. Its fragments would all
    // discard on alpha, but the refraction branch samples the viewport colour
    // and depth textures, and three.js copies both for the entire frame as soon
    // as one water mesh is submitted — so a dry chunk still costs the whole
    // scene a backbuffer copy, a depth copy and a mip chain.
    this.mesh.visible = this.hasWaterCoverage;
    PerfCounters.inc(
      this.hasWaterCoverage ? PERF_COUNTER_WATER_CHUNKS_WET : PERF_COUNTER_WATER_CHUNKS_DRY,
    );
    if (!this.hasWaterCoverage) return;
    const material = this.resolveMaterial();
    if (this.mesh.material !== material) this.mesh.material = material;
    if (material === this.refractiveMaterial) {
      PerfCounters.inc(PERF_COUNTER_WATER_CHUNKS_REFRACTIVE);
    }
    this.mesh.position.copy(this.terrainSlot.mesh.position);
    if (descriptor !== this.seaPhaseDescriptor) {
      this.waterObstaclePixels.fill(0); this.waterObstacleTexture.needsUpdate = true;
      this.seaPhaseDescriptor = descriptor;
      seaSwellPhaseOrigin(descriptor.centerWorldX, descriptor.centerWorldZ)
        .forEach((phase, index) => { this.seaPhaseOrigin[index].value = phase; });
      const tileSize = this.terrainView.worldStore.tileSize;
      this.rippleOrigin.value.set(
        Math.round(descriptor.originCellX * tileSize),
        Math.round(descriptor.originCellZ * tileSize),
      );
      const [patternX, patternZ] = waterfallPatternOrigin(descriptor.centerWorldX, descriptor.centerWorldZ);
      this.patternOrigin.value.set(patternX, patternZ);
      this.surfacePatterns.update(descriptor.centerWorldX, descriptor.centerWorldZ);
    }
  }

  dispose() {
    const terrainData = this.terrainSlot.mesh.userData?.[TERRAIN_SLOT_KEY];
    if (terrainData?.waterSlot === this) delete terrainData.waterSlot;
    this.terrainView.scene.remove(this.mesh);
    this.waterFieldTexture.dispose();
    this.waterFlowTexture.dispose();
    this.waterAppearanceTexture.dispose();
    this.waterObstacleTexture.dispose();
    if (!this.sharedMaterials) {
      this.material.dispose();
      this.refractiveMaterial?.dispose();
    }
  }
}
