import * as THREE from 'three/webgpu';
import { AzgaarMacroWorldGenerator } from './AzgaarMacroWorldGenerator.js';
import { AZGAAR_MACRO_SOURCE_KIND } from '../import/AzgaarMacroWorldSource.js';

const DEFAULT_RADIUS_METERS = 10000;
const DEFAULT_RESOLUTION = 128;
const DEFAULT_HEIGHT_BIAS = 3;
const FALLBACK_COLOR = '#3b4a57';

/**
 * Coarse distant-terrain backdrop for imported Azgaar worlds. Streamed chunks
 * only cover a small radius, so beyond them the world reads as empty sky. This
 * samples the in-memory macro atlas into one low-resolution mesh that follows
 * the floating origin and fills the horizon with plausible continents and
 * mountains. It never touches the chunk streamer, so it cannot regress the
 * chunk-boundary hitch profile — its only cost is one extra draw call plus a
 * rebuild when the floating origin snaps (rare, every few km of travel).
 */
export class MacroFarTerrainView {
  constructor({
    scene,
    worldStore,
    floatingOrigin,
    config,
    forestFieldProvider = null,
  }) {
    this.scene = scene;
    this.worldStore = worldStore;
    this.floatingOrigin = floatingOrigin;
    this.forestFieldProvider = forestFieldProvider;

    const farConfig = config.world?.farTerrain ?? {};
    this.enabled = farConfig.enabled !== false;
    this.radius = Number(farConfig.radiusMeters ?? DEFAULT_RADIUS_METERS);
    this.resolution = Math.max(2, Math.floor(farConfig.resolution ?? DEFAULT_RESOLUTION));
    this.heightBias = Number(farConfig.heightBias ?? DEFAULT_HEIGHT_BIAS);
    this.metadata = {
      seed: config.world.seed,
      version: config.world.generatorVersion,
      heightScale: config.world.heightScale,
      seaLevel: config.world.seaLevel,
    };

    this.generator = null;
    this.baseTerrainRef = null;
    this.builtOriginX = null;
    this.builtOriginZ = null;
    this.colorCache = new Map();
    this.builtForestSignature = null;

    const vertexCount = this.resolution * this.resolution;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(this.buildIndices());

    this.material = new THREE.MeshLambertNodeMaterial({ vertexColors: true, fog: true });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Draw before the detailed chunks so they occlude the backdrop up close.
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    this.mesh.name = 'macro-far-terrain';
    if (this.enabled) {
      this.scene.add(this.mesh);
    }
  }

  buildIndices() {
    const n = this.resolution;
    const indices = [];
    for (let j = 0; j < n - 1; j += 1) {
      for (let i = 0; i < n - 1; i += 1) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return indices;
  }

  ensureGenerator() {
    const baseTerrain = this.worldStore?.baseTerrain ?? null;
    if (baseTerrain === this.baseTerrainRef) {
      return this.generator;
    }
    this.baseTerrainRef = baseTerrain;
    this.generator = null;
    this.colorCache.clear();
    this.builtOriginX = null;
    this.builtOriginZ = null;
    if (baseTerrain?.kind === AZGAAR_MACRO_SOURCE_KIND) {
      try {
        this.generator = new AzgaarMacroWorldGenerator(baseTerrain, this.metadata);
      } catch (error) {
        console.error('Far-terrain backdrop could not build a macro generator.', error);
      }
    }
    return this.generator;
  }

  colorForTile(tileId) {
    let color = this.colorCache.get(tileId);
    if (!color) {
      const definition = this.generator.getTileDefinition(tileId);
      color = new THREE.Color(definition?.color ?? FALLBACK_COLOR);
      this.colorCache.set(tileId, color);
    }
    return color;
  }

  buildForestSignalGrid(originX, originZ) {
    const field = this.forestFieldProvider?.();
    if (!field) return null;
    const stride = 4;
    const size = Math.ceil((this.resolution - 1) / stride) + 1;
    const values = new Float32Array(size * size);
    const step = (2 * this.radius) / (this.resolution - 1);
    for (let gridZ = 0; gridZ < size; gridZ += 1) {
      const vertexZ = Math.min(this.resolution - 1, gridZ * stride);
      const canonicalZ = -this.radius + vertexZ * step + originZ;
      for (let gridX = 0; gridX < size; gridX += 1) {
        const vertexX = Math.min(this.resolution - 1, gridX * stride);
        const canonicalX = -this.radius + vertexX * step + originX;
        const habitat = field.sample(canonicalX, canonicalZ);
        values[gridZ * size + gridX] = habitat.patchCoverage
          * Math.min(1, habitat.suitability * 1.4);
      }
    }
    return { values, size, stride, signature: field.signature };
  }

  forestSignalAt(grid, x, z) {
    if (!grid) return 0;
    const gridX = x / grid.stride;
    const gridZ = z / grid.stride;
    const x0 = Math.min(grid.size - 1, Math.floor(gridX));
    const z0 = Math.min(grid.size - 1, Math.floor(gridZ));
    const x1 = Math.min(grid.size - 1, x0 + 1);
    const z1 = Math.min(grid.size - 1, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const bottom = grid.values[z0 * grid.size + x0] * (1 - tx)
      + grid.values[z0 * grid.size + x1] * tx;
    const top = grid.values[z1 * grid.size + x0] * (1 - tx)
      + grid.values[z1 * grid.size + x1] * tx;
    return bottom * (1 - tz) + top * tz;
  }

  rebuild(originX, originZ) {
    const n = this.resolution;
    const radius = this.radius;
    const step = (2 * radius) / (n - 1);
    const tileSize = this.worldStore.tileSize;
    const { positions, colors } = this;
    const forestGrid = this.buildForestSignalGrid(originX, originZ);

    for (let j = 0; j < n; j += 1) {
      const renderZ = -radius + j * step;
      const cellZ = Math.floor(-(renderZ + originZ) / tileSize);
      for (let i = 0; i < n; i += 1) {
        const renderX = -radius + i * step;
        const cellX = Math.floor((renderX + originX) / tileSize);
        const { height, tileId } = this.generator.sampleMacroColumn(cellX, cellZ);
        const offset = (j * n + i) * 3;
        positions[offset] = renderX;
        const forestSignal = this.forestSignalAt(forestGrid, i, j);
        const canopyRelief = forestSignal * (0.32 + ((i * 17 + j * 31) % 7) / 35);
        positions[offset + 1] = height - this.heightBias + canopyRelief;
        positions[offset + 2] = renderZ;
        const color = this.colorForTile(tileId);
        colors[offset] = color.r * (1 - forestSignal * 0.25);
        colors[offset + 1] = color.g * (1 - forestSignal * 0.14);
        colors[offset + 2] = color.b * (1 - forestSignal * 0.24);
      }
    }

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.builtOriginX = originX;
    this.builtOriginZ = originZ;
    this.builtForestSignature = forestGrid?.signature ?? null;
    this.mesh.visible = true;
  }

  isActive() {
    return this.enabled && !!this.generator;
  }

  update() {
    if (!this.enabled) return;
    const generator = this.ensureGenerator();
    if (!generator) {
      this.mesh.visible = false;
      return;
    }
    const origin = this.floatingOrigin.getState();
    const forestSignature = this.forestFieldProvider?.()?.signature ?? null;
    if (this.builtOriginX === origin.x && this.builtOriginZ === origin.z) {
      if (this.builtForestSignature === forestSignature) return;
    }
    this.rebuild(origin.x, origin.z);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
