import { ForestPatchField } from './ForestPatchField.js';
import { bilinear } from './bilinearGrid.js';

/**
 * Reusable clustering field for non-tree scatter layers (bushes, boulders).
 *
 * Reuses `ForestPatchField`'s warped elliptical world-space patches — the same
 * machinery that gives forests their shape — with a per-kind seed offset so
 * layers never correlate, and a much smaller supercell size so clumps read at
 * tens of metres rather than hundreds. Coverage is evaluated on a coarse grid and
 * interpolated, so raising candidate budgets does not multiply noise cost.
 *
 * Placement stays canonical: sampling depends only on world position, seed and
 * config, never on chunk residency or approach direction.
 */

const DEFAULT_SUPERCELL_SIZE = 64;
const DEFAULT_SAMPLE_SPACING = 6;
const DEFAULT_CACHE_LIMIT = 16384;

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(minimum, maximum, value) {
  if (maximum <= minimum) return value >= maximum ? 1 : 0;
  const normalized = clamp01((value - minimum) / (maximum - minimum));
  return normalized * normalized * (3 - 2 * normalized);
}

/** Patch shape descriptor in the form `ForestPatchField.sample` expects. */
function normalizeShape(kind, config) {
  const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
  const radiusMin = Math.min(1.5, Math.max(0.1, finite(config.clusterRadiusMin, 0.3)));
  return Object.freeze({
    tileId: kind,
    density: clamp01(finite(config.clusterDensity, 0.6)),
    patchRadiusMin: radiusMin,
    patchRadiusMax: Math.min(1.75, Math.max(radiusMin, finite(config.clusterRadiusMax, 0.62))),
    patchAspectMin: Math.max(0.25, finite(config.clusterAspectMin, 0.6)),
    patchAspectMax: Math.max(
      Math.max(0.25, finite(config.clusterAspectMin, 0.6)),
      finite(config.clusterAspectMax, 1.7),
    ),
    patchEdgeWidth: Math.min(0.6, Math.max(0.02, finite(config.clusterEdgeWidth, 0.34))),
    boundaryWarp: Math.min(0.4, Math.max(0, finite(config.clusterBoundaryWarp, 0.2))),
  });
}

export class ScatterClusterField {
  constructor({
    kind,
    seed = 0,
    seedOffset = 0,
    heightAt,
    slopeSampleDistance = 4,
    config = {},
  }) {
    if (typeof heightAt !== 'function') {
      throw new Error('ScatterClusterField requires a heightAt function.');
    }
    this.kind = String(kind);
    this.heightAt = heightAt;
    this.slopeSampleDistance = Math.max(0.5, Number(slopeSampleDistance) || 4);
    this.shape = normalizeShape(this.kind, config);
    this.sampleSpacing = Math.max(
      0.5,
      Number(config.clusterSampleSpacing) || DEFAULT_SAMPLE_SPACING,
    );
    // Slope preference: `preferredSlope` is where the layer peaks, and coverage
    // falls to zero past `maximumSlope`. Boulders like moderate slopes; bushes
    // prefer gentler ground.
    this.preferredSlope = Math.max(0, Number(config.preferredSlope) || 0);
    this.maximumSlope = Math.max(
      this.preferredSlope + 0.001,
      Number.isFinite(config.maximumSlope) ? config.maximumSlope : this.preferredSlope + 1.5,
    );
    this.flatBias = clamp01(
      Number.isFinite(config.flatBias) ? config.flatBias : 0,
    );
    this.patchField = new ForestPatchField({
      seed: (Number.isInteger(seed) ? seed : Math.trunc(seed) || 0)
        ^ Math.imul(seedOffset + 1, 0x9e3779b1),
      supercellSize: config.clusterSupercellSize ?? DEFAULT_SUPERCELL_SIZE,
    });
    this.cacheLimit = Math.max(256, Math.trunc(config.cacheSamples) || DEFAULT_CACHE_LIMIT);
    this.cache = new Map();
    this.stats = { builds: 0, cacheHits: 0 };
    this.signature = [
      this.kind,
      this.patchField.signature,
      this.sampleSpacing,
      this.preferredSlope,
      this.maximumSlope,
      this.flatBias,
      JSON.stringify(this.shape),
    ].join('|');
  }

  slopeAt(x, z) {
    const distance = this.slopeSampleDistance;
    const heightX = this.heightAt(x + distance, z) - this.heightAt(x - distance, z);
    const heightZ = this.heightAt(x, z + distance) - this.heightAt(x, z - distance);
    return Math.hypot(heightX, heightZ) / (distance * 2);
  }

  nodeAt(nodeX, nodeZ) {
    const key = `${nodeX}:${nodeZ}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }
    const worldX = nodeX * this.sampleSpacing;
    const worldZ = nodeZ * this.sampleSpacing;
    const patch = this.patchField.sample(worldX, worldZ, this.shape);
    // Slope belongs on the grid for the same reason coverage does: sampling it
    // per candidate costs four procedural height lookups (sixteen noise
    // evaluations) and made cost scale with the candidate budget rather than
    // with area. Terrain slope varies smoothly at this spacing, so caching it
    // per node and interpolating is both far cheaper and still canonical.
    const node = {
      patchId: patch.patchId,
      patchCoverage: patch.patchCoverage,
      patchEdge: patch.patchEdge,
      slope: this.slopeAt(worldX, worldZ),
    };
    if (this.cache.size >= this.cacheLimit) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, node);
    this.stats.builds += 1;
    return node;
  }

  /**
   * `slopeWeight` peaks at `preferredSlope`: below it the layer is scaled by
   * `flatBias` (boulders thin out on flat meadow), above it coverage fades to
   * zero by `maximumSlope`.
   */
  slopeWeight(slope) {
    if (slope >= this.maximumSlope) return 0;
    if (slope <= this.preferredSlope) {
      if (this.preferredSlope <= 0) return 1;
      return this.flatBias + (1 - this.flatBias) * (slope / this.preferredSlope);
    }
    return 1 - smoothstep(this.preferredSlope, this.maximumSlope, slope);
  }

  sample(x, z) {
    const gridX = x / this.sampleSpacing;
    const gridZ = z / this.sampleSpacing;
    const nodeX = Math.floor(gridX);
    const nodeZ = Math.floor(gridZ);
    const tx = gridX - nodeX;
    const tz = gridZ - nodeZ;
    const bottomLeft = this.nodeAt(nodeX, nodeZ);
    const bottomRight = this.nodeAt(nodeX + 1, nodeZ);
    const topLeft = this.nodeAt(nodeX, nodeZ + 1);
    const topRight = this.nodeAt(nodeX + 1, nodeZ + 1);
    const nearest = [bottomLeft, bottomRight, topLeft, topRight][
      (tz < 0.5 ? 0 : 2) + (tx < 0.5 ? 0 : 1)
    ];
    const coverage = clamp01(bilinear(
      bottomLeft.patchCoverage,
      bottomRight.patchCoverage,
      topLeft.patchCoverage,
      topRight.patchCoverage,
      tx,
      tz,
    ));
    const edge = clamp01(bilinear(
      bottomLeft.patchEdge,
      bottomRight.patchEdge,
      topLeft.patchEdge,
      topRight.patchEdge,
      tx,
      tz,
    ));
    const slope = Math.max(0, bilinear(
      bottomLeft.slope,
      bottomRight.slope,
      topLeft.slope,
      topRight.slope,
      tx,
      tz,
    ));
    const slopeWeight = this.slopeWeight(slope);
    return {
      clusterId: nearest.patchId,
      coverage,
      edge,
      slope,
      slopeWeight,
      density: clamp01(coverage * slopeWeight),
    };
  }
}
