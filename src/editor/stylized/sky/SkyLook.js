import * as THREE from 'three/webgpu';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

import { DEFAULT_SKY_PRESET, SKY_PRESETS } from './SkyPresets.js';

/**
 * A sky look: every value a time of day or the weather changes, resolved from
 * `stylizedSurface.sky` plus a preset. Colours are hex strings, the rest
 * numbers; `night` is a flag for listeners (crickets, not birds).
 */
export const SKY_LOOK_COLORS = Object.freeze([
  'lowColor', 'highColor', 'sunColor', 'sunGlowColor',
  'cloudCore', 'cloudEdge', 'cloudRim',
  'fogColor', 'groundLightColor', 'directionalColor',
]);
export const SKY_LOOK_NUMBERS = Object.freeze([
  'sunElevation', 'sunAzimuth', 'sunEmission', 'sunGlowIntensity',
  'cloudOpacity', 'cloudDensity',
  'ambientIntensity', 'ambientSaturation', 'directionalIntensity', 'fogDensityScale',
  'cloudShadowStrength', 'shadowRadius',
  'cloudSharpness', 'cloudDetail', 'mist', 'snowBrightness', 'snowShade', 'snowBlue', 'nightness',
  'exposure', 'skyFog', 'whiteout',
]);
/**
 * Look values with a fixed neutral default when neither the preset nor the
 * config names them: the cloud form (detail 1 is the plain fbm), how misty the
 * air is (valley fog), and how snow takes the light — `snowBrightness` scales its
 * albedo, `snowShade` how far faces turned from the sun fall into shade, and
 * `snowBlue` how blue that shade is (0 grey, 1 cold blue). `skyFog` is how far
 * the dome itself sinks into the fog colour (a bog's murk swallows its sky), and
 * `whiteout` carries that fog band up to the zenith (a blizzard hides sun and stars).
 */
const LOOK_NUMBER_DEFAULTS = Object.freeze({
  cloudSharpness: 0.24, cloudDetail: 1, mist: 0, exposure: 1, snowBrightness: 0.82, snowShade: 0.35, snowBlue: 0.6,
  skyFog: 0, whiteout: 0,
});
/** The look values the sky material reads, which become its uniforms. */
const MATERIAL_COLORS = Object.freeze(['lowColor', 'highColor', 'sunColor', 'sunGlowColor', 'cloudCore', 'cloudEdge', 'cloudRim',
  'fogColor']);
const MATERIAL_NUMBERS = Object.freeze(['sunEmission', 'sunGlowIntensity', 'cloudOpacity', 'cloudDensity',
  'cloudSharpness', 'cloudDetail', 'skyFog', 'whiteout']);

export function skyPresetNames() {
  return Object.keys(SKY_PRESETS);
}

/** The configured sky with a preset's overrides laid over it. */
export function resolveSkyLook(sky, presetName = DEFAULT_SKY_PRESET) {
  const preset = SKY_PRESETS[presetName] ?? SKY_PRESETS[DEFAULT_SKY_PRESET];
  const look = { night: Boolean(preset.night) };
  for (const key of SKY_LOOK_COLORS) look[key] = preset[key] ?? sky[key];
  for (const key of SKY_LOOK_NUMBERS) look[key] = preset[key] ?? sky[key];
  for (const [key, value] of Object.entries(LOOK_NUMBER_DEFAULTS)) {
    if (!Number.isFinite(look[key])) look[key] = value;
  }
  // `night` flips halfway through a blend; `nightness` eases with it, for
  // anything that must not pop at dusk (stars, moonlit clouds).
  look.nightness = preset.night ? 1 : 0;
  look.ambientSaturation = preset.ambientSaturation ?? sky.ambientSaturation ?? 1;
  look.shadowRadius = preset.shadowRadius ?? sky.shadowRadius ?? 2.4;
  look.fogDensityScale = preset.fogDensityScale ?? 1;
  look.cloudShadowStrength = preset.cloudShadowStrength ?? sky.cloudShadows?.strength ?? 0;
  return look;
}

const mixA = new THREE.Color();
const mixB = new THREE.Color();

function lerpAngle(from, to, t) {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta * t;
}

/** Between two looks; colours blend in linear space, the sun takes the short way round. */
export function mixSkyLooks(from, to, t) {
  const look = { night: t < 0.5 ? from.night : to.night };
  for (const key of SKY_LOOK_COLORS) {
    look[key] = `#${mixA.set(from[key]).lerp(mixB.set(to[key]), t).getHexString()}`;
  }
  for (const key of SKY_LOOK_NUMBERS) look[key] = from[key] * (1 - t) + to[key] * t;
  look.sunAzimuth = t >= 1 ? to.sunAzimuth : lerpAngle(from.sunAzimuth, to.sunAzimuth, t);
  return look;
}

function greyed(hex, amount, dim) {
  mixA.set(hex);
  const luminance = mixA.r * 0.2126 + mixA.g * 0.7152 + mixA.b * 0.0722;
  mixB.setRGB(luminance, luminance * 1.02, luminance * 1.06);
  return `#${mixA.lerp(mixB, amount).multiplyScalar(1 - dim * amount).getHexString()}`;
}

/** How much each colour darkens under full cover: rain clouds read grey, not white. */
const OVERCAST_DIMMING = Object.freeze({ highColor: 0.35, cloudCore: 0.5, cloudEdge: 0.4, cloudRim: 0.5 });

/** Far enough under the cloud noise's whole range, with the stratus sharpness, that nothing shows through. */
const OVERCAST_CLOUD_DENSITY = -0.25;

/** Storm levels (StormState: clear 0, light 0.25, moderate 0.5, heavy 0.75, storm 1)
 * and the light left under each, as a share of the clear look (plan §4.1). */
const STORM_LEVELS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const STORM_LIGHT = Object.freeze({
  directionalIntensity: [1, 0.6, 0.25, 0.15, 0.1],
  ambientIntensity: [1, 0.95, 0.88, 0.8, 0.7],
  cloudShadowStrength: [1, 0.5, 0.1, 0, 0],
});

/** A per-level ladder read at storm value `storm`, linear between the levels. */
export function stormLadder(values, storm) {
  const s = Math.max(0, Math.min(1, storm));
  const i = Math.min(STORM_LEVELS.length - 2, Math.floor(s * 4));
  const t = (s - STORM_LEVELS[i]) / (STORM_LEVELS[i + 1] - STORM_LEVELS[i]);
  return values[i] + (values[i + 1] - values[i]) * t;
}

/**
 * The look under cloud cover: colours drain toward a cool grey, the sun
 * weakens, clouds close up and stop casting distinct shadows, fog thickens.
 * Works for any time of day, so rain at night stays dark. A storm darkens past
 * full overcast: its light ladder is a floor the cover cannot lift.
 *
 * @param {number} amount 0 clear … 1 full overcast
 * @param {number} [storm] 0 clear … 1 full storm (StormState)
 */
export function overcastSkyLook(look, amount, storm = 0) {
  const t = Math.max(0, Math.min(1, amount));
  if (t === 0 && !(storm > 0)) return look;
  const s = Math.max(0, Math.min(1, storm));
  const result = { ...look };
  // Preserve the weather mix through the regional fog/snow layers for diffuse sky light.
  result.overcastAmount = t;
  // For the grade (lookGrade.js): a storm drains colour further than a dry lid.
  result.stormAmount = s;
  for (const key of SKY_LOOK_COLORS) result[key] = greyed(look[key], t * 0.75, OVERCAST_DIMMING[key] ?? 0.15);
  // Dark bases under a storm: the cloud's core falls further than its lit edge.
  if (s > 0) result.cloudCore = `#${mixA.set(result.cloudCore).multiplyScalar(1 - 0.35 * s).getHexString()}`;
  result.directionalIntensity = look.directionalIntensity
    * Math.min(1 - 0.85 * t, stormLadder(STORM_LIGHT.directionalIntensity, storm));
  result.ambientIntensity = look.ambientIntensity
    * Math.min(1 - 0.15 * t, stormLadder(STORM_LIGHT.ambientIntensity, storm));
  result.shadowRadius = look.shadowRadius * (1 + 1.5 * t);
  result.sunEmission = look.sunEmission * (1 - 0.8 * t);
  result.sunGlowIntensity = look.sunGlowIntensity * (1 - 0.8 * t);
  // Toward an absolute lid, not by an offset: a clear-skied region would otherwise keep blue holes at full cover.
  // Linear in the cover: squared, a sky at cloud 0.55 still read mostly clear.
  result.cloudDensity = look.cloudDensity + (OVERCAST_CLOUD_DENSITY - look.cloudDensity) * t;
  result.cloudOpacity = Math.min(1, look.cloudOpacity + 0.3 * t);
  result.cloudShadowStrength = look.cloudShadowStrength
    * Math.min(1 - t, stormLadder(STORM_LIGHT.cloudShadowStrength, storm));
  result.fogDensityScale = look.fogDensityScale * (1 + 0.6 * t);
  // A grey lid: soft-edged, smooth stratus rather than broken cumulus, and the
  // flat light takes the modelling out of the snow. A storm deck is not smooth:
  // its detail and edges come back.
  result.cloudSharpness = look.cloudSharpness + 0.2 * t * (1 - 0.6 * s);
  result.cloudDetail = look.cloudDetail * (1 - 0.4 * t * (1 - 0.75 * s));
  result.mist = Math.min(1, look.mist + 0.3 * t);
  result.snowShade = look.snowShade * (1 - 0.5 * t);
  return result;
}

/** Uniforms for the look values the sky material reads. */
export function createSkyLookUniforms(look) {
  const uniforms = {};
  for (const key of MATERIAL_COLORS) uniforms[key] = uniform(new THREE.Color(look[key]));
  for (const key of MATERIAL_NUMBERS) uniforms[key] = uniform(look[key]);
  return uniforms;
}

export function writeSkyLookUniforms(uniforms, look) {
  for (const key of MATERIAL_COLORS) uniforms[key].value.set(look[key]);
  for (const key of MATERIAL_NUMBERS) uniforms[key].value = look[key];
}
