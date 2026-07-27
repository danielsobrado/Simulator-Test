import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { markAttributeRangeUpdated } from './attributeUpload.js';
import { createStylizedGrassMaterial } from './StylizedGrassMaterial.js';
import { cellSampleRandom01, grassClumpCellOffset, sampleHeight } from './scatterMath.js';
import {
  clumpsPerCell,
  densityForDistance,
  grassLodBand,
  trianglesPerBlade,
} from './grassLodMath.js';
import { generatedProfile, resampleProfile } from './grassBladeProfiles.js';
import { filterScatterByForest } from './forest/ForestFloor.js';
import {
  compactGrassScatter,
} from './vegetationScatter.js';

const BLADE_SEGMENTS = 3;
// One triangle per blade. The far band is not meant to survive inspection — it
// exists so real grass reaches past the near ring at a fifth of its cost.
const FAR_BLADE_SEGMENTS = 1;
const TWO_PI = Math.PI * 2;
// Sunflower packing: successive blades land the most irrelevant angle apart, so a
// clump fills its disc evenly at any blade count instead of forming rings.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// In metres. Against a mean clump spacing of 0.82 m this overlaps generously,
// which is what hides the streamed clump representation and makes the field read
// like upstream's independently scattered blades. `clumpsFormCarpet` in
// grassLodMath guards it against future density changes.
//
// This used to be 12.5 *blade-widths*, resolved against the instance width in the
// shader. That tied the footprint to the blade silhouette: the 0.06 m blade it was
// tuned against gave 0.75 m, but narrowing blades to stop them reading as ribbons
// would have shrunk it to ~0.29 m and turned the carpet into pom-poms. The two are
// separate channels now — `position` carries only the blade's own half-width, in
// blade-widths, and `bladeCenter` carries the clump offset, in metres.
const DEFAULT_CLUMP_RADIUS = 0.75;
const DEFAULT_TILT_MAX = 0.28;

function fract(value) {
  return value - Math.floor(value);
}

function bladeRandom01(bladeIndex, salt) {
  return fract(Math.sin((bladeIndex + 1) * 12.9898 + salt * 78.233) * 43758.5453);
}
const DEFAULT_BUILD_SLICE_CELLS = 64;
const DEFAULT_INACTIVE_RELEASE_FRAMES = 30;
const DEFAULT_BLADES_PER_CLUMP = 8;
const DEFAULT_INFLUENCE_TEXTURE_SIZE = 32;

// Local XZ is in blade widths — the shader scales the whole clump by the instance's
// blade width — so a profile's peak half-width lands here, matching the width the
// old generated taper carried at its base.
const PEAK_HALF_WIDTH = 0.5;

/**
 * Blade geometry for one clump.
 *
 * `segments` sets the blade's height divisions and so its cost: 3 gives the
 * tapered five-triangle blade used up close, 1 collapses it to a single triangle
 * for the far band. The clump layout is identical either way, so the same instance
 * data drives both and a chunk can switch bands without rebuilding.
 *
 * `profiles` are blade silhouettes already resampled to `segments` (see
 * grassBladeProfiles.js). Blades draw from the pool by their own deterministic
 * roll, so one clump carries several authored shapes rather than a field of
 * identical strips. Omit it and every blade falls back to the generated taper.
 *
 * `instanceBase` and `instanceParams` are passed in rather than allocated here
 * precisely so the two bands share them — at 24k instances a chunk, duplicating
 * them per band would cost more memory than the whole blade mesh saves.
 */
export function createClumpGeometry({
  bladesPerClump,
  segments = BLADE_SEGMENTS,
  tiltMax = DEFAULT_TILT_MAX,
  clumpRadius = DEFAULT_CLUMP_RADIUS,
  instanceBase,
  instanceParams,
  profiles,
}) {
  const shapes = profiles?.length
    ? profiles
    : [resampleProfile(generatedProfile(), segments)];
  const verticesPerBlade = segments * 2 + 1;
  const vertexCount = bladesPerClump * verticesPerBlade;
  const positions = new Float32Array(vertexCount * 3);
  // WebGPU allows eight vertex buffers per pipeline and `position` plus the two
  // shared instance attributes claim three of them, so the per-blade data is
  // packed rather than given one buffer per concept. Unpacked it was nine buffers
  // and the pipeline simply failed to create — a blank field, not a slow one.
  // Four packed buffers plus those three leaves one spare. See the accessor
  // comments below for what sits in each channel.
  const bladeAxes = new Float32Array(vertexCount * 4);
  const bladeCenters = new Float32Array(vertexCount * 4);
  const bladeShapes = new Float32Array(vertexCount * 4);
  const bladeWinds = new Float32Array(vertexCount * 4);
  const indices = [];

  for (let bladeIndex = 0; bladeIndex < bladesPerClump; bladeIndex += 1) {
    // Golden-angle spiral rather than evenly spaced phases on three fixed radii.
    // The old layout was invisible at eight blades but turns into concentric
    // rings the moment a clump carries a few dozen, which is exactly what the
    // dense settings ask for. `sqrt` keeps area density uniform across the disc
    // instead of crowding the centre.
    const phase = bladeIndex * GOLDEN_ANGLE;
    const radial = clumpRadius * Math.sqrt((bladeIndex + 0.5) / bladesPerClump);
    const centerX = Math.cos(phase) * radial;
    const centerZ = Math.sin(phase) * radial;
    // Facing must not follow the placement spiral. Tangential blades reveal the
    // hidden clump as circular combs once wind leans them; upstream gives every
    // independently-scattered blade its own random yaw.
    const orientation = bladeRandom01(bladeIndex, 1) * TWO_PI;
    const axisX = Math.cos(orientation);
    const axisZ = Math.sin(orientation);
    const vertexBase = bladeIndex * verticesPerBlade;
    // Upstream chooses a full min→max length independently for every blade.
    // Store the random phase rather than shortening the normalized geometry:
    // the shader combines it with the clump seed and the configured range. This
    // keeps the tip at normalized y=1 for colour/wind masks while avoiding the
    // old 0.62→1 multiplier that made the field both shorter and darker.
    const lengthPhase = bladeRandom01(bladeIndex, 3);
    // Upstream scatters every blade with up to 0.16 radians of tilt. A clump is
    // one instance here, so the equivalent variation is baked per blade into
    // vertex attributes and scaled by that clump's instance length in the shader.
    // Two independent rolls the shader spends on colour: one picks the blade's
    // place on the cool→warm ramp, the other its brightness. Upstream gets this
    // for free — every blade is its own instance, so its base samples the patch
    // noise at a different point. Batched clumps land 96 blades on one sample,
    // which is what collapses a dense field into a single flat green.
    const tintPhase = bladeRandom01(bladeIndex, 4);
    const shadePhase = bladeRandom01(bladeIndex, 5);
    // Width is rolled per blade for the same reason colour is: `instanceParams.x`
    // is the clump's width, so without this all 96 blades of a clump are exactly
    // as wide as each other and the batching unit becomes visible as patches of
    // one gauge. The shader leans this roll against the blade's own length, so a
    // long blade tends to come out slender and a short one broad.
    const widthPhase = bladeRandom01(bladeIndex, 7);
    // Wind rolls. A clump is under a metre across and the gust wave is ~13 m long,
    // so every blade in it sits on effectively one point of that wave; without a
    // per-blade phase and stiffness the clump sways as a single surface.
    const windPhase = bladeRandom01(bladeIndex, 8);
    const stiffness = bladeRandom01(bladeIndex, 9);
    const flutter = bladeRandom01(bladeIndex, 10);
    // Which authored silhouette this blade wears. Rolled per blade rather than
    // assigned per clump: a clump is a hidden batching unit, and giving one shape
    // to all 96 of its blades would make that unit visible as patches of a single
    // outline across the field.
    const shape = shapes[Math.floor(bladeRandom01(bladeIndex, 6) * shapes.length) % shapes.length];
    const tiltPhase = bladeRandom01(bladeIndex, 2) * TWO_PI;
    const tilt = Math.tan(tiltMax * fract((bladeIndex + 1) * 0.754877666));
    const leanX = Math.cos(tiltPhase) * tilt;
    const leanZ = Math.sin(tiltPhase) * tilt;
    const facingX = -axisZ;
    const facingZ = axisX;
    // Every vertex of a blade carries the same per-blade data; only which row of
    // the profile it sits on differs. `bladeFacing.y` is not stored at all — it is
    // always zero, and a channel is worth more than restating that.
    const writeBladeVertex = (vertex, row) => {
      bladeAxes[vertex * 4] = leanX;
      bladeAxes[vertex * 4 + 1] = leanZ;
      bladeAxes[vertex * 4 + 2] = facingX;
      bladeAxes[vertex * 4 + 3] = facingZ;
      bladeCenters[vertex * 4] = centerX;
      bladeCenters[vertex * 4 + 1] = centerZ;
      bladeCenters[vertex * 4 + 2] = lengthPhase;
      bladeCenters[vertex * 4 + 3] = widthPhase;
      bladeWinds[vertex * 4] = windPhase;
      bladeWinds[vertex * 4 + 1] = stiffness;
      bladeWinds[vertex * 4 + 2] = flutter;
      bladeWinds[vertex * 4 + 3] = 0;
      bladeShapes[vertex * 4] = tintPhase;
      bladeShapes[vertex * 4 + 1] = shadePhase;
      // The arc is in blade lengths, not blade widths, so it cannot be folded into
      // `position` — the shader scales local XZ by the instance's width. It rides
      // along the blade's own width axis, which is where the authored card bends.
      bladeShapes[vertex * 4 + 2] = axisX * shape.curve[row];
      bladeShapes[vertex * 4 + 3] = axisZ * shape.curve[row];
    };

    // `position` holds the blade's own half-width offset only, still in
    // blade-widths, so the shader can scale it by the instance's width without
    // dragging the clump's layout along with it. The offset the blade sits at
    // inside its clump is in `bladeCenter`, in metres.
    for (let segment = 0; segment < segments; segment += 1) {
      const t = segment / segments;
      const width = shape.halfWidth[segment] * PEAK_HALF_WIDTH;
      const left = (vertexBase + segment * 2) * 3;
      const right = left + 3;
      positions[left] = -axisX * width;
      positions[left + 1] = t;
      positions[left + 2] = -axisZ * width;
      positions[right] = axisX * width;
      positions[right + 1] = t;
      positions[right + 2] = axisZ * width;
      for (const vertex of [vertexBase + segment * 2, vertexBase + segment * 2 + 1]) {
        writeBladeVertex(vertex, segment);
      }
    }

    const tipVertex = vertexBase + segments * 2;
    const tip = tipVertex * 3;
    positions[tip] = 0;
    positions[tip + 1] = 1;
    positions[tip + 2] = 0;
    writeBladeVertex(tipVertex, segments);

    for (let segment = 0; segment < segments - 1; segment += 1) {
      const left = vertexBase + segment * 2;
      const right = left + 1;
      const nextLeft = left + 2;
      const nextRight = right + 2;
      indices.push(left, nextLeft, right, right, nextLeft, nextRight);
    }
    const lastLeft = vertexBase + (segments - 1) * 2;
    indices.push(lastLeft, vertexBase + segments * 2, lastLeft + 1);
  }

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // xy = wind/tilt lean, zw = the blade's facing in XZ (its y is always 0).
  geometry.setAttribute('bladeAxis', new THREE.BufferAttribute(bladeAxes, 4));
  // xy = the blade's offset within its clump in metres, z = its length phase,
  // w = its width roll.
  geometry.setAttribute('bladeCenter', new THREE.BufferAttribute(bladeCenters, 4));
  // xy = the two colour rolls, zw = the authored profile's arc at this row.
  geometry.setAttribute('bladeShape', new THREE.BufferAttribute(bladeShapes, 4));
  // x = gust phase offset, y = stiffness, z = flutter amount, w = spare.
  geometry.setAttribute('bladeWind', new THREE.BufferAttribute(bladeWinds, 4));
  geometry.setIndex(indices);
  geometry.setAttribute('instanceBase', instanceBase);
  geometry.setAttribute('instanceParams', instanceParams);
  geometry.instanceCount = 0;
  // No vertex normals: the material forces the shading normal to view-space +Y for
  // every blade, so a computed one would be three floats a vertex that nothing
  // reads — and one more vertex buffer against the eight-buffer ceiling.
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
    bladeProfileProvider = null,
    tuning,
  }) {
    this.tuning = tuning;
    this.terrainSlot = terrainSlot;
    this.terrainView = terrainView;
    this.objectMap = objectMap;
    this.config = config;
    this.sunDirection = sunDirection;
    this.forestFieldProvider = forestFieldProvider;
    // Read through a provider rather than stored: switching the blade profile set
    // from Settings has to reach 49 slots, and a provider means the switch is one
    // assignment plus a release rather than a walk over every slot's own copy.
    this.bladeProfileProvider = bladeProfileProvider;
    this.builtProfileRevision = -1;
    this.chunkSize = terrainView.worldStore.chunkSize;
    this.tileSize = terrainView.worldStore.tileSize;
    this.chunkWorldSize = this.chunkSize * this.tileSize;
    this.bladesPerCell = config.grass.bladesPerCell;
    this.bladesPerClump = config.grass.bladesPerClump ?? DEFAULT_BLADES_PER_CLUMP;
    this.clumpsPerCell = clumpsPerCell(this.bladesPerCell, this.bladesPerClump);
    // Chunks within this many rings get full-shape blades; the rest get the cheap
    // single-triangle band, which is what makes a residentRadius above 1 affordable.
    this.nearRadius = Math.min(
      config.grass.residentRadius,
      config.grass.nearRadius ?? config.grass.residentRadius,
    );
    this.maxInstances = this.chunkSize * this.chunkSize * this.clumpsPerCell;
    this.chunkCenter = uniform(new THREE.Vector2());
    this.time = uniform(0);
    this.emptyGeometry = new THREE.BufferGeometry();
    this.geometry = null;
    this.nearGeometry = null;
    this.farGeometry = null;
    this.instanceBase = null;
    this.instanceParams = null;
    this.band = 'near';
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
    this.instanceBase = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxInstances * 3),
      3,
    );
    this.instanceParams = new THREE.InstancedBufferAttribute(
      new Float32Array(this.maxInstances * 4),
      4,
    );
    const pool = this.bladeProfileProvider?.();
    this.builtProfileRevision = pool?.revision ?? -1;
    const bands = {
      bladesPerClump: this.bladesPerClump,
      tiltMax: this.config.grass.tiltMax ?? DEFAULT_TILT_MAX,
      clumpRadius: this.config.grass.clumpRadius ?? DEFAULT_CLUMP_RADIUS,
      instanceBase: this.instanceBase,
      instanceParams: this.instanceParams,
    };
    // Each band resamples the same manifest onto its own segment budget, so the
    // far blade keeps the authored outline's proportions instead of reverting to
    // the generated taper the moment a chunk crosses the ring.
    this.nearGeometry = createClumpGeometry({
      ...bands,
      segments: BLADE_SEGMENTS,
      profiles: pool?.near,
    });
    // Only built when some ring can actually reach it; with nearRadius equal to
    // residentRadius every chunk stays on full blades and this would never draw.
    this.farGeometry = this.nearRadius < this.config.grass.residentRadius
      ? createClumpGeometry({ ...bands, segments: FAR_BLADE_SEGMENTS, profiles: pool?.far })
      : null;
    this.geometry = this.band === 'far' && this.farGeometry
      ? this.farGeometry
      : this.nearGeometry;
    this.material = createStylizedGrassMaterial({
      surfaceMaskTexture: this.terrainSlot.surfaceMaskTexture,
      trampleTexture: this.trampleTexture,
      chunkCenter: this.chunkCenter,
      chunkWorldSize: this.chunkWorldSize,
      time: this.time,
      sunDirection: this.sunDirection,
      config: this.config,
      tuning: this.tuning,
    });
    this.mesh.geometry = this.geometry;
    this.mesh.material = this.material;
    this.mesh.receiveShadow = true;
    PerfCounters.inc('grassResourceAllocations');
  }

  /**
   * Swaps the active blade geometry. The instance attributes are shared between
   * the two, so the chunk's scatter carries over untouched — only `instanceCount`
   * and the bounds, which live on the geometry, have to follow it across.
   */
  setBand(band) {
    this.band = band;
    if (!this.geometry) return;
    const next = band === 'far' && this.farGeometry ? this.farGeometry : this.nearGeometry;
    if (next === this.geometry) return;
    next.instanceCount = this.geometry.instanceCount;
    next.boundingBox = this.geometry.boundingBox;
    next.boundingSphere = this.geometry.boundingSphere;
    this.geometry = next;
    this.mesh.geometry = next;
  }

  releaseResources() {
    if (!this.geometry) return;
    this.nearGeometry?.dispose();
    this.farGeometry?.dispose();
    this.material?.dispose();
    this.trampleTexture?.dispose();
    this.geometry = null;
    this.nearGeometry = null;
    this.farGeometry = null;
    this.instanceBase = null;
    this.instanceParams = null;
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
    // Blade shape is baked into the clump's vertex buffer, so switching profile
    // sets is a rebuild, not a uniform. Dropping the resources here lets the
    // existing allocate-on-demand path do it without a second code path.
    const profileRevision = this.bladeProfileProvider?.()?.revision ?? -1;
    if (this.geometry && profileRevision !== this.builtProfileRevision) this.releaseResources();
    this.ensureResources();
    this.setBand(grassLodBand(distance, this.nearRadius));
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
        const offset = grassClumpCellOffset(
          job.descriptor.chunkX,
          job.descriptor.chunkZ,
          cellIndex,
          clumpIndex,
        );
        const sampleX = localX + offset.x;
        const sampleZ = localZ + offset.z;
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
    // Reported so a blade-profile switch can be judged on cost as well as looks.
    // It follows the band this chunk is on, which is the point: the far band is
    // where a shape change stops costing anything.
    PerfCounters.set(
      'grassLastChunkTriangles',
      state.count * this.bladesPerClump
        * trianglesPerBlade(this.band === 'far' && this.farGeometry ? FAR_BLADE_SEGMENTS : BLADE_SEGMENTS),
    );
    PerfCounters.set('grassInstanceAttributeBytes', bytes);
  }

  dispose() {
    this.terrainView.scene.remove(this.mesh);
    this.releaseResources();
    this.emptyGeometry.dispose();
  }
}

export const GRASS_BLADE_SEGMENTS = BLADE_SEGMENTS;
export const GRASS_FAR_BLADE_SEGMENTS = FAR_BLADE_SEGMENTS;
