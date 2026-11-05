import { Vector4 } from 'three';
import { frameUniform as uniform } from '../../render/FrameUniforms.js';
import { resolveSeaSurf, sampleSeaHeightCpu } from './SeaSurf.js';
import { seaExposure } from './WaterAppearance.js';
import { updateWaterVisualClock } from './WaterVisualClock.js';

/**
 * The sea's shared, per-frame state, read by every water material and by
 * gameplay water queries so a swimmer rides the waves that are drawn.
 *
 * Module state like the wind field's, because the materials that read it are
 * built long before anything drives it.
 */
export const seaStateUniforms = Object.freeze({
  /** 0 calm .. 1 storm; raises the swell and lowers the whitecap threshold. */
  storm: uniform(0),
  /** The world's still-water level: only water at this level is sea. */
  seaLevel: uniform(-1.5),
  /** 0 dry .. 1 downpour: rain rings on every water surface. */
  rain: uniform(0),
  /** The region's water colour (biome-looks `water`): rgb multiplier, w = desaturation. */
  waterTint: uniform(new Vector4(1, 1, 1, 0)),
});

let seaConfig = null;
let seaTime = 0;
let surfSettings = null;

export function configureSea(config) {
  seaConfig = config?.enabled ? config : null;
  surfSettings = resolveSeaSurf(config?.surf);
}

export function updateSeaState({ timeSeconds, storm, seaLevel, rain, water }) {
  if (water) seaStateUniforms.waterTint.value.set(water.tint[0], water.tint[1], water.tint[2], water.desaturate);
  if (Number.isFinite(rain)) seaStateUniforms.rain.value = Math.max(0, Math.min(1, rain));
  if (Number.isFinite(timeSeconds)) seaTime = updateWaterVisualClock(timeSeconds);
  if (Number.isFinite(storm)) seaStateUniforms.storm.value = Math.max(0, Math.min(1, storm));
  if (Number.isFinite(seaLevel)) seaStateUniforms.seaLevel.value = seaLevel;
}

/** Swell sharpness: choppier in a storm. */
export function seaSharpness(config, storm) {
  return config.choppiness * 0.075 * (1 + storm * 0.5);
}

/** Swell amplitude in metres over water `depth` deep: none in the shallows. */
export function seaAmplitude(config, storm, depth) {
  if (!(depth > 0)) return 0;
  const offshore = config.amplitude * (1 + storm * (config.stormScale - 1));
  const shallow = Math.max(0, Math.min(1, depth / config.shallowDepth));
  return Math.min(offshore, depth * config.depthRatio) * shallow * shallow * (3 - 2 * shallow);
}

/** The drawn swell's height, in metres, over canonical sea water `depth` deep. */
export function seaSurfaceOffset(x, z, depth, shoreDistance = 48) {
  if (!seaConfig) return 0;
  const storm = seaStateUniforms.storm.value;
  const amplitude = seaAmplitude(seaConfig, storm, depth) * seaExposure(shoreDistance);
  if (amplitude <= 0) return 0;
  return amplitude * sampleSeaHeightCpu(x, z, depth, seaTime, seaSharpness(seaConfig, storm), surfSettings);
}
