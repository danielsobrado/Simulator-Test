import * as THREE from 'three/webgpu';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/**
 * Light for unlit materials (water, mist) that paint their own colours: how
 * bright the sky's light is, and the tint its reflection takes, both relative
 * to the configured look so that look renders exactly as authored. Written by
 * the sky whenever its look changes.
 */
export const skyLightUniforms = {
  brightness: uniform(1),
  reflectionTint: uniform(new THREE.Color(1, 1, 1)),
  // The sun's colour at its strength relative to the configured look, for
  // highlights an unlit material adds on top (the water's glint).
  sunColor: uniform(new THREE.Color(1, 1, 1)),
};

/**
 * How snow takes the light in this place (regionalSkyLook): `brightness`
 * scales its albedo so the lit side keeps headroom below white, `shade` is how
 * far faces turned from the sun fall into shade, `shadeTint` that shade's colour
 * (grey for damp snow, cold blue for dry powder).
 */
export const snowLightUniforms = {
  brightness: uniform(0.82),
  shade: uniform(0.35),
  shadeTint: uniform(new THREE.Color(0.78, 0.836, 0.942)),
};
const SNOW_GREY_SHADE = [0.84, 0.86, 0.9];
// Cool, not cyan: the blue channel leads, green stays near grey.
const SNOW_BLUE_SHADE = [0.74, 0.82, 0.97];

/** Snow's light for `look` (snowBrightness, snowShade, snowBlue). */
export function snowLightFor(look) {
  const blue = Math.max(0, Math.min(1, look.snowBlue ?? 0.6));
  return {
    brightness: look.snowBrightness ?? 0.82,
    shade: look.snowShade ?? 0.35,
    shadeTint: SNOW_GREY_SHADE.map((grey, i) => grey + (SNOW_BLUE_SHADE[i] - grey) * blue),
  };
}

export function updateSnowLight(look) {
  const { brightness, shade, shadeTint } = snowLightFor(look);
  snowLightUniforms.brightness.value = brightness;
  snowLightUniforms.shade.value = shade;
  snowLightUniforms.shadeTint.value.setRGB(shadeTint[0], shadeTint[1], shadeTint[2]);
}

const base = new THREE.Color();
const current = new THREE.Color();

function channelRatio(to, from) {
  return from > 1e-4 ? Math.min(2, to / from) : 1;
}

/** Brightness and reflection tint of `look` against the configured `baseLook`. */
export function skyLightFor(look, baseLook) {
  const baseLight = baseLook.ambientIntensity + baseLook.directionalIntensity;
  const light = look.ambientIntensity + look.directionalIntensity;
  base.set(baseLook.lowColor);
  current.set(look.lowColor);
  return {
    brightness: baseLight > 0 ? Math.min(1.5, light / baseLight) : 1,
    tint: [
      channelRatio(current.r, base.r),
      channelRatio(current.g, base.g),
      channelRatio(current.b, base.b),
    ],
  };
}

export function updateSkyLight(look, baseLook) {
  const { brightness, tint } = skyLightFor(look, baseLook);
  skyLightUniforms.brightness.value = brightness;
  skyLightUniforms.reflectionTint.value.setRGB(tint[0], tint[1], tint[2]);
  const sunStrength = baseLook.directionalIntensity > 0
    ? Math.min(1.5, look.directionalIntensity / baseLook.directionalIntensity)
    : 1;
  skyLightUniforms.sunColor.value.set(look.directionalColor ?? '#ffffff').multiplyScalar(sunStrength);
}
