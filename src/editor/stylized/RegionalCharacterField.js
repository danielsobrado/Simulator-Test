import { hash32 } from './scatterMath.js';

const DEFAULT_REGION_SIZE = 420;
const DEFAULT_SAMPLE_SPACING = 28;
const DEFAULT_CACHE_LIMIT = 8192;
const HASH_X = 73856093;
const HASH_Z = 19349663;
const HASH_CHANNEL = 83492791;
const CHANNELS = Object.freeze(['meadow', 'forest', 'scrub', 'rocky']);
const UNIFORM = Object.freeze({ meadow: 1, forest: 1, scrub: 1, rocky: 1 });
// Node coordinates pack into one integer key so the per-candidate cache lookup
// costs no string allocation. ±2^24 nodes covers ±470 M world units at the
// default spacing; beyond that the key falls back to a string.
const NODE_KEY_BIAS = 1 << 24;
const NODE_KEY_STRIDE = 1 << 25;

function nodeKey(nodeX, nodeZ) {
  if (Math.abs(nodeX) >= NODE_KEY_BIAS || Math.abs(nodeZ) >= NODE_KEY_BIAS) {
    return `${nodeX}:${nodeZ}`;
  }
  return (nodeX + NODE_KEY_BIAS) * NODE_KEY_STRIDE + (nodeZ + NODE_KEY_BIAS);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function interpolate(left, right, amount) {
  return left + (right - left) * amount;
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function bilinear(x0z0, x1z0, x0z1, x1z1, tx, tz) {
  return interpolate(
    interpolate(x0z0, x1z0, tx),
    interpolate(x0z1, x1z1, tx),
    tz,
  );
}

/**
 * A coarse, deterministic world-space field shared by all natural scatter
 * layers. It gives broad areas a dominant character without storing a mask in
 * every map chunk: meadow, woodland, scrub and rocky ground are derived from
 * the same coordinates and seed on demand.
 */
export class RegionalCharacterField {
  constructor({ seed = 0, config = {} } = {}) {
    this.enabled = config.enabled !== false;
    this.seed = Number.isInteger(seed) ? seed : Math.trunc(seed) || 0;
    this.regionSize = Math.max(64, Number(config.regionSize) || DEFAULT_REGION_SIZE);
    this.sampleSpacing = Math.max(
      4,
      Number(config.sampleSpacing) || DEFAULT_SAMPLE_SPACING,
    );
    this.contrast = Math.max(0.25, Number(config.contrast) || 2.4);
    this.minimum = clamp01(
      Number.isFinite(config.minimumInfluence) ? config.minimumInfluence : 0.28,
    );
    this.cacheLimit = Math.max(256, Math.trunc(config.cacheSamples) || DEFAULT_CACHE_LIMIT);
    this.cache = new Map();
    this.stats = { builds: 0, cacheHits: 0 };
    this.signature = [
      this.enabled ? 1 : 0,
      this.seed,
      this.regionSize,
      this.sampleSpacing,
      this.contrast,
      this.minimum,
    ].join('|');
  }

  random(cellX, cellZ, channel) {
    return hash32(
      Math.imul(cellX, HASH_X)
      ^ Math.imul(cellZ, HASH_Z)
      ^ Math.imul(channel + 1, HASH_CHANNEL)
      ^ this.seed,
    ) / 0xffffffff;
  }

  valueNoise(x, z, channel) {
    const cellX = Math.floor(x);
    const cellZ = Math.floor(z);
    const localX = smooth(x - cellX);
    const localZ = smooth(z - cellZ);
    const bottom = interpolate(
      this.random(cellX, cellZ, channel),
      this.random(cellX + 1, cellZ, channel),
      localX,
    );
    const top = interpolate(
      this.random(cellX, cellZ + 1, channel),
      this.random(cellX + 1, cellZ + 1, channel),
      localX,
    );
    return interpolate(bottom, top, localZ);
  }

  nodeAt(nodeX, nodeZ) {
    const key = nodeKey(nodeX, nodeZ);
    const cached = this.cache.get(key);
    if (cached) {
      this.stats.cacheHits += 1;
      return cached;
    }
    const x = nodeX * this.sampleSpacing / this.regionSize;
    const z = nodeZ * this.sampleSpacing / this.regionSize;
    const raw = [
      this.valueNoise(x, z, 31),
      this.valueNoise(x, z, 47),
      this.valueNoise(x, z, 59),
      this.valueNoise(x, z, 71),
    ].map((value) => Math.max(0.0001, value) ** this.contrast);
    const total = raw.reduce((sum, value) => sum + value, 0);
    const influence = raw.map((value) => (
      this.minimum + (1 - this.minimum) * clamp01((value / total) * 2.25)
    ));
    const node = Object.freeze({
      meadow: influence[0],
      forest: influence[1],
      scrub: influence[2],
      rocky: influence[3],
    });
    if (this.cache.size >= this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, node);
    this.stats.builds += 1;
    return node;
  }

  /**
   * Reads a single character channel. Scatter evaluators run this once per
   * candidate and only ever look at one channel, so this avoids the result
   * object that `sample` has to allocate.
   */
  sampleChannel(x, z, channel) {
    if (!this.enabled) return 1;
    const gridX = x / this.sampleSpacing;
    const gridZ = z / this.sampleSpacing;
    const nodeX = Math.floor(gridX);
    const nodeZ = Math.floor(gridZ);
    const tx = smooth(gridX - nodeX);
    const tz = smooth(gridZ - nodeZ);
    return bilinear(
      this.nodeAt(nodeX, nodeZ)[channel],
      this.nodeAt(nodeX + 1, nodeZ)[channel],
      this.nodeAt(nodeX, nodeZ + 1)[channel],
      this.nodeAt(nodeX + 1, nodeZ + 1)[channel],
      tx,
      tz,
    );
  }

  sample(x, z) {
    if (!this.enabled) return UNIFORM;
    const gridX = x / this.sampleSpacing;
    const gridZ = z / this.sampleSpacing;
    const nodeX = Math.floor(gridX);
    const nodeZ = Math.floor(gridZ);
    const tx = smooth(gridX - nodeX);
    const tz = smooth(gridZ - nodeZ);
    // All four channels share the same four corner nodes, so read them once
    // rather than paying four cache lookups per channel through `sampleChannel`.
    const x0z0 = this.nodeAt(nodeX, nodeZ);
    const x1z0 = this.nodeAt(nodeX + 1, nodeZ);
    const x0z1 = this.nodeAt(nodeX, nodeZ + 1);
    const x1z1 = this.nodeAt(nodeX + 1, nodeZ + 1);
    const result = {};
    for (const channel of CHANNELS) {
      result[channel] = bilinear(
        x0z0[channel],
        x1z0[channel],
        x0z1[channel],
        x1z1[channel],
        tx,
        tz,
      );
    }
    return result;
  }
}
