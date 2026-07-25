import {
  createForestBiomeProfiles,
  forestProfileSignature,
} from './ForestBiomeProfiles.js';
import {
  FOREST_PATCH_DEFAULT_SUPERCELL_SIZE,
  ForestPatchField,
} from './ForestPatchField.js';
import { bilinear } from './bilinearGrid.js';

const DEFAULT_SLOPE_SAMPLE_DISTANCE = 4;
const DEFAULT_PATCH_SAMPLE_SPACING = 12;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(minimum, maximum, value) {
  if (maximum <= minimum) return value >= maximum ? 1 : 0;
  const normalized = clamp01((value - minimum) / (maximum - minimum));
  return normalized * normalized * (3 - 2 * normalized);
}

function rangeWeight(value, minimum, maximum, fade) {
  const lower = smoothstep(minimum - fade, minimum, value);
  const upper = 1 - smoothstep(maximum, maximum + fade, value);
  return clamp01(lower * upper);
}

function slopeWeight(slope, preferred, maximum) {
  if (slope <= preferred) return 1;
  return 1 - smoothstep(preferred, maximum, slope);
}

function waterWeight(distance, profile) {
  if (!Number.isFinite(distance)) return 1;
  return rangeWeight(
    distance,
    profile.waterMinimum,
    profile.waterMaximum,
    profile.waterFade,
  );
}

function worldToCell(x, z, tileSize) {
  return {
    cellX: Math.floor(x / tileSize),
    cellZ: Math.floor(-z / tileSize),
  };
}

export class ForestHabitatField {
  constructor({
    seed = 0,
    tileSize,
    tileAt,
    heightAt,
    waterDistanceAt = null,
    revisionProvider = null,
    config = {},
  }) {
    if (!Number.isFinite(tileSize) || tileSize <= 0) {
      throw new Error('ForestHabitatField requires a positive tileSize.');
    }
    if (typeof tileAt !== 'function' || typeof heightAt !== 'function') {
      throw new Error('ForestHabitatField requires tileAt and heightAt functions.');
    }

    this.enabled = config.enabled !== false;
    this.seed = Number.isInteger(seed) ? seed : Math.trunc(seed) || 0;
    this.tileSize = tileSize;
    this.tileAt = tileAt;
    this.heightAt = heightAt;
    this.waterDistanceAt = typeof waterDistanceAt === 'function' ? waterDistanceAt : null;
    this.revisionProvider = typeof revisionProvider === 'function' ? revisionProvider : null;
    this.cacheRevision = this.revisionProvider?.() ?? 0;
    this.cacheLimit = Math.max(256, Math.trunc(config.cacheSamples) || 32768);
    this.sampleCache = new Map();
    this.patchCache = new Map();
    this.stats = { builds: 0, cacheHits: 0, patchBuilds: 0, patchCacheHits: 0 };
    this.slopeSampleDistance = Math.max(
      tileSize,
      Number(config.slopeSampleDistance) || DEFAULT_SLOPE_SAMPLE_DISTANCE,
    );
    // Patch coverage varies over tens of metres, so it is evaluated on a coarse
    // grid and interpolated. Unlike the exact-position cache this is reused
    // heavily across neighbouring candidates and overlapping chunk halos.
    this.patchSampleSpacing = Math.max(
      tileSize,
      Number(config.patchSampleSpacing) || DEFAULT_PATCH_SAMPLE_SPACING,
    );
    this.profiles = createForestBiomeProfiles(config.profiles);
    this.patchField = new ForestPatchField({
      seed: this.seed,
      supercellSize: config.patchSupercellSize ?? FOREST_PATCH_DEFAULT_SUPERCELL_SIZE,
    });
    this.signature = [
      this.enabled ? 1 : 0,
      this.seed,
      this.tileSize,
      this.slopeSampleDistance,
      this.patchSampleSpacing,
      this.patchField.signature,
      forestProfileSignature(this.profiles),
    ].join('|');
  }

  patchNodeAt(nodeX, nodeZ, profile) {
    const key = `${profile.tileId}:${nodeX}:${nodeZ}`;
    const cached = this.patchCache.get(key);
    if (cached) {
      this.stats.patchCacheHits += 1;
      return cached;
    }
    const sample = this.patchField.sample(
      nodeX * this.patchSampleSpacing,
      nodeZ * this.patchSampleSpacing,
      profile,
    );
    if (this.patchCache.size >= this.cacheLimit) {
      this.patchCache.delete(this.patchCache.keys().next().value);
    }
    this.patchCache.set(key, sample);
    this.stats.patchBuilds += 1;
    return sample;
  }

  /**
   * Interpolated patch terms. `patchId` is discrete so it snaps to the nearest
   * grid node — patches span hundreds of metres, so a node-sized boundary
   * quantization is not visible, and grove identity stays stable across chunks.
   */
  patchAt(x, z, profile) {
    const gridX = x / this.patchSampleSpacing;
    const gridZ = z / this.patchSampleSpacing;
    const nodeX = Math.floor(gridX);
    const nodeZ = Math.floor(gridZ);
    const tx = gridX - nodeX;
    const tz = gridZ - nodeZ;
    const bottomLeft = this.patchNodeAt(nodeX, nodeZ, profile);
    const bottomRight = this.patchNodeAt(nodeX + 1, nodeZ, profile);
    const topLeft = this.patchNodeAt(nodeX, nodeZ + 1, profile);
    const topRight = this.patchNodeAt(nodeX + 1, nodeZ + 1, profile);
    const nearest = [bottomLeft, bottomRight, topLeft, topRight][
      (tz < 0.5 ? 0 : 2) + (tx < 0.5 ? 0 : 1)
    ];
    return {
      patchId: nearest.patchId,
      patchCoverage: bilinear(
        bottomLeft.patchCoverage,
        bottomRight.patchCoverage,
        topLeft.patchCoverage,
        topRight.patchCoverage,
        tx,
        tz,
      ),
      patchEdge: bilinear(
        bottomLeft.patchEdge,
        bottomRight.patchEdge,
        topLeft.patchEdge,
        topRight.patchEdge,
        tx,
        tz,
      ),
      patchDistance: nearest.patchDistance,
    };
  }

  slopeAt(x, z) {
    const distance = this.slopeSampleDistance;
    const heightX = this.heightAt(x + distance, z) - this.heightAt(x - distance, z);
    const heightZ = this.heightAt(x, z + distance) - this.heightAt(x, z - distance);
    return Math.hypot(heightX, heightZ) / (distance * 2);
  }

  sample(x, z) {
    const revision = this.revisionProvider?.() ?? this.cacheRevision;
    if (revision !== this.cacheRevision) {
      // patchCache depends only on seed, supercell size and profile — never on
      // terrain heights or tiles — so world edits cannot stale it.
      this.sampleCache.clear();
      this.cacheRevision = revision;
    }
    const cacheKey = `${x}:${z}`;
    const cached = this.sampleCache.get(cacheKey);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }
    const { cellX, cellZ } = worldToCell(x, z, this.tileSize);
    const tileId = this.tileAt(cellX, cellZ);
    const profile = this.enabled ? this.profiles.get(tileId) : null;
    if (!profile) {
      return this.cacheSample(cacheKey, Object.freeze({
        tileId,
        profileKey: null,
        structure: null,
        patchId: null,
        patchCoverage: 0,
        patchEdge: 0,
        patchDistance: Number.POSITIVE_INFINITY,
        elevation: this.heightAt(x, z),
        slope: 0,
        elevationWeight: 0,
        slopeWeight: 0,
        waterWeight: 0,
        suitability: 0,
      }));
    }

    const elevation = this.heightAt(x, z);
    const slope = this.slopeAt(x, z);
    const patch = this.patchAt(x, z, profile);
    const elevationFactor = rangeWeight(
      elevation,
      profile.elevationMin,
      profile.elevationMax,
      profile.elevationFade,
    );
    const slopeFactor = slopeWeight(slope, profile.preferredSlope, profile.maximumSlope);
    const distanceToWater = this.waterDistanceAt?.(x, z) ?? Number.POSITIVE_INFINITY;
    const waterFactor = waterWeight(distanceToWater, profile);
    const suitability = clamp01(
      profile.density
      * patch.patchCoverage
      * elevationFactor
      * slopeFactor
      * waterFactor,
    );

    return this.cacheSample(cacheKey, Object.freeze({
      tileId,
      profileKey: profile.key,
      structure: profile.structure,
      patchId: patch.patchId,
      patchCoverage: patch.patchCoverage,
      patchEdge: patch.patchEdge,
      patchDistance: patch.patchDistance,
      elevation,
      slope,
      elevationWeight: elevationFactor,
      slopeWeight: slopeFactor,
      waterWeight: waterFactor,
      suitability,
    }));
  }

  cacheSample(key, sample) {
    if (this.sampleCache.size >= this.cacheLimit) {
      this.sampleCache.delete(this.sampleCache.keys().next().value);
    }
    this.sampleCache.set(key, sample);
    this.stats.builds += 1;
    return sample;
  }
}

export function createForestPlacementEvaluator(field, counters = null, {
  speciesRegistry = null,
  editStore = null,
  exclusionAt = null,
} = {}) {
  if (!field) return null;
  return (candidate) => {
    counters && (counters.evaluated += 1);
    const habitat = field.sample(candidate.x, candidate.z);
    if (candidate.priority >= habitat.suitability || exclusionAt?.(candidate, habitat)) {
      counters && (counters.rejectedHabitat += 1);
      return null;
    }
    const ecological = speciesRegistry?.select(candidate, habitat) ?? {};
    const record = {
      patchId: habitat.patchId,
      forestProfileKey: habitat.profileKey,
      forestStructure: habitat.structure,
      forestSuitability: habitat.suitability,
      forestPatchCoverage: habitat.patchCoverage,
      forestPatchEdge: habitat.patchEdge,
      forestSlope: habitat.slope,
      forestElevation: habitat.elevation,
      forestWaterWeight: habitat.waterWeight,
      ...ecological,
    };
    if (editStore && !editStore.allows({ ...candidate, ...record })) {
      counters && (counters.rejectedEdits = (counters.rejectedEdits ?? 0) + 1);
      return null;
    }
    return record;
  };
}

export const FOREST_HABITAT_DEFAULT_SLOPE_SAMPLE_DISTANCE = DEFAULT_SLOPE_SAMPLE_DISTANCE;
