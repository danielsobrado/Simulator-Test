import { frameUniform } from '../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lensDirt } from 'three/addons/tsl/display/lensDirt.js';
import {
  dot,
  float,
  fract,
  mix,
  screenCoordinate,
  sin,
  smoothstep,
  time,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { getLensDirtTexture } from './lensDirtTexture.js';
import { lookGrade } from './sky/lookGrade.js';

/**
 * The walking view's finish, ported from grass-test's cinematic pipeline
 * (`CinematicPipeline#grade` and its bloom): a filmic grade in linear light
 * ahead of the tone mapper, and a restrained bloom.
 *
 *  - saturation, then a power contrast through mid-grey (0.18) so the exposure
 *    holds and dark tones are compressed, never clipped;
 *  - a lift/gain split that cools the shadows and warms the highlights;
 *  - highlight desaturation, so sunlit grass bleaches toward white, not neon;
 *  - a soft vignette and a fine animated grain;
 *  - lens dirt, revealed by the bloom only where the frame is bright (sun).
 *
 * Defaults are the donor's shipped values (`cinematic.post`). Everything is a
 * uniform, so a look can be tuned live; `enabled: false` leaves the frame as the
 * pipeline composed it.
 */
export const DEFAULT_CINEMATIC_FINISH = Object.freeze({
  enabled: true,
  saturation: 1.04,
  contrast: 1.12,
  lift: Object.freeze([0.004, 0.006, 0.012]),
  gain: Object.freeze([1.02, 1, 0.97]),
  highlightDesaturation: 0.35,
  vignette: 0.14,
  grain: 0.012,
  bloom: Object.freeze({ enabled: true, strength: 0.09, radius: 0.3, threshold: 2.1 }),
  // Reads the bloom's blurred light, so it needs bloom and costs one texture tap.
  lensDirt: Object.freeze({ enabled: true, intensity: 1.5 }),
});

const LUMA = vec3(0.2126, 0.7152, 0.0722);

function finite(value, fallback, path, min = -Infinity, max = Infinity) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be a number in [${min}, ${max}].`);
  }
  return resolved;
}

function triple(value, fallback, path) {
  const resolved = value ?? fallback;
  if (!Array.isArray(resolved) || resolved.length !== 3 || !resolved.every(Number.isFinite)) {
    throw new Error(`Invalid editor configuration: ${path} must be an [r, g, b] triple.`);
  }
  return [...resolved];
}

/** @param {object | undefined} source stylizedSurface.cinematicFinish */
export function resolveCinematicFinish(source) {
  const d = DEFAULT_CINEMATIC_FINISH;
  if (source?.enabled === false) return { enabled: false };
  const path = 'stylizedSurface.cinematicFinish';
  const bloomSource = { ...d.bloom, ...(source?.bloom ?? {}) };
  const dirtSource = { ...d.lensDirt, ...(source?.lensDirt ?? {}) };
  return {
    enabled: true,
    saturation: finite(source?.saturation, d.saturation, `${path}.saturation`, 0, 3),
    contrast: finite(source?.contrast, d.contrast, `${path}.contrast`, 0, 3),
    lift: triple(source?.lift, d.lift, `${path}.lift`),
    gain: triple(source?.gain, d.gain, `${path}.gain`),
    highlightDesaturation: finite(source?.highlightDesaturation, d.highlightDesaturation, `${path}.highlightDesaturation`, 0, 1),
    vignette: finite(source?.vignette, d.vignette, `${path}.vignette`, 0, 1),
    grain: finite(source?.grain, d.grain, `${path}.grain`, 0, 0.2),
    bloom: bloomSource.enabled === false ? { enabled: false } : {
      enabled: true,
      strength: finite(bloomSource.strength, d.bloom.strength, `${path}.bloom.strength`, 0, 4),
      radius: finite(bloomSource.radius, d.bloom.radius, `${path}.bloom.radius`, 0, 1),
      threshold: finite(bloomSource.threshold, d.bloom.threshold, `${path}.bloom.threshold`, 0, 20),
    },
    lensDirt: dirtSource.enabled === false || bloomSource.enabled === false ? { enabled: false } : {
      enabled: true,
      intensity: finite(dirtSource.intensity, d.lensDirt.intensity, `${path}.lensDirt.intensity`, 0, 20),
    },
  };
}

/** Live uniforms for a resolved finish. */
export function createFinishUniforms(settings) {
  return {
    saturation: frameUniform(settings.saturation),
    contrast: frameUniform(settings.contrast),
    lift: frameUniform(new THREE.Vector3(...settings.lift)),
    gain: frameUniform(new THREE.Vector3(...settings.gain)),
    highlightDesaturation: frameUniform(settings.highlightDesaturation),
    vignette: frameUniform(settings.vignette),
    grain: frameUniform(settings.grain),
    lensDirt: frameUniform(settings.lensDirt?.intensity ?? 0),
  };
}

/** The donor's grade, in linear light. */
export function gradeNode(input, grade) {
  // The sky look leans each term (sky/lookGrade.js); all four are 1 at clear noon.
  const saturated = mix(vec3(dot(input, LUMA)), input, lookGrade.saturation.mul(grade.saturation));
  const pivot = float(0.18);
  // A power curve through the pivot, not a linear stretch: (v − 0.18)·c + 0.18
  // clipped every linear value under ~0.02 to black, which blacked out the
  // whole floor of a dim bog. Same pivot, same midtone slope, darks stay dark.
  const contrasted = saturated.max(1e-6).div(pivot).pow(lookGrade.contrast.mul(grade.contrast)).mul(pivot);
  const shaped = contrasted.mul(lookGrade.gain.mul(grade.gain))
    .add(lookGrade.lift.mul(grade.lift).mul(contrasted.oneMinus().max(0)));
  const shapedLuma = dot(shaped, LUMA);
  const rolled = mix(shaped, vec3(shapedLuma), smoothstep(0.55, 1.4, shapedLuma).mul(grade.highlightDesaturation));
  const vignette = smoothstep(0.18, 0.95, uv().sub(0.5).length()).mul(grade.vignette).oneMinus();
  const grain = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233)).add(time.fract().mul(43758.5453))).mul(43758.5453))
    .sub(0.5).mul(grade.grain);
  return rolled.mul(vignette).add(grain).max(0);
}

/**
 * The finished linear frame: bloom (and lens dirt lit by it) added in, then graded.
 *
 * @param {object} composite vec4 node, scene-referred
 * @param {object} options
 * @param {object} options.beauty the scene pass's colour texture node, for bloom
 * @param {object} options.settings resolveCinematicFinish()
 * @param {object} options.uniforms createFinishUniforms()
 * @returns {{ node: object, bloom: object | null }}
 */
export function finishFrame(composite, { beauty, settings, uniforms }) {
  if (!settings?.enabled) return { node: composite, bloom: null };
  let rgb = composite.rgb;
  let bloomNode = null;
  if (settings.bloom.enabled) {
    bloomNode = bloom(beauty, settings.bloom.strength, settings.bloom.radius, settings.bloom.threshold);
    rgb = rgb.add(bloomNode.rgb);
    if (settings.lensDirt?.enabled) {
      rgb = rgb.add(lensDirt(bloomNode.getTextureNode(), texture(getLensDirtTexture()), uniforms.lensDirt).rgb);
    }
  }
  return { node: vec4(gradeNode(rgb, uniforms), composite.a), bloom: bloomNode };
}
