import { Fn, If, atan, cameraViewMatrix, float, length, max, mix, normalize, smoothstep, vec3, vec4 } from 'three/tsl';
import { createSnowDriftNodes } from './SnowDriftShading.js';
import { snowFineRelief } from './SnowNoiseNodes.js';
import { skyLightUniforms, snowLightUniforms } from './sky/skyLight.js';
import { worldWindUniforms } from '../weather/wind/worldWindState.js';
import { resolveSnowSurfaceConfig } from './SnowSurfaceConfig.js';
import { createSnowSurfaceState, snowSurfacePoint } from './SnowSurfaceState.js';

const DRIFT_SKY_LIGHT = vec3(0.05, 0.085, 0.16);

/** Analytic slopes only: neither terrain height nor collision changes. */
export function createSnowReliefNodes({ local, chunkCenter, snow, pathMask, worldNormal = vec3(0, 1, 0),
  settings = resolveSnowSurfaceConfig(), state = null, sun = null }) {
  // Fade to the shared texture at repeat boundaries; no discontinuity at a rebase or chunk edge.
  const p = snowSurfacePoint(local, chunkCenter);
  const footprint = max(length(local.dFdx()), length(local.dFdy())).toVar();
  const edge = p.x.min(p.y).min(float(1024).sub(p.x)).min(float(1024).sub(p.y));
  const boundary = smoothstep(0, 8, edge);
  const surface = state ?? createSnowSurfaceState({ point: p, snow, pathMask, worldNormal, settings });
  const wind = atan(worldWindUniforms.prevailing.y, worldWindUniforms.prevailing.x);
  const relief = Fn(() => {
    const value = vec3(0).toVar();
    If(snow.greaterThan(0.002).and(footprint.greaterThan(0)).and(surface.exposure.greaterThanEqual(0)), () => {
      value.assign(snowFineRelief(p, wind, surface.exposure, footprint,
        vec3(1, 0.7, 1).mul(surface.flatness).mul(surface.reliefScale)).mul(boundary));
    });
    return value;
  })();
  const drift = createSnowDriftNodes({ point: p, snow, footprint, sun,
    weight: surface.flatness.mul(surface.compressed.oneMinus()).mul(smoothstep(0, 48, edge)) });
  return {
    color(base) {
      const toned = base.mul(float(1).add(relief.x.div(0.06).clamp(-1, 1).mul(settings.toneContrast).mul(snow)));
      return mix(toned, toned.mul(snowLightUniforms.shadeTint.pow(2)).mul(settings.driftShadow), drift.shadow.mul(snow));
    },
    /** Sky light in a drift's shade: the sun's colour cannot reach it, and lit by that alone the shade reads as sand. */
    shade: snowLightUniforms.shadeTint.mul(DRIFT_SKY_LIGHT).mul(drift.shadow).mul(snow).mul(skyLightUniforms.brightness),
    roughness(base) {
      // Wind-packed crests are smoother than the loose snow in their troughs.
      return base.sub(relief.x.div(0.06).clamp(-1, 1).mul(0.06).mul(snow));
    },
    normal(base) {
      const fine = relief.yz.mul(settings.fineNormal);
      const slope = cameraViewMatrix.mul(vec4(fine.x.add(drift.slope.x).negate(), 0,
        fine.y.add(drift.slope.y).negate(), 0)).xyz;
      const lean = sun ? cameraViewMatrix.mul(vec4(sun.xz.x, 0, sun.xz.y, 0)).xyz
        .mul(sun.y.smoothstep(0.02, 0.1).mul(sun.y.smoothstep(0.2, 0.55).oneMinus()).mul(settings.lowSunWrap)) : vec3(0);
      return normalize(base.add(slope.add(lean).mul(snow)));
    },
  };
}
