import { DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from "../_clod_shims/environment_mask_config.js";
const MEADOW_CELL_SIZE = 12;
const MEADOW_RING_RADIUS = 42;
const MEADOW_BOUNDS_RADIUS = 104;
const MEADOW_PARTICLE_COUNT = 1200;
const MEADOW_NEAR_COUNT = 550;
const MEADOW_MID_COUNT = 400;
const MEADOW_FAR_COUNT = 250;
const MEADOW_MODE_VISUAL_AMOUNT = 0.7;
const MEADOW_MIN_ATLAS_VISIBILITY = 0.45;
const MEADOW_MIN_FORWARD_SCATTER = 0.28;
const MEADOW_ALPHA_CUTOFF = 0.0015;
const moteMask = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.sunbeamMote;
const DEFAULT_MEADOW_WEATHER_SETTINGS = {
  enabled: true,
  intensity: 0.7,
  windX: -0.42,
  windZ: 0.18,
  motes: {
    enabled: false,
    strength: moteMask.strength,
    visibilityStart: moteMask.visibilityStart,
    visibilityEnd: moteMask.visibilityEnd,
    maxParticles: moteMask.particles.maxParticles,
    spawnRadiusM: moteMask.particles.spawnRadiusM,
    fadeStartM: moteMask.particles.fadeStartM,
    fadeEndM: moteMask.particles.fadeEndM,
    updatePeriodFrames: moteMask.particles.updatePeriodFrames,
    density: moteMask.particles.density,
    opacity: moteMask.particles.opacity,
    forwardScatterPower: moteMask.particles.forwardScatterPower,
    mistFloor: moteMask.particles.mistFloor,
    warmColorRgb: [...moteMask.particles.warmColorRgb],
    coldColorRgb: [...moteMask.particles.coldColorRgb]
  }
};
export {
  DEFAULT_MEADOW_WEATHER_SETTINGS,
  MEADOW_BOUNDS_RADIUS,
  MEADOW_CELL_SIZE,
  MEADOW_FAR_COUNT,
  MEADOW_ALPHA_CUTOFF,
  MEADOW_MID_COUNT,
  MEADOW_MIN_ATLAS_VISIBILITY,
  MEADOW_MIN_FORWARD_SCATTER,
  MEADOW_MODE_VISUAL_AMOUNT,
  MEADOW_NEAR_COUNT,
  MEADOW_PARTICLE_COUNT,
  MEADOW_RING_RADIUS
};
