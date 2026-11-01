import * as THREE from 'three';
import { clamp, dot, float, Fn, If, length, max, vec3 } from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/**
 * The one spell light the world itself sees. Real point lights put every lit
 * material on the punctual-light path and cost frame time even dimmed to zero
 * (see EffectLightPool), so the brightest effect light is instead handed to
 * the terrain and grass shaders as two uniforms, which add it as emission.
 *
 * With no spell lit, `position.w` (the range) is 0 and the shaders skip the
 * term behind a uniform branch, so the idle cost is one comparison per pixel.
 */
/**
 * Whether the world shaders are built with spell light, the spell press map
 * and grass marks at all. `?spellWorld=0` compiles them out, as the A/B
 * control for `qa:perf` (docs/perf-qa.md).
 */
export const spellWorldEnabled = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('spellWorld') !== '0';

export const spellWorldLight = Object.freeze({
  /** Render-space position in xyz; range in metres in w, 0 when no spell is lit. */
  position: uniform(new THREE.Vector4(0, -1e6, 0, 0)),
  /** Linear radiance at the light, already scaled by its intensity. */
  color: uniform(new THREE.Color(0, 0, 0)),
});

/** Radiance scale per unit of effect-light intensity, before the soft ceiling. */
const RADIANCE_PER_INTENSITY = 0.006;
/**
 * Radiance a blast saturates toward: a fireball's 900 reaches ~2.6, Meteor
 * Swarm's 1600 ~3, so big blasts warm the meadow instead of bleaching it white.
 */
const RADIANCE_CEILING = 3.2;

/**
 * Light from the spell reaching a surface: quadratic falloff to the range and
 * a wrapped Lambert term, so grass lit from the side still warms.
 *
 * @param {object} worldPosition render-space position node
 * @param {object} worldNormal unit world-space normal node
 * @returns {object} vec3 node, multiplied by albedo and added as emission
 */
export const spellLightIrradiance = Fn(([worldPosition, worldNormal]) => {
  const light = vec3(0).toVar();
  const range = spellWorldLight.position.w;
  If(range.greaterThan(0), () => {
    const toLight = spellWorldLight.position.xyz.sub(worldPosition);
    const distance = max(length(toLight), 0.05);
    const falloff = clamp(float(1).sub(distance.div(range)), 0, 1);
    const facing = clamp(dot(worldNormal, toLight.div(distance)).mul(0.6).add(0.4), 0, 1);
    light.assign(vec3(spellWorldLight.color).mul(falloff.mul(falloff).mul(facing)));
  });
  return light;
});

/**
 * Writes the brightest lit effect light into the world light, or switches it
 * off. Called by the light pool once a frame after its own update.
 *
 * @param {{ x: number, y: number, z: number, power: number, range: number, r: number, g: number, b: number } | null} brightest
 */
export function setSpellWorldLight(brightest) {
  if (!brightest || brightest.power <= 0) {
    spellWorldLight.position.value.w = 0;
    spellWorldLight.color.value.setRGB(0, 0, 0);
    return;
  }
  const scale = RADIANCE_CEILING * (1 - Math.exp(-brightest.power * RADIANCE_PER_INTENSITY / RADIANCE_CEILING));
  spellWorldLight.position.value.set(brightest.x, brightest.y, brightest.z, brightest.range);
  spellWorldLight.color.value.setRGB(brightest.r * scale, brightest.g * scale, brightest.b * scale);
}
