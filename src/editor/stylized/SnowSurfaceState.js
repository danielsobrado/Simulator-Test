import { Fn, If, dot, float, mix, smoothstep, vec2, vec3 } from 'three/tsl';
import { noise2, snowWarp } from './SnowNoiseNodes.js';
import { worldWindUniforms } from '../weather/wind/worldWindState.js';

/** Bounded canonical coordinates, independent of chunk assignment and camera rebases. */
export function snowSurfacePoint(local, chunkCenter) {
  return chunkCenter.mod(1024).add(local).mod(1024).toVar();
}

/** Shared wind exposure, sheltered powder and route compaction, after Gods' End. */
export function createSnowSurfaceState({ point, snow, pathMask, worldNormal, settings }) {
  const windward = dot(worldNormal.xz, worldWindUniforms.prevailing).negate();
  const fields = Fn(() => {
    const result = vec3(0.5, 0, 0).toVar();
    // Read the base normal before entering the activity branch: it may carry
    // heightfield derivatives, which require uniform control flow in WGSL.
    If(snow.greaterThan(0.002).and(worldNormal.y.greaterThanEqual(-1)), () => {
      const broad = noise2(point.mul(0.009).add(vec2(13.7, 41.2)));
      const exposure = broad.mul(0.6).add(0.5).add(windward.mul(settings.windward * 2.5)).clamp(0, 1);
      let calm = float(0);
      if (settings.calmCoverage > 0) {
        const warped = snowWarp(point);
        const powder = noise2(warped.div(settings.calmScale)).mul(0.65)
          .add(noise2(warped.div(settings.calmScale * 0.37).add(vec2(17.3, -4.1))).mul(0.35));
        const threshold = (0.5 - settings.calmCoverage) * 0.5;
        calm = smoothstep(threshold - 0.1, threshold + 0.1, powder)
          .mul(smoothstep(0.7, 0.95, exposure).oneMinus());
        // The periodic noise meets a neutral surface at its repeat boundary.
        const edge = point.x.min(point.y).min(float(1024).sub(point.x)).min(float(1024).sub(point.y));
        calm = calm.mul(smoothstep(0, 8, edge));
      }
      result.assign(vec3(exposure, calm, pathMask.clamp(0, 1).mul(settings.pathCompaction)));
    });
    return result;
  })().toVar();
  return {
    exposure: fields.x,
    compressed: fields.z,
    reliefScale: mix(float(1), float(settings.calmRelief), fields.y).mul(fields.z.oneMinus()),
    detailScale: mix(float(1), float(settings.calmDetail), fields.y).mul(float(1).sub(fields.z.mul(0.55))),
    flatness: smoothstep(0.62, 0.88, worldNormal.y),
  };
}
