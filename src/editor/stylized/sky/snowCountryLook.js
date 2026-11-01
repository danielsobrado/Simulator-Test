import * as THREE from 'three/webgpu';

/**
 * Snow country's air (after grass-test's SnowAtmosphere): a cooler, paler sky,
 * a cool haze, light bouncing up off the snow and a slightly warmer sun. Every
 * change is relative to the look it is given, as a tint or a scale, so a
 * moonlit summit stays moonlit and a golden-hour one stays golden.
 */
const COOL_SKY = [0.92, 0.99, 1.08];
/**
 * A winter sky is light, not the deep summer blue (Tiny Glade's snow scenes):
 * the dome leans toward these pale blues. Each target is scaled to the
 * colour's own luminance times its lift, so a night or dusk sky stays as dark
 * as it was and only a daylit one turns pale. A tint alone could not get there:
 * the presets' zenith is so saturated that even a full one left glacier air a
 * mid summer blue.
 */
const WINTER_ZENITH = Object.freeze({ color: '#8fb7e6', lift: 2.3, amount: 0.85 });
const WINTER_HORIZON = Object.freeze({ color: '#d4e4f1', lift: 1.25, amount: 0.7 });
const COOL_FOG = [0.95, 1.0, 1.06];
const WARM_SUN = [1.04, 1.0, 0.94];
/** How far the horizon and fog pale toward their own luminance. */
const PALING = 0.35;
/**
 * Exposure deep in snow country, as a share of the configured exposure: the
 * eye (and a camera) stops down for a snowfield. At full exposure sunlit snow
 * clipped to flat white at midday and its shade and blue never showed.
 */
const SNOW_EXPOSURE = 0.74;

const scratch = new THREE.Color();

function tinted(hex, tint, weight, paling = 0) {
  scratch.set(hex);
  const luminance = scratch.r * 0.2126 + scratch.g * 0.7152 + scratch.b * 0.0722;
  const r = scratch.r + (luminance - scratch.r) * paling * weight;
  const g = scratch.g + (luminance - scratch.g) * paling * weight;
  const b = scratch.b + (luminance - scratch.b) * paling * weight;
  const mix = (value, factor) => Math.min(1, value * (1 + (factor - 1) * weight));
  return `#${scratch.setRGB(mix(r, tint[0]), mix(g, tint[1]), mix(b, tint[2])).getHexString()}`;
}

const target = new THREE.Color();

function luminanceOf(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

/** Leans a sky colour toward a winter blue at its own (lifted) brightness. */
function wintered(hex, winter, weight) {
  scratch.set(hex);
  target.set(winter.color);
  const brightness = Math.min(1, luminanceOf(scratch) * winter.lift) / Math.max(1e-6, luminanceOf(target));
  target.multiplyScalar(brightness);
  target.r = Math.min(1, target.r);
  target.g = Math.min(1, target.g);
  target.b = Math.min(1, target.b);
  return `#${scratch.lerp(target, weight * winter.amount).getHexString()}`;
}

/** @param {number} weight 0 lowland … 1 deep in snow country */
export function snowCountryLook(look, weight) {
  const w = Math.max(0, Math.min(1, weight));
  if (w === 0) return look;
  // The weight is a ring average, so a snowy forest broken by lakes or a
  // neighbouring biome sits near 0.3; the sky's colour leads it (an ease-out),
  // while exposure and density keep the plain weight.
  // A low sun keeps its warm sky: only a daylit dome pales to winter blue.
  const daylight = THREE.MathUtils.smoothstep(look.sunElevation ?? 90, 10, 30);
  const sky = (1 - (1 - w) ** 2) * daylight;
  return {
    ...look,
    lowColor: wintered(tinted(look.lowColor, COOL_SKY, sky, PALING), WINTER_HORIZON, sky),
    highColor: wintered(look.highColor, WINTER_ZENITH, sky),
    fogColor: tinted(look.fogColor, COOL_FOG, sky, PALING),
    directionalColor: tinted(look.directionalColor, WARM_SUN, w),
    ambientIntensity: look.ambientIntensity * (1 + 0.15 * w),
    fogDensityScale: look.fogDensityScale * (1 + 0.35 * w),
    // Low sun leaves snow well below clipping, so the camera stops down half as far.
    exposure: (look.exposure ?? 1) * (1 + (SNOW_EXPOSURE - 1) * w * (0.5 + 0.5 * daylight)),
  };
}
