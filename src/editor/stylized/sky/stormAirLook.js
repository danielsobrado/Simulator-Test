import * as THREE from 'three/webgpu';

import { stormLadder } from './SkyLook.js';

/**
 * Storm air laid over the finished look (after the regional fog bound, snow
 * country and the bog murk): it is weather, not region (plan §4.1–4.2).
 *
 * Fog closes to a visibility target per storm level, converted against the
 * active base density, so it only ever thickens a look. Rain pulls the fog
 * toward a dark blue-grey, snow toward a sky-lit white, and a heavy snowstorm
 * becomes a whiteout: the fog band rises to the zenith and the sun and stars go.
 */

/** Metres seen at 5 % contrast per level (clear, light, moderate, heavy, storm). */
const RAIN_VISIBILITY = Object.freeze([Infinity, 1500, 600, 250, 150]);
/**
 * A blizzard keeps its near field: FogExp2 at 140 m leaves ~20 % fog at 40 m and
 * ~60 % at 80 m, so footing and rocks read and only the distance goes; the flakes
 * and their curtain carry the density (50 m erased everything past ~25 m).
 */
const SNOW_STORM_VISIBILITY = 140;
/** FogExp2: visibility at 5 % contrast ≈ 1.73 / density. */
const CONTRAST_DISTANCE = 1.73;
const RAIN_FOG = '#4a535c';
const SNOW_FOG = '#dde4ec';
/** Night scale of the storm fog colours, linear (≈ ×0.35 in sRGB): a storm at night stays dark. */
const NIGHT_FOG = 0.1;

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const fogA = new THREE.Color();
const fogB = new THREE.Color();

/** The fog density a storm asks for (FogExp2 units), 0 at clear. */
export function stormFogDensity(storm, snowShare = 0) {
  const visibility = RAIN_VISIBILITY.map((metres, i) => (i === RAIN_VISIBILITY.length - 1
    ? metres + (SNOW_STORM_VISIBILITY - metres) * clamp01(snowShare)
    : metres));
  return stormLadder(visibility.map((metres) => CONTRAST_DISTANCE / metres), storm);
}

/** How white the sky is (0..1): only heavy snow brings a whiteout. */
export function stormWhiteout(storm, snowShare = 0) {
  return clamp01(snowShare) * smoothstep(0.6, 1, storm);
}

/**
 * @param {object} look a finished sky look
 * @param {{ storm: number, snowShare: number }} weather StormState frame values
 * @param {number} baseFogDensity the scene fog density a `fogDensityScale` of 1 means
 */
export function stormAirLook(look, { storm = 0, snowShare = 0 } = {}, baseFogDensity = 0) {
  const s = clamp01(storm);
  if (s === 0) return look;
  const share = clamp01(snowShare);
  const result = { ...look };
  if (baseFogDensity > 0) {
    result.fogDensityScale = Math.max(look.fogDensityScale, stormFogDensity(s, share) / baseFogDensity);
  }
  const night = 1 - (1 - NIGHT_FOG) * clamp01(look.nightness ?? (look.night ? 1 : 0));
  fogB.set(RAIN_FOG).lerp(fogA.set(SNOW_FOG), share).multiplyScalar(night);
  result.fogColor = `#${fogA.set(look.fogColor).lerp(fogB, 0.85 * smoothstep(0.2, 1, s)).getHexString()}`;
  // The dome sinks into the murk with the far trees, or the horizon draws a seam.
  const whiteout = stormWhiteout(s, share);
  result.skyFog = Math.max(look.skyFog ?? 0, 0.7 * smoothstep(0.4, 1, s), whiteout);
  result.whiteout = Math.max(look.whiteout ?? 0, whiteout);
  // Snow light comes from everywhere: the white air lifts the ambient the cloud took.
  result.ambientIntensity = look.ambientIntensity * (1 + 0.35 * share * s);
  return result;
}
