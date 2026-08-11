import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  clamp,
  distance,
  mix,
  oneMinus,
  positionWorld,
  smoothstep,
  vec3,
} from 'three/tsl';
import { createWorldGenerator } from './WorldGeneratorFactory.js';
import { isAzgaarMacroWorldSource } from '../import/AzgaarMacroWorldSource.js';

const DEFAULT_RADIUS_METERS = 10000;
const DEFAULT_INNER_RADIUS_METERS = 256;
const DEFAULT_RADIAL_RESOLUTION = 160;
const DEFAULT_ANGULAR_RESOLUTION = 256;
const DEFAULT_RADIAL_FALLOFF = 2.2;
const DEFAULT_HEIGHT_BIAS = 3;
const DEFAULT_ROWS_PER_FRAME = 24;
const FALLBACK_COLOR = '#3b4a57';

const DEFAULT_ROCK_COLOR = '#8d9195';
const DEFAULT_SCREE_COLOR = '#6d7175';
const DEFAULT_SNOW_COLOR = '#e8eef2';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

/**
 * Coarse distant-terrain backdrop for imported Azgaar worlds. Streamed chunks
 * only cover a small radius, so beyond them the world reads as empty sky. This
 * samples the in-memory macro atlas into one mesh that follows the floating
 * origin and fills the horizon with continents and mountains. It never touches
 * the chunk streamer, so it cannot regress the chunk-boundary hitch profile.
 *
 * The grid is polar and radially graded rather than uniform. A uniform grid over
 * a 60 km radius spends most of its vertices on the far rim where they resolve
 * nothing, leaving roughly 750 m per vertex in the near band where mountains are
 * actually read — silhouettes came out as blobs. Concentrating vertices toward
 * the camera cuts near-band spacing several-fold for the same vertex budget,
 * with no ring seams to crack and still a single draw call.
 *
 * Rebuilds are sliced across frames into a back buffer and swapped when
 * complete, so an origin snap cannot spike a frame and the mesh never tears.
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
    this.innerRadius = Math.max(1, Number(
      farConfig.innerRadiusMeters ?? DEFAULT_INNER_RADIUS_METERS,
    ));
    // `resolution` stays supported as the radial ring count so existing configs
    // keep working; the angular count is independent.
    this.radialResolution = Math.max(2, Math.floor(
      farConfig.radialResolution ?? farConfig.resolution ?? DEFAULT_RADIAL_RESOLUTION,
    ));
    this.angularResolution = Math.max(8, Math.floor(
      farConfig.angularResolution ?? DEFAULT_ANGULAR_RESOLUTION,
    ));
    this.radialFalloff = Math.max(1, Number(
      farConfig.radialFalloff ?? DEFAULT_RADIAL_FALLOFF,
    ));
    this.heightBias = Number(farConfig.heightBias ?? DEFAULT_HEIGHT_BIAS);
    this.rowsPerFrame = Math.max(1, Math.floor(
      farConfig.rebuildRowsPerFrame ?? DEFAULT_ROWS_PER_FRAME,
    ));

    this.rockColor = new THREE.Color(farConfig.rockColor ?? DEFAULT_ROCK_COLOR);
    this.screeColor = new THREE.Color(farConfig.screeColor ?? DEFAULT_SCREE_COLOR);
    this.snowColor = new THREE.Color(farConfig.snowColor ?? DEFAULT_SNOW_COLOR);
    this.snowLine = Number(farConfig.snowLine ?? 26);
    this.snowFade = Math.max(0.001, Number(farConfig.snowFade ?? 8));
    this.snowSlopeMax = Math.max(0.001, Number(farConfig.snowSlopeMax ?? 0.55));
    this.rockSlopeStart = Math.max(0, Number(farConfig.rockSlopeStart ?? 0.18));
    this.rockSlopeFull = Math.max(
      this.rockSlopeStart + 0.001,
      Number(farConfig.rockSlopeFull ?? 0.62),
    );

    this.generator = null;
    this.baseTerrainRef = null;
    this.builtOriginX = null;
    this.builtOriginZ = null;
    this.colorCache = new Map();
    this.builtForestSignature = null;
    this.job = null;

    this.radii = this.buildRadii();
    const vertexCount = this.radialResolution * this.angularResolution;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    // Back buffers: a sliced rebuild fills these and swaps in when finished, so
    // the visible mesh never shows half-old, half-new terrain.
    this.pendingPositions = new Float32Array(vertexCount * 3);
    this.pendingColors = new Float32Array(vertexCount * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(this.buildIndices());

    this.material = this.createMaterial(config);
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

  /**
   * Aerial perspective: distance and height both fade the backdrop toward the
   * sky horizon, so far ranges sit behind near ones instead of all reading at
   * the same contrast. Done in the shader rather than baked into vertex colours
   * so it tracks the camera between origin snaps.
   */
  createMaterial(config) {
    const aerial = config.stylizedSurface?.sky?.aerial;
    if (!aerial || !(aerial.strength > 0)) {
      return new THREE.MeshLambertNodeMaterial({ vertexColors: true, fog: true });
    }

    // colorNode replaces the built-in vertex-colour path, so the attribute is
    // read explicitly and vertexColors stays off to avoid applying it twice.
    const material = new THREE.MeshLambertNodeMaterial({ fog: true });
    const horizon = colorNode(
      aerial.horizonColor ?? config.stylizedSurface?.sky?.fogColor ?? '#8ecef2',
    );
    const distanceHaze = smoothstep(
      aerial.startDistance ?? this.innerRadius,
      aerial.endDistance ?? this.radius,
      distance(cameraPosition, positionWorld),
    );
    // Peaks rise clear of the haze layer; valley floors stay buried in it.
    const heightRelief = smoothstep(
      aerial.heightFloor ?? 0,
      aerial.heightCeiling ?? 220,
      positionWorld.y.sub(cameraPosition.y),
    );
    const haze = clamp(
      distanceHaze
        .mul(oneMinus(heightRelief.mul(aerial.heightFalloff ?? 0.55)))
        .mul(aerial.strength),
      0,
      1,
    );
    material.colorNode = mix(attribute('color', 'vec3'), horizon, haze);
    return material;
  }

  buildRadii() {
    const radii = new Float32Array(this.radialResolution);
    const span = this.radius - this.innerRadius;
    const last = this.radialResolution - 1;
    for (let ring = 0; ring < this.radialResolution; ring += 1) {
      radii[ring] = this.innerRadius + span * (ring / last) ** this.radialFalloff;
    }
    return radii;
  }

  buildIndices() {
    const rings = this.radialResolution;
    const spokes = this.angularResolution;
    const indices = [];
    for (let ring = 0; ring < rings - 1; ring += 1) {
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        const nextSpoke = (spoke + 1) % spokes;
        const a = ring * spokes + spoke;
        const b = ring * spokes + nextSpoke;
        const c = (ring + 1) * spokes + spoke;
        const d = (ring + 1) * spokes + nextSpoke;
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
    this.job = null;
    if (isAzgaarMacroWorldSource(baseTerrain)) {
      try {
        this.generator = createWorldGenerator(
          this.worldStore.generator.toMetadata(),
          baseTerrain,
        );
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

  forestSignalAt(field, x, z) {
    if (!field) return 0;
    const habitat = field.sample(x, z);
    return habitat.patchCoverage * Math.min(1, habitat.suitability * 1.4);
  }

  startJob(originX, originZ) {
    const field = this.forestFieldProvider?.();
    this.job = {
      originX,
      originZ,
      ring: 0,
      field,
      forestSignature: field?.signature ?? null,
      // Heights are needed by the shading pass, which reads ring neighbours.
      heights: new Float32Array(this.radialResolution * this.angularResolution),
      tileIds: new Int32Array(this.radialResolution * this.angularResolution),
      forest: new Float32Array(this.radialResolution * this.angularResolution),
    };
  }

  /** Fills one ring of positions and the raw samples the shading pass needs. */
  sampleRing(job, ring) {
    const spokes = this.angularResolution;
    const tileSize = this.worldStore.tileSize;
    const radius = this.radii[ring];
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const angle = (spoke / spokes) * Math.PI * 2;
      const renderX = Math.cos(angle) * radius;
      const renderZ = Math.sin(angle) * radius;
      const canonicalX = renderX + job.originX;
      const canonicalZ = renderZ + job.originZ;
      const cellX = Math.floor(canonicalX / tileSize);
      const cellZ = Math.floor(-canonicalZ / tileSize);
      const { height, tileId } = this.generator.sampleMacroColumn(cellX, cellZ);
      const index = ring * spokes + spoke;
      const forestSignal = this.forestSignalAt(job.field, canonicalX, canonicalZ);
      const canopyRelief = forestSignal * (0.32 + ((ring * 17 + spoke * 31) % 7) / 35);
      job.heights[index] = height;
      job.tileIds[index] = tileId;
      job.forest[index] = forestSignal;
      const offset = index * 3;
      this.pendingPositions[offset] = renderX;
      this.pendingPositions[offset + 1] = height - this.heightBias + canopyRelief;
      this.pendingPositions[offset + 2] = renderZ;
    }
  }

  /**
   * Slope from ring and spoke neighbours, normalised by their real spacing —
   * radial spacing grows toward the rim, so a raw difference would read the far
   * field as flat.
   */
  slopeAt(job, ring, spoke) {
    const spokes = this.angularResolution;
    const rings = this.radialResolution;
    const innerRing = Math.max(0, ring - 1);
    const outerRing = Math.min(rings - 1, ring + 1);
    const radialSpan = Math.max(1e-3, this.radii[outerRing] - this.radii[innerRing]);
    const radialDelta = job.heights[outerRing * spokes + spoke]
      - job.heights[innerRing * spokes + spoke];
    const previousSpoke = (spoke - 1 + spokes) % spokes;
    const nextSpoke = (spoke + 1) % spokes;
    const angularSpan = Math.max(
      1e-3,
      (2 * Math.PI * this.radii[ring]) / spokes * 2,
    );
    const angularDelta = job.heights[ring * spokes + nextSpoke]
      - job.heights[ring * spokes + previousSpoke];
    return Math.hypot(radialDelta / radialSpan, angularDelta / angularSpan);
  }

  shadeRing(job, ring) {
    const spokes = this.angularResolution;
    for (let spoke = 0; spoke < spokes; spoke += 1) {
      const index = ring * spokes + spoke;
      const height = job.heights[index];
      const slope = this.slopeAt(job, ring, spoke);
      const base = this.colorForTile(job.tileIds[index]);

      // Steep ground sheds soil: biome colour gives way to scree, then bare rock.
      const rockAmount = Math.min(1, Math.max(
        0,
        (slope - this.rockSlopeStart) / (this.rockSlopeFull - this.rockSlopeStart),
      ));
      let red = base.r + (this.screeColor.r - base.r) * Math.min(1, rockAmount * 1.6);
      let green = base.g + (this.screeColor.g - base.g) * Math.min(1, rockAmount * 1.6);
      let blue = base.b + (this.screeColor.b - base.b) * Math.min(1, rockAmount * 1.6);
      red += (this.rockColor.r - red) * rockAmount;
      green += (this.rockColor.g - green) * rockAmount;
      blue += (this.rockColor.b - blue) * rockAmount;

      // Snow settles above the snow line but not on faces too steep to hold it.
      const altitude = Math.min(1, Math.max(0, (height - this.snowLine) / this.snowFade));
      const snowAmount = altitude * Math.min(1, Math.max(
        0,
        1 - slope / this.snowSlopeMax,
      ));
      red += (this.snowColor.r - red) * snowAmount;
      green += (this.snowColor.g - green) * snowAmount;
      blue += (this.snowColor.b - blue) * snowAmount;

      const forestSignal = job.forest[index];
      const offset = index * 3;
      this.pendingColors[offset] = red * (1 - forestSignal * 0.25);
      this.pendingColors[offset + 1] = green * (1 - forestSignal * 0.14);
      this.pendingColors[offset + 2] = blue * (1 - forestSignal * 0.24);
    }
  }

  /** Advances a sliced rebuild; returns true when the job completed this call. */
  advanceJob() {
    const job = this.job;
    const rings = this.radialResolution;
    const limit = Math.min(rings, job.ring + this.rowsPerFrame);
    for (let ring = job.ring; ring < limit; ring += 1) {
      this.sampleRing(job, ring);
    }
    job.ring = limit;
    if (job.ring < rings) return false;

    // Shading needs every ring's heights, so it runs once sampling completes.
    for (let ring = 0; ring < rings; ring += 1) {
      this.shadeRing(job, ring);
    }
    this.positions.set(this.pendingPositions);
    this.colors.set(this.pendingColors);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.builtOriginX = job.originX;
    this.builtOriginZ = job.originZ;
    this.builtForestSignature = job.forestSignature;
    this.mesh.visible = true;
    this.job = null;
    return true;
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
    if (this.job) {
      this.advanceJob();
      return;
    }
    const origin = this.floatingOrigin.getState();
    const forestSignature = this.forestFieldProvider?.()?.signature ?? null;
    if (this.builtOriginX === origin.x && this.builtOriginZ === origin.z) {
      if (this.builtForestSignature === forestSignature) return;
    }
    this.startJob(origin.x, origin.z);
    this.advanceJob();
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
