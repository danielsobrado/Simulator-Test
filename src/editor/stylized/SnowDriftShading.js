import { Fn, If, float, length, max, normalize, smoothstep, vec2, vec3 } from 'three/tsl';
import { noise2, noised, snowWarp } from './SnowNoiseNodes.js';
import { skyLightUniforms } from './sky/skyLight.js';

/**
 * Wind-rounded drifts a few metres across, which the terrain's height pages are
 * too coarse to hold. Appearance only: collision and geometry stay flat. A low
 * sun models them through the slopes and rakes their shadows across the snow,
 * a high one barely shows them.
 */
const BROAD_METERS = 17;
const BROAD_HEIGHT = 1.6;
const FINE_METERS = 7.3;
const FINE_HEIGHT = 0.5;
const FINE_OFFSET = vec2(31.7, -12.4);
const SHADOW_STEPS_METERS = [2.5, 6, 14];
// From a little short of blocked: drift shoulders sink into shade before the sun is cut off.
const SHADOW_START_METERS = -0.2;
const SHADOW_FULL_METERS = 0.1;

const heightAt = (p) => noise2(p.div(BROAD_METERS)).mul(BROAD_HEIGHT)
  .add(noise2(p.div(FINE_METERS).add(FINE_OFFSET)).mul(FINE_HEIGHT));

/** @returns {{ slope: object, shadow: object }} world xz slope, 0..1 sun-blocked share */
export function createSnowDriftNodes({ point, snow, footprint, weight, sun = null }) {
  const amount = smoothstep(10, 40, footprint).oneMinus().mul(weight).toVar();
  const fields = Fn(() => {
    const result = vec3(0).toVar();
    If(snow.greaterThan(0.002).and(amount.greaterThan(0)), () => {
      const q = snowWarp(point).toVar();
      const broad = noised(q.div(BROAD_METERS)).toVar();
      const fine = noised(q.div(FINE_METERS).add(FINE_OFFSET)).toVar();
      const slope = broad.yz.mul(BROAD_HEIGHT / BROAD_METERS).add(fine.yz.mul(FINE_HEIGHT / FINE_METERS));
      let blocked = float(0);
      if (sun) {
        const here = broad.x.mul(BROAD_HEIGHT).add(fine.x.mul(FINE_HEIGHT)).toVar();
        const across = max(length(sun.xz), 1e-3);
        const toward = normalize(sun.xz);
        const rise = sun.y.div(across).toVar();
        for (const step of SHADOW_STEPS_METERS) {
          blocked = max(blocked, heightAt(snowWarp(point.add(toward.mul(step)))).sub(here).sub(rise.mul(step)));
        }
      }
      result.assign(vec3(slope, blocked));
    });
    return result;
  })().toVar();
  return {
    slope: fields.xy.mul(amount),
    // Direct light casts these, so they go with it: at night and under cloud, none. Red, because a golden sun has little green.
    shadow: sun
      ? smoothstep(SHADOW_START_METERS, SHADOW_FULL_METERS, fields.z).mul(amount).mul(smoothstep(0, 0.05, sun.y))
        .mul(skyLightUniforms.sunColor.r.clamp(0, 1))
      : float(0),
  };
}
