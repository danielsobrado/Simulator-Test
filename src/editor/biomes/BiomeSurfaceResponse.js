import { ringPoints } from '../world/sampleTilesAround.js';

const RINGS = [0, 24];
/** The ground underfoot counts four times one point of the ring. */
const RING_WEIGHTS = [4, 1];
const DIRECTIONS = 8;
/** Open water (Azgaar 0) has no say: a lake takes the look of the land round it. */
const WATER_TILE = 0;
const RESAMPLE_SECONDS = 0.5;
/** Seconds to cover most of the way to a new region's settings. */
const BLEND_SECONDS = 1.5;
const RIPPLE_KEYS = ['speed', 'fade', 'splash', 'drops'];

/**
 * Weighted mean of the `surface` columns (BiomeSurfaceLooks) over the tiles
 * sampled round a point; null when only water was sampled.
 */
export function blendBiomeSurface(surface, tiles, weights) {
  let total = 0;
  const ripples = Object.fromEntries(RIPPLE_KEYS.map((key) => [key, 0]));
  const prints = { ground: 0, lifetime: 0, tint: [0, 0, 0] };
  const water = { tint: [0, 0, 0], desaturate: 0 };
  tiles.forEach((tile, index) => {
    if (tile === WATER_TILE || !Number.isInteger(tile) || tile < 0 || tile > 255) return;
    const weight = weights[index] ?? 1;
    total += weight;
    for (const key of RIPPLE_KEYS) ripples[key] += surface.ripples[key][tile] * weight;
    prints.ground += surface.prints.ground[tile] * weight;
    prints.lifetime += surface.prints.lifetime[tile] * weight;
    for (let c = 0; c < 3; c += 1) prints.tint[c] += surface.prints.tint[tile * 3 + c] * weight;
    for (let c = 0; c < 3; c += 1) water.tint[c] += surface.water.tint[tile * 3 + c] * weight;
    water.desaturate += surface.water.desaturate[tile] * weight;
  });
  if (total === 0) return null;
  for (const key of RIPPLE_KEYS) ripples[key] /= total;
  prints.ground /= total;
  prints.lifetime /= total;
  prints.tint = prints.tint.map((value) => value / total);
  water.tint = water.tint.map((value) => value / total);
  water.desaturate /= total;
  return { ripples, prints, water };
}

/**
 * The region's surface response round the player: how its water ripples and
 * is coloured and how its ground takes prints, eased in as the player crosses into a biome so
 * nothing snaps at a border.
 */
export class BiomeSurfaceResponse {
  /**
   * @param {object} options
   * @param {object} options.surface resolveBiomeLooks(...).surface
   * @param {(cellX: number, cellZ: number) => number} options.getTile
   * @param {() => number} options.getTileSize
   */
  constructor({ surface, getTile, getTileSize }) {
    Object.assign(this, { surface, getTile, getTileSize });
    // Before anything is sampled: the table's defaults (255 is never a configured id).
    const fallback = blendBiomeSurface(surface, [255], [1]);
    this.target = fallback;
    this.current = structuredClone(fallback);
    this.sinceSample = Infinity;
  }

  /**
   * @param {number} dt seconds
   * @param {{ x: number, z: number }} canonical position
   */
  update(dt, canonical) {
    this.sinceSample += dt;
    if (this.sinceSample >= RESAMPLE_SECONDS) {
      this.sinceSample = 0;
      const tileSize = this.getTileSize();
      const tiles = [];
      const weights = [];
      RINGS.forEach((radius, ring) => {
        for (const point of ringPoints({ x: canonical.x, z: canonical.z, rings: [radius], directions: DIRECTIONS })) {
          tiles.push(this.getTile(Math.floor(point.x / tileSize), Math.floor(-point.z / tileSize)));
          weights.push(RING_WEIGHTS[ring]);
        }
      });
      this.target = blendBiomeSurface(this.surface, tiles, weights) ?? this.target;
    }
    const k = 1 - Math.exp(-3 * Math.max(0, dt) / BLEND_SECONDS);
    const ease = (from, to) => from + (to - from) * k;
    for (const key of RIPPLE_KEYS) this.current.ripples[key] = ease(this.current.ripples[key], this.target.ripples[key]);
    this.current.prints.ground = ease(this.current.prints.ground, this.target.prints.ground);
    this.current.prints.lifetime = ease(this.current.prints.lifetime, this.target.prints.lifetime);
    this.current.prints.tint = this.current.prints.tint.map((value, c) => ease(value, this.target.prints.tint[c]));
    this.current.water.tint = this.current.water.tint.map((value, c) => ease(value, this.target.water.tint[c]));
    this.current.water.desaturate = ease(this.current.water.desaturate, this.target.water.desaturate);
    return this.current;
  }
}
