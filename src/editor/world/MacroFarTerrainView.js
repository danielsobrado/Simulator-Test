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
  uniform,
} from 'three/tsl';
import { isAzgaarMacroWorldSource } from '../import/AzgaarMacroWorldSource.js';
import { createFarAlpineSurface } from './FarAlpineSurface.js';
import { settlementPreparationFor } from './settlements/SettlementPreparation.js';
import { stormSnowCoverUniform } from '../weather/storm/stormGroundUniforms.js';

const DEFAULT_RADIUS_METERS = 10000;
const DEFAULT_INNER_RADIUS_METERS = 256;
const DEFAULT_RADIAL_RESOLUTION = 160;
const DEFAULT_ANGULAR_RESOLUTION = 256;
const DEFAULT_RADIAL_FALLOFF = 2.2;
const DEFAULT_HEIGHT_BIAS = 3;
const DEFAULT_ROWS_PER_FRAME = 24;
const VERTICES_PER_STEP = 16;
const FALLBACK_COLOR = '#3b4a57';

const DEFAULT_ROCK_COLOR = '#8d9195';
const DEFAULT_SCREE_COLOR = '#6d7175';
const DEFAULT_SNOW_COLOR = '#e8eef2';

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
    this.preparation = settlementPreparationFor(worldStore);

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
    // Snow at any height by terrain tile (Azgaar biome id), as in the near bake.
    this.snowBiomeCover = { ...(farConfig.snowBiomeCover ?? {}) };
    // Glacier biomes' snow is mostly bare ice (biome-looks `glacier`, GlacierIceShading).
    this.glacierCover = { ...(farConfig.glacierCover ?? {}) };
    // Snowy biomes' ground where the snow does not hold, by their cover (applyBiomeLooks).
    this.snowBareColor = farConfig.snowBareColor ? new THREE.Color(farConfig.snowBareColor) : null;
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
    // Back buffers are retained between rebuilds to avoid an allocation burst on
    // every floating-origin snap. X/Z never change, so only height is rewritten.
    this.pendingPositions = new Float32Array(vertexCount * 3);
    this.pendingColors = new Float32Array(vertexCount * 3);
    this.pendingSnow = new Float32Array(vertexCount);
    this.pendingIce = new Float32Array(vertexCount);
    this.pendingNormals = new Float32Array(vertexCount * 3);
    this.normals = new Float32Array(vertexCount * 3);
    this.snow = new Float32Array(vertexCount);
    this.ice = new Float32Array(vertexCount);
    this.pendingHeights = new Float32Array(vertexCount);
    this.pendingTileIds = new Int32Array(vertexCount);
    this.pendingForest = new Float32Array(vertexCount);
    this.buildPlanarCoordinates();
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('snowCover', new THREE.BufferAttribute(this.snow, 1));
    this.geometry.setAttribute('iceCover', new THREE.BufferAttribute(this.ice, 1));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3));
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
    // colorNode replaces the built-in vertex-colour path, so the attribute is
    // read explicitly and vertexColors stays off to avoid applying it twice.
    const material = new THREE.MeshLambertNodeMaterial({ fog: true, side: THREE.DoubleSide });
    this.alpine = createFarAlpineSurface({
      vertexColor: attribute('color', 'vec3'),
      // A storm's snow lies on the far ground too, or the distance stays green under it.
      snowCover: attribute('snowCover', 'float').max(stormSnowCoverUniform),
      iceCover: attribute('iceCover', 'float'),
      snowColor: this.snowColor,
    });
    const ground = this.alpine.color;
    material.colorNode = ground;
    material.normalNode = this.alpine.normal;
    const aerial = config.stylizedSurface?.sky?.aerial;
    if (!aerial || !(aerial.strength > 0)) return material;

    // A uniform so the haze follows the sky's look (setFogColor).
    this.horizonBase = new THREE.Color(
      aerial.horizonColor ?? config.stylizedSurface?.sky?.fogColor ?? '#8ecef2',
    );
    this.fogBase = new THREE.Color(config.stylizedSurface?.sky?.fogColor ?? '#8ecef2');
    this.horizonColor = uniform(this.horizonBase.clone());
    const horizon = this.horizonColor;
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
    material.colorNode = mix(ground, horizon, haze);
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

  buildPlanarCoordinates() {
    const spokes = this.angularResolution;
    for (let ring = 0; ring < this.radialResolution; ring += 1) {
      const radius = this.radii[ring];
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        const angle = (spoke / spokes) * Math.PI * 2;
        const offset = (ring * spokes + spoke) * 3;
        this.pendingPositions[offset] = Math.cos(angle) * radius;
        this.pendingPositions[offset + 2] = Math.sin(angle) * radius;
      }
    }
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
    this.preparation.plans.release(this);
    this.generator = null;
    this.colorCache.clear();
    this.builtOriginX = null;
    this.builtOriginZ = null;
    this.job = null;
    if (isAzgaarMacroWorldSource(baseTerrain)) {
      this.generator = this.worldStore.generator;
    }
    return this.generator;
  }

  colorForTile(tileId) {
    let color = this.colorCache.get(tileId);
    if (!color) {
      const definition = this.generator.getTileDefinition(tileId);
      color = new THREE.Color(definition?.color ?? FALLBACK_COLOR);
      const cover = this.snowBiomeCover[tileId] ?? 0;
      // Snow country only (tundra, glacier): taiga and cold desert keep their own ground.
      if (this.snowBareColor && cover >= 0.5) color.lerp(this.snowBareColor, cover);
      this.colorCache.set(tileId, color);
    }
    return color;
  }

  /**
   * How wooded the ground at (x, z) reads from afar. `terrain` is the ring's own
   * macro tile, height and slope there, so the habitat does not re-query the
   * fine terrain five times a sample (see ForestHabitatField.sampleCoarse).
   */
  forestSignalAt(field, x, z, terrain = null) {
    if (!field) return 0;
    const habitat = field.sampleCoarse?.(x, z, terrain) ?? field.sample(x, z);
    return habitat.patchCoverage * Math.min(1, habitat.suitability * 1.4);
  }

  startJob(originX, originZ, field = this.forestFieldProvider?.() ?? null) {
    this.preparation.plans.release(this); this.sampleStepKey = null;
    this.job = {
      originX,
      originZ,
      sampleRing: 0,
      shadeRing: 0,
      sampleSpoke: 0,
      shadeSpoke: 0,
      field,
      forestSignature: field?.signature ?? null,
      heights: this.pendingHeights,
      tileIds: this.pendingTileIds,
      forest: this.pendingForest,
    };
  }

  /** Fills one ring of height and raw samples used by the shading pass. */
  sampleRing(job, ring, start = 0, end = this.angularResolution) {
    const spokes = this.angularResolution;
    const tileSize = this.worldStore.tileSize;
    for (let spoke = start; spoke < end; spoke += 1) {
      const index = ring * spokes + spoke;
      const offset = index * 3;
      const cellX = Math.floor((this.pendingPositions[offset] + job.originX) / tileSize);
      const cellZ = Math.floor(-(this.pendingPositions[offset + 2] + job.originZ) / tileSize);
      const { height, tileId } = this.generator.sampleMacroColumn(cellX, cellZ);
      job.heights[index] = height;
      job.tileIds[index] = tileId;
      // The canopy lifts it in the shading pass, once the ring slopes are known.
      this.pendingPositions[offset + 1] = height - this.heightBias;
    }
  }

  samplePreparedRing(job, ring, start, end, shouldYield) {
    if (!this.worldStore.chunkWorker) { this.sampleRing(job, ring, start, end); return true; }
    const { plans, registry } = this.preparation, field = this.preparation.field(this.generator);
    if (!field && (registry.pending || registry.errors.length)) return false;
    const key = `${ring}:${start}`;
    if (key !== this.sampleStepKey) { plans.begin(this); this.sampleStepKey = key; }
    let units = 0;
    plans.advance(shouldYield ?? (() => ++units > 2));
    const previous = field?.requirePreparedPlans;
    if (field) field.requirePreparedPlans = true;
    try {
      this.sampleRing(job, ring, start, end);
      plans.release(this); this.sampleStepKey = null;
      return true;
    } catch (error) {
      if (error.code !== 'settlement_plan_required') throw error;
      plans.get(field.findById(error.settlementId), 0, this); plans.end();
      return false;
    } finally { if (field) field.requirePreparedPlans = previous; }
  }

  /**
   * Slope from ring and spoke neighbours, normalised by their real spacing —
   * radial spacing grows toward the rim, so a raw difference would read the far
   * field as flat.
   */
  /**
   * Smooth normal, the mean of the four faces round the vertex. Differencing the
   * neighbours alone never reads the vertex's own height, which lets odd and even
   * vertices drift apart into a checkerboard.
   */
  writeNormal(job, ring, spoke, index) {
    const spokes = this.angularResolution;
    const offset = index * 3;
    const px = this.pendingPositions[offset], py = job.heights[index], pz = this.pendingPositions[offset + 2];
    const edge = (r, sp) => {
      const i = r * spokes + (sp + spokes) % spokes;
      return [this.pendingPositions[i * 3] - px, job.heights[i] - py, this.pendingPositions[i * 3 + 2] - pz];
    };
    const around = [
      edge(ring, spoke + 1), edge(Math.min(ring + 1, this.radialResolution - 1), spoke),
      edge(ring, spoke - 1), edge(Math.max(ring - 1, 0), spoke),
    ];
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4; i += 1) {
      const [ax, ay, az] = around[i], [bx, by, bz] = around[(i + 1) % 4];
      const fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      const flip = fy < 0 ? -1 : 1;
      nx += fx * flip; ny += fy * flip; nz += fz * flip;
    }
    const length = Math.hypot(nx, ny, nz) || 1;
    this.pendingNormals[offset] = nx / length;
    this.pendingNormals[offset + 1] = ny / length;
    this.pendingNormals[offset + 2] = nz / length;
  }

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

  shadeRing(job, ring, start = 0, end = this.angularResolution) {
    const spokes = this.angularResolution;
    for (let spoke = start; spoke < end; spoke += 1) {
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

      // Snow settles above the snow line and on snowy biomes at any height; the
      // shader decides per pixel which faces hold it (createMaterial).
      const altitude = Math.max(
        Math.min(1, Math.max(0, (height - this.snowLine) / this.snowFade)),
        this.snowBiomeCover[job.tileIds[index]] ?? 0,
      );
      this.pendingSnow[index] = altitude;
      this.pendingIce[index] = this.glacierCover?.[job.tileIds[index]] ?? 0;
      this.writeNormal(job, ring, spoke, index);

      // The forest reads the ring's own tile, height and slope: at this spacing
      // they are what the backdrop draws, and the fine terrain is five queries
      // a sample through the water-terrain model.
      const offset = index * 3;
      const forestSignal = this.forestSignalAt(
        job.field,
        this.pendingPositions[offset] + job.originX,
        this.pendingPositions[offset + 2] + job.originZ,
        { tileId: job.tileIds[index], elevation: height, slope },
      );
      job.forest[index] = forestSignal;
      this.pendingPositions[offset + 1] += forestSignal * (0.32 + ((ring * 17 + spoke * 31) % 7) / 35);
      this.pendingColors[offset] = red * (1 - forestSignal * 0.25);
      this.pendingColors[offset + 1] = green * (1 - forestSignal * 0.14);
      this.pendingColors[offset + 2] = blue * (1 - forestSignal * 0.24);
    }
  }

  advanceRings(job, phase, shouldYield) {
    const ringKey = `${phase}Ring`, spokeKey = `${phase}Spoke`;
    const limit = Math.min(this.radialResolution, job[ringKey] + this.rowsPerFrame);
    while (job[ringKey] < limit) {
      const start = job[spokeKey] ?? 0;
      const end = Math.min(this.angularResolution, start + VERTICES_PER_STEP);
      if (phase === 'sample') {
        if (!this.samplePreparedRing(job, job[ringKey], start, end, shouldYield)) return;
      } else this[ringKey](job, job[ringKey], start, end);
      job[spokeKey] = end === this.angularResolution ? 0 : end;
      if (end === this.angularResolution) job[ringKey]++;
      if (shouldYield?.()) break;
    }
  }

  /** Advances a phase with deadline checks every sixteen vertices. */
  advanceJob(shouldYield = null) {
    const job = this.job;
    const rings = this.radialResolution;
    if (job.sampleRing < rings) {
      this.advanceRings(job, 'sample', shouldYield);
      return false;
    }

    if (job.shadeRing < rings) {
      this.advanceRings(job, 'shade', shouldYield);
      if (job.shadeRing < rings) return false;
    }

    if (shouldYield?.()) return false;
    this.positions.set(this.pendingPositions);
    this.colors.set(this.pendingColors);
    this.snow.set(this.pendingSnow);
    this.ice.set(this.pendingIce);
    this.normals.set(this.pendingNormals);
    this.alpine?.setOrigin(this.floatingOrigin.getState());
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('color').needsUpdate = true;
    this.geometry.getAttribute('snowCover').needsUpdate = true;
    this.geometry.getAttribute('iceCover').needsUpdate = true;
    this.geometry.getAttribute('normal').needsUpdate = true;
    // The backdrop is never frustum-culled, so recomputing bounds here only
    // adds a full-vertex pass to the origin-snap publication frame.
    this.builtOriginX = job.originX;
    this.builtOriginZ = job.originZ;
    this.builtForestSignature = job.forestSignature;
    this.mesh.visible = true;
    this.job = null;
    return true;
  }

  /**
   * Tint the haze as the scene fog changes colour (a new time of day or
   * weather). The configured horizon keeps its relation to the configured fog.
   */
  setFogColor(fogColor) {
    if (!this.horizonColor) return;
    const fog = new THREE.Color(fogColor);
    const ratio = (channel) => (this.fogBase[channel] > 1e-4 ? fog[channel] / this.fogBase[channel] : 1);
    this.horizonColor.value.setRGB(
      Math.min(1, this.horizonBase.r * ratio('r')),
      Math.min(1, this.horizonBase.g * ratio('g')),
      Math.min(1, this.horizonBase.b * ratio('b')),
    );
  }

  isActive() {
    return this.enabled && !!this.generator;
  }

  getPreparationStatus() {
    if (!this.enabled || !isAzgaarMacroWorldSource(this.worldStore?.baseTerrain)) return { ready: true };
    const origin = this.floatingOrigin.getState();
    const signature = this.forestFieldProvider?.()?.signature ?? null;
    return { ready: !this.job && this.builtOriginX === origin.x && this.builtOriginZ === origin.z
        && this.builtForestSignature === signature,
      samplingRing: this.job?.sampleRing ?? null, shadingRing: this.job?.shadeRing ?? null };
  }

  update(shouldYield = null) {
    if (!this.enabled) return;
    const generator = this.ensureGenerator();
    if (!generator) {
      this.mesh.visible = false;
      return;
    }

    const origin = this.floatingOrigin.getState();
    const field = this.forestFieldProvider?.() ?? null;
    const forestSignature = field?.signature ?? null;
    if (this.job) {
      if (
        this.job.originX !== origin.x
        || this.job.originZ !== origin.z
        || this.job.forestSignature !== forestSignature
      ) {
        this.startJob(origin.x, origin.z, field);
      }
      this.advanceJob(shouldYield);
      return;
    }

    if (this.builtOriginX === origin.x && this.builtOriginZ === origin.z) {
      if (this.builtForestSignature === forestSignature) return;
    }
    this.startJob(origin.x, origin.z, field);
    this.advanceJob(shouldYield);
  }

  dispose() {
    this.preparation.plans.release(this);
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
