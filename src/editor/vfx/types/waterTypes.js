import { RAMP, TILE, TILE_SPANS } from '../atlas/ParticleAtlasLayout.js';

const WATER = [0.32, 0.62, 0.92];
const FOAM = [0.86, 0.93, 1];

/** Water: the tidal orb, its spray and splashes, and summoned rain. */
export const WATER_TYPES = Object.freeze({
  // ——— Water ———
  // A glossy, faintly glowing globe of water; many overlapping make it wobble.
  'water.orb': {
    tiles: [TILE.DROPLET, TILE.DROPLET], lit: 1, ramp: RAMP.FROST, life: 0.05, size: 0.5, heat: 0.55, heatEnd: 0.55,
    emissive: 1.4, additive: 0, tint: WATER, opacity: 0.9, fadeIn: 0, fadeOut: 0.9, cameraFade: false,
  },
  'water.glow': {
    tiles: [TILE.GLOW, TILE.GLOW], ramp: RAMP.FROST, life: 0.05, size: 1.8, heat: 0.5, heatEnd: 0.5,
    emissive: 1.6, opacity: 0.6, fadeIn: 0, fadeOut: 0.9, cameraFade: false,
  },
  'water.drop': {
    tiles: [TILE.DROPLET, TILE.DROPLET], orient: 'velocity', stretch: 0.035, aspect: 1.2, lit: 1, ramp: RAMP.FROST,
    life: [0.8, 1.6], size: [0.05, 0.12], heat: 0.4, heatEnd: 0.3, emissive: 0.8, additive: 0.15, tint: WATER,
    opacity: 0.75,
    fadeIn: 0, fadeOut: 0.85, gravity: 9.8, drag: 0.3, collide: 'die',
    onImpact: { type: 'water.splash', count: 1, speed: 0, lift: 0.05 },
  },
  // Where a drop lands: a small ring opening out on the ground or the water.
  'water.splash': {
    tiles: [TILE.RING_SOFT, TILE.RING_SOFT], orient: 'plane', ramp: RAMP.FROST, life: [0.35, 0.6], size: 0.12,
    sizeEnd: 5, sizeEase: 'outQuart', heat: 0.35, heatEnd: 0.2, emissive: 0.6, additive: 0.2, tint: FOAM,
    opacity: 0.55, fadeIn: 0, fadeOut: 0.7,
  },
  // Fine spray hanging over the burst.
  'water.spray': {
    tiles: TILE_SPANS.smoke, lit: 1, life: [1, 1.8], size: [0.4, 0.8], sizeEnd: 2.4, heat: 0, emissive: 0,
    additive: 0, tint: FOAM, opacity: 0.14, opacityEnd: 0.4, fadeIn: 0.05, fadeOut: 0.5, drag: 1.6, gravity: -0.25,
    turbulence: 0.5, windDrift: 0.4, groundFade: true,
  },
  // The burst's foam ring racing out over the ground.
  'water.ring': {
    tiles: [TILE.RING_THIN, TILE.RING_THIN], orient: 'plane', ramp: RAMP.FROST, life: 1.1, size: 1, sizeEnd: 9,
    sizeEase: 'outCubic', heat: 0.4, heatEnd: 0.15, emissive: 1, additive: 0.3, tint: FOAM, opacity: 0.8,
    fadeIn: 0, fadeOut: 0.6,
  },
  // The shade a hanging blob casts: re-emitted under it while it holds.
  'water.shadow': {
    tiles: [TILE.GLOW, TILE.GLOW], orient: 'plane', lit: 1, life: 0.3, size: 1, heat: 0, emissive: 0, additive: 0,
    tint: [0.02, 0.04, 0.06], opacity: 0.22, fadeIn: 0.3, fadeOut: 0.3, cameraFade: false,
  },
  // Rain Call: a low, heavy cloud and the streaks falling out of it.
  'water.cloud': {
    tiles: [TILE.FOG_BANK, TILE.FOG_BANK], lit: 1, life: [5, 7], size: [4, 6], sizeEnd: 1.25, sizeEase: 'outQuad',
    heat: 0, emissive: 0, additive: 0, tint: [0.42, 0.46, 0.52], opacity: 0.6, fadeIn: 0.15, fadeOut: 0.5,
    drag: 1.4, swirl: 0.12, turbulence: 0.2, turbulenceScale: 0.08, windDrift: 0.2, spin: [0, 0.02],
  },
  'water.rain': {
    tiles: [TILE.STREAK, TILE.STREAK], orient: 'velocity', stretch: 0.06, aspect: 6, lit: 1, life: [1.2, 1.6],
    size: [0.04, 0.06], heat: 0, emissive: 0.3, additive: 0.2, tint: [0.7, 0.82, 0.95], opacity: 0.7,
    fadeIn: 0.05, fadeOut: 0.2, gravity: 12, collide: 'die',
    onImpact: { type: 'water.splash', count: 1, speed: 0, lift: 0.04 },
  },
});
