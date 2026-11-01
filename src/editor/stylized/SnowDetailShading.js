import {
  Fn, If, cameraViewMatrix, cameraWorldMatrix, color, float, length, max, mix, normalize, smoothstep, vec2, vec3, vec4,
} from 'three/tsl';
import { acquireSnowTextures } from '../assets/godsEnd/snowTextures.js';
import { repeatMipTextureLoad } from './RepeatMipTextureLoad.js';
import { createSnowReliefNodes } from './SnowReliefShading.js';
import { resolveSnowSurfaceConfig } from './SnowSurfaceConfig.js';
import { createSnowSurfaceState, snowSurfacePoint } from './SnowSurfaceState.js';

/** Snow007C's centered detail response, adapted to streamed terrain normals. */
export function createSnowDetailNodes({ terrainUv, chunkWorldSize, chunkCenter, snow, material, groundHeight = float(0),
  pathMask = float(0), baseNormal = null, reliefEnabled = false, settings = resolveSnowSurfaceConfig(), sun = null }) {
  const maps = acquireSnowTextures();
  if (!maps) return null;
  const dispose = () => {
    maps.release();
    material.removeEventListener('dispose', dispose);
  };
  material.addEventListener('dispose', dispose);
  // Power-of-two metre periods keep the origin exact and close across chunks.
  // This is detail only: terrain classification and the deformation field stay authoritative.
  const local = vec2(terrainUv.x.sub(0.5), float(0.5).sub(terrainUv.y)).mul(chunkWorldSize);
  const point = chunkCenter.mod(8).add(local).mul(0.125);
  const dx = point.dFdx().toVar('snowDetailDx');
  const dy = point.dFdy().toVar('snowDetailDy');
  const amount = snow.mul(maps.ready).clamp(0, 1);
  const worldBase = baseNormal ? normalize(cameraWorldMatrix.mul(vec4(baseNormal, 0)).xyz).toVar() : vec3(0, 1, 0);
  const state = createSnowSurfaceState({ point: snowSurfacePoint(local, chunkCenter), snow, pathMask,
    worldNormal: worldBase, settings });
  const relief = reliefEnabled ? createSnowReliefNodes({ local, chunkCenter, snow, pathMask, worldNormal: worldBase,
    settings, state, sun }) : null;
  const planar = smoothstep(0.45, 0.8, worldBase.y);
  const broadFade = smoothstep(0.1, 0.7, max(length(dx), length(dy)).mul(8)).oneMinus();
  const detail = Fn(() => {
    const result = vec4(1, 1, 1, 0).toVar();
    If(amount.greaterThan(0.002).and(broadFade.greaterThanEqual(0)).and(planar.greaterThanEqual(0)), () => {
      const pigment = repeatMipTextureLoad(maps.color, point, dx, dy).rgb.div(vec3(0.629, 0.737, 0.849)).clamp(0.75, 1.25);
      const packed = repeatMipTextureLoad(maps.packed, point, dx, dy);
      const hollow = packed.b.sub(0.274).mul(2.5).add(1).clamp(0.25, 1.2);
      const cavity = mix(float(1), packed.r.div(0.944).mul(hollow),
        state.detailScale.mul(settings.cavityStrength).mul(planar).mul(broadFade));
      const tint = mix(vec3(1), vec3(0.55, 0.72, 1), cavity.oneMinus().max(0).mul(0.7));
      result.assign(vec4(mix(vec3(1), pigment, state.detailScale.mul(settings.cavityStrength).mul(planar).mul(broadFade)).mul(cavity).mul(tint),
        packed.g.sub(0.714).mul(0.3).mul(state.detailScale).mul(broadFade)));
    });
    return result;
  })();
  const weights = worldBase.abs().pow(4);
  const blend = weights.div(weights.x.add(weights.y).add(weights.z).max(0.001));
  const steep = smoothstep(0.2, 0.55, worldBase.y.oneMinus()).toVar();
  // Keep height continuous before taking derivatives; the texture load wraps it.
  const point3 = vec3(point.x, groundHeight.mul(0.125), point.y);
  const xyDx = point3.xy.dFdx().toVar(), xyDy = point3.xy.dFdy().toVar();
  const zyDx = point3.zy.dFdx().toVar(), zyDy = point3.zy.dFdy().toVar();
  const slope = Fn(() => {
    const result = vec3(0).toVar();
    If(amount.greaterThan(0.002).and(steep.greaterThanEqual(0)).and(dx.x.equal(dx.x)).and(dy.x.equal(dy.x))
      .and(xyDx.x.equal(xyDx.x)).and(xyDy.x.equal(xyDy.x)).and(zyDx.x.equal(zyDx.x)).and(zyDy.x.equal(zyDy.x)), () => {
      let combined = vec2(0);
      for (const [frequency, strength] of (reliefEnabled ? [[4, 1.6], [1, 0.65], [0.25, 0.28]] : [[1, 1.6]])) {
        const sample = repeatMipTextureLoad(maps.normal, point.mul(frequency), dx.mul(frequency), dy.mul(frequency));
        const normal = sample.xyz.mul(2).sub(1);
        const fade = smoothstep(0.35, 0.9, max(length(dx), length(dy)).mul(frequency)).oneMinus();
        combined = combined.add(normal.xy.div(normal.z.max(0.15)).mul(strength).mul(fade));
      }
      const offset = vec3(combined.x, 0, combined.y).toVar();
      if (reliefEnabled && baseNormal) {
        const normalSlope = (p, ddx, ddy) => {
          const n = repeatMipTextureLoad(maps.normal, p.mul(4), ddx.mul(4), ddy.mul(4)).xyz.mul(2).sub(1);
          return n.xy.div(n.z.max(0.15)).mul(1.6);
        };
        If(steep.greaterThan(0.01), () => {
          const xy = normalSlope(point3.xy, xyDx, xyDy);
          const zy = normalSlope(point3.zy, zyDx, zyDy);
          const triplanar = offset.mul(blend.y).add(vec3(xy.x, xy.y, 0).mul(blend.z))
            .add(vec3(0, zy.y, zy.x).mul(blend.x));
          offset.assign(mix(offset, triplanar, steep));
        });
      }
      // Project the detail onto the real surface tangent plane, preserving its tilt.
      result.assign(offset.sub(worldBase.mul(offset.dot(worldBase))).mul(state.detailScale).mul(settings.fineNormal));
    });
    return result;
  })();
  return {
    shade: relief?.shade ?? vec3(0),
    color(base) {
      const value = base.mul(mix(vec3(1), detail.rgb, amount));
      return mix(relief ? relief.color(value) : value, color(settings.pathColor), state.compressed.mul(snow));
    },
    roughness(base) {
      const value = mix(base, float(settings.baseRoughness), snow).add(detail.a.mul(amount));
      return mix(relief ? relief.roughness(value) : value, float(settings.compactedRoughness), state.compressed.mul(snow)).clamp(0, 1);
    },
    normal(base) {
      const offset = cameraViewMatrix.mul(vec4(slope, 0)).xyz;
      const value = normalize(base.add(offset.mul(amount)));
      return relief ? relief.normal(value) : value;
    },
  };
}
