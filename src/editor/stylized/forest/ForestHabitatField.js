import { valueNoise } from '../../world/valueNoise2d.js';
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

/**
 * Coverage contributed by a shoreline in its own right: `riparianCoverage` at the
 * waterline, easing to zero by `riparianRange`. Infinite distance means no water
 * was found within the provider's range, so the belt contributes nothing.
 */
function riparianCoverage(distance, profile) {
  if (profile.riparianCoverage <= 0 || !Number.isFinite(distance)) return 0;
  return profile.riparianCoverage
    * (1 - smoothstep(0, profile.riparianRange, distance));
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
    regionalCharacterField = null,
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
    this.regionalCharacterField = regionalCharacterField;
    this.cacheRevision = this.revisionProvider?.() ?? 0;
    this.cacheLimit = Math.max(256, Math.trunc(config.cacheSamples) || 32768);
    this.sampleCache = new Map();
    this.sampleRevisions = new Map();
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
    // Shape broad ecological patches into visually legible stands. Coverage
    // contrast moves the effective edge inward, while the core boost restores
    // local tree density there. At their neutral value of 1 these preserve the
    // original habitat distribution exactly.
    this.coverageContrast = Math.max(
      0.1,
      Number.isFinite(config.coverageContrast) ? config.coverageContrast : 1,
    );
    this.coreDensityBoost = Math.max(
      0.1,
      Number.isFinite(config.coreDensityBoost) ? config.coreDensityBoost : 1,
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
      this.coverageContrast,
      this.coreDensityBoost,
      // Acceptance changes the moment a water provider appears, so it belongs in
      // the signature that invalidates cached manifests.
      this.waterDistanceAt ? 'riparian' : 'nowater',
      this.patchField.signature,
      this.regionalCharacterField?.signature ?? 'uniform-regions',
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
    const prepared = this.preparedProvider?.(x, z);
    if (prepared) { this.stats.cacheHits++; return prepared; }
    const revision = this.revisionProvider?.() ?? this.cacheRevision;
    if (!this.localRevisionProvider && revision !== this.cacheRevision) {
      // patchCache depends only on seed, supercell size and profile — never on
      // terrain heights or tiles — so world edits cannot stale it.
      this.sampleCache.clear();
      this.sampleRevisions.clear();
      this.cacheRevision = revision;
    }
    const cacheKey = `${x}:${z}`;
    const localRevision = this.localRevisionProvider?.(x, z);
    const cached = this.sampleCache.get(cacheKey);
    if (cached && (!this.localRevisionProvider || this.sampleRevisions.get(cacheKey) === localRevision)) {
      this.stats.cacheHits += 1;
      return cached;
    }
    const sample = this.cacheSample(cacheKey, this.evaluate(x, z, { withWater: true }));
    if (this.localRevisionProvider) this.sampleRevisions.set(cacheKey, localRevision);
    return sample;
  }

  /**
   * The habitat without the water terms, for callers that sample far apart —
   * the far-terrain backdrop's rings are hundreds of metres apart. Water
   * distance comes from a per-chunk chamfer field, so every such sample would
   * build a whole chunk's field on the main thread (a far-ring rebuild over a
   * forest took minutes), and the riparian belt it feeds is tens of metres
   * wide, below that spacing anyway. Without it the water weight is neutral
   * and the belt absent, as where no water lies in range. Not cached: a ring
   * rebuild would otherwise evict the near field's samples.
   *
   * `terrain` ({ tileId, elevation, slope }, any subset) is what the caller
   * already knows about the ground there. The backdrop has its own macro tile,
   * height and ring slope for every sample; without them each sample cost five
   * fine height queries through the water-terrain model, most of a ring rebuild.
   */
  sampleCoarse(x, z, terrain = null) {
    return this.evaluate(x, z, { withWater: false, terrain });
  }

  evaluate(x, z, { withWater, terrain = null }) {
    let tileId = terrain?.tileId;
    if (tileId === undefined || tileId === null) {
      const { cellX, cellZ } = worldToCell(x, z, this.tileSize);
      tileId = this.tileAt(cellX, cellZ);
    }
    const profile = this.enabled ? this.profiles.get(tileId) : null;
    if (!profile) {
      return Object.freeze({
        tileId,
        profileKey: null,
        structure: null,
        patchId: null,
        patchCoverage: 0,
        patchEdge: 0,
        patchDistance: Number.POSITIVE_INFINITY,
        elevation: terrain?.elevation ?? this.heightAt(x, z),
        slope: 0,
        elevationWeight: 0,
        slopeWeight: 0,
        waterWeight: 0,
        waterDistance: Number.POSITIVE_INFINITY,
        riparian: 1,
        suitability: 0,
      });
    }

    const elevation = terrain?.elevation ?? this.heightAt(x, z);
    const slope = terrain?.slope ?? this.slopeAt(x, z);
    const patch = this.patchAt(x, z, profile);
    const elevationFactor = rangeWeight(
      elevation,
      profile.elevationMin,
      profile.elevationMax,
      profile.elevationFade,
    );
    const slopeFactor = slopeWeight(slope, profile.preferredSlope, profile.maximumSlope);
    const distanceToWater = withWater
      ? this.waterDistanceAt?.(x, z) ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
    const waterFactor = waterWeight(distanceToWater, profile);
    const riparian = riparianCoverage(distanceToWater, profile);
    // A gallery wood along a river is not an upland patch that happens to touch
    // water — it is its own corridor, so it competes with the patch field for
    // coverage instead of scaling it.
    const regionalForest = Math.max(
      profile.regionalForestFloor,
      this.regionalCharacterField?.sampleChannel(x, z, 'forest') ?? 1,
    );
    // Clearings are holes in the field itself, so trees, shrubs, grass, litter
    // and the far canopy all open together; a gallery wood stays closed.
    // Open country's woods are groves already: a glade would only erase them.
    const glade = profile.structure === 'groves' ? NO_GLADE : forestGlade(x, z);
    const rawCoverage = Math.max(patch.patchCoverage * glade.open, riparian) * regionalForest;
    const coverage = clamp01(rawCoverage ** this.coverageContrast);
    const patchEdge = Math.max(patch.patchEdge, glade.rim * patch.patchCoverage);
    // Young growth advances past the closed stand: a thin scatter of trees
    // across the edge ring (ForestSpeciesRegistry keeps the outer ones young).
    const succession = SUCCESSION_BELT * patchEdge * patchEdge * regionalForest;
    const suitability = clamp01(
      profile.density * this.coreDensityBoost
      * Math.max(coverage, succession)
      * elevationFactor
      * slopeFactor
      * waterFactor,
    );

    return Object.freeze({
      tileId,
      profileKey: profile.key,
      structure: profile.structure,
      patchId: patch.patchId,
      // Downstream consumers (forest floor, bush thinning, far-terrain canopy)
      // treat coverage as "how wooded is this spot", so they must see the
      // riparian belt too; the raw patch term stays available separately.
      patchCoverage: coverage,
      uplandPatchCoverage: clamp01(patch.patchCoverage ** this.coverageContrast),
      rawPatchCoverage: patch.patchCoverage * glade.open,
      patchEdge,
      patchDistance: patch.patchDistance,
      elevation,
      slope,
      elevationWeight: elevationFactor,
      slopeWeight: slopeFactor,
      waterWeight: waterFactor,
      waterDistance: distanceToWater,
      riparian,
      regionalForest,
      suitability,
    });
  }

  cacheSample(key, sample) {
    if (this.sampleCache.size >= this.cacheLimit) {
      const oldest = this.sampleCache.keys().next().value;
      this.sampleCache.delete(oldest);
      this.sampleRevisions.delete(oldest);
    }
    this.sampleCache.set(key, sample);
    this.stats.builds += 1;
    return sample;
  }
}

/** Share of full tree density the edge ring keeps outside the closed stand. */
const SUCCESSION_BELT = 0.1;
const GLADE_SCALE = 90;
const GLADE_SEED = 0x676c6164;
/** Noise band a glade's rim spans: below it open ground, above it closed wood. */
const GLADE_BAND = Object.freeze([-0.5, -0.35]);

/**
 * Clearings inside a wood: `open` is 0 in a glade and 1 in closed forest, `rim`
 * peaks on the glade's edge so it grows an edge community like the wood's own.
 * About one seventh of a wood's area, in glades some 30-60 m across.
 */
const NO_GLADE = Object.freeze({ open: 1, rim: 0 });
export function forestGlade(x, z) {
  const noise = valueNoise(x / GLADE_SCALE, z / GLADE_SCALE, GLADE_SEED);
  const t = Math.min(1, Math.max(0, (noise - GLADE_BAND[0]) / (GLADE_BAND[1] - GLADE_BAND[0])));
  return { open: t * t * (3 - 2 * t), rim: 1 - Math.abs(t - 0.5) * 2 };
}

export function createForestPlacementEvaluator(field, counters = null, {
  speciesRegistry = null,
  editStore = null,
  exclusionAt = null,
} = {}) {
  if (!field) return null;
  const editQuery = { stableId: null, priority: 0, patchId: null, forestSuitability: 0 };
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
    // The edit check reads four fields; merging candidate and record per tree only to ask was garbage.
    // Record fields win, as they did in the merged object.
    editQuery.stableId = 'stableId' in record ? record.stableId : candidate.stableId;
    editQuery.priority = 'priority' in record ? record.priority : candidate.priority;
    editQuery.patchId = record.patchId;
    editQuery.forestSuitability = record.forestSuitability;
    if (editStore && !editStore.allows(editQuery)) {
      counters && (counters.rejectedEdits = (counters.rejectedEdits ?? 0) + 1);
      return null;
    }
    return record;
  };
}

export const FOREST_HABITAT_DEFAULT_SLOPE_SAMPLE_DISTANCE = DEFAULT_SLOPE_SAMPLE_DISTANCE;
