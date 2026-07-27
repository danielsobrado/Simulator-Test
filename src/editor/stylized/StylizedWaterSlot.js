import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { createStylizedWaterMaterial } from './StylizedWaterMaterial.js';
import { installTerrainWaterQueries } from '../water/TerrainWaterQueries.js';

const DEFAULT_WATER_LEVEL = 0;

export function resolveWaterSurfaceHeight(terrainView) {
  const generatorLevel = terrainView?.worldStore?.generator?.toMetadata?.().seaLevel;
  if (Number.isFinite(generatorLevel)) return generatorLevel;
  const configuredLevel = terrainView?.streamingConfig?.seaLevel;
  return Number.isFinite(configuredLevel) ? configuredLevel : DEFAULT_WATER_LEVEL;
}

export class StylizedWaterSlot {
  constructor({ terrainSlot, terrainView, config }) {
    installTerrainWaterQueries(terrainView);
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.config = config;
    this.time = uniform(0);
    this.material = createStylizedWaterMaterial({
      surfaceMaskTexture: terrainSlot.surfaceMaskTexture,
      chunkCenter: terrainSlot.chunkCenter,
      chunkWorldSize: terrainView.chunkWorldSize,
      waterLevel: resolveWaterSurfaceHeight(terrainView),
      time: this.time,
      config,
    });
    this.mesh = new THREE.Mesh(terrainView.geometry, this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.name = `stylized-water-${terrainSlot.slotIndex}`;
    terrainView.scene.add(this.mesh);
  }

  update(timestamp) {
    if (!this.config.water.enabled) {
      this.mesh.visible = false;
      return;
    }
    this.time.value = timestamp / 1000;
    const descriptor = this.terrainSlot.descriptor;
    this.mesh.visible = Boolean(this.terrainSlot.mesh.visible && descriptor);
    if (!this.mesh.visible || !descriptor) return;
    this.mesh.position.copy(this.terrainSlot.mesh.position);
  }

  dispose() {
    this.terrainView.scene.remove(this.mesh);
    this.material.dispose();
  }
}
