import {
  abs, attribute, clamp, color, exp, float, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float,
  normalize, positionWorld, pow, refract, sin, smoothstep, texture, vec3, vec4,
} from 'three/tsl';
import {
  bakedShade, bumpNormal, createLocationMaterial, geometryNormal, shadeSurface, triplanarNormal, triplanarSample,
  triplanarWeights, viewDirection,
} from './LocationShading.js';
import { stoneSurface } from './StoneSurface.js';

/**
 * Glacier ice.
 *
 * Opaque by design: a refraction pass would copy the whole frame (CLAUDE.md, QA
 * and performance). The depth is instead built from three things that are each
 * physically motivated:
 *
 *  - **Absorption.** Ice takes red out of light within a metre and passes blue
 *    for tens of metres. The bake has already run every light through the ice
 *    volume with that rule (`gen/LightBake.js`), so a thin wall in front of
 *    daylight arrives here glowing cyan and a deep one arrives dark blue.
 *  - **Thickness.** `bakeShade.y` is the metres of solid behind the surface.
 *    Thin edges, fins and icicles take the pale colour; the glacier body takes
 *    the deep one.
 *  - **Interior structure.** Fractures, crack plates and bubbles are sampled
 *    along the *refracted* view ray at several depths and dimmed by the same
 *    absorption, so they slide behind the surface as the camera moves and the
 *    far ones are bluer — they read as inside the ice, not printed on it.
 *
 * One shader serves every family: a profile (`iceProfiles` in
 * `config/instanced-locations.yaml`) sets the base amounts, and the vertex masks
 * push a region of a wall toward another family.
 *
 *   surfMask   x rock   y snow   z frost   w fracture
 *   surfMask2  x sediment   y bubbles
 */

const LAYER_DEPTHS = [0.12, 0.45, 1.3, 2.6];
const ICE_IOR = 1.31;

/**
 * @param {string} name
 * @param {object} options
 * @param {object} options.profile resolved `iceProfiles` entry
 * @param {{ ice: object, snow: object, rock?: object }} options.maps texture sets
 * @param {object} [options.stoneProfile] bedrock / moraine layer blended in by `surfMask.x`
 * @param {number} [options.layers] interior samples along the view ray (quality)
 * @param {boolean} [options.masked] whether the mesh carries the vertex masks
 */
export function createGlacierIceMaterial(name, { profile, maps, stoneProfile = null, layers = 3, masked = true }) {
  const point = positionWorld;
  const mask = masked ? attribute('surfMask', 'vec4') : vec4(0);
  const mask2 = masked ? attribute('surfMask2', 'vec4') : vec4(0);
  const fracture = clamp(mask.w.add(profile.fracture), 0, 1);
  const sediment = clamp(mask2.x.add(profile.sediment), 0, 1);
  const bubbles = clamp(mask2.y.add(profile.bubbles), 0, 1);
  const frostAmount = clamp(mask.z.add(profile.frost), 0, 1);
  const snowAmount = clamp(mask.y.add(profile.snow), 0, 1);

  const weights = triplanarWeights(geometryNormal);
  // Melt scallops: the cupped relief wind and meltwater leave on cave ice.
  const scallop = mx_worley_noise_float(point.mul(profile.scallop.scale));
  const cupped = bumpNormal(geometryNormal, scallop.mul(profile.scallop.depth), 1);
  let normal = triplanarNormal(maps.ice.normal, point, cupped, weights, 0.21, profile.microNormal);

  const into = refract(viewDirection.negate(), normal, 1 / ICE_IOR);
  const absorption = vec3(...profile.absorption);
  let interior = vec3(0);
  const count = Math.min(layers, LAYER_DEPTHS.length);
  for (let index = 0; index < count; index += 1) {
    const depth = LAYER_DEPTHS[index];
    const inside = point.add(into.mul(depth));
    // In and back out again.
    const through = exp(absorption.mul(-2 * depth));
    // The crack network shows only in patches, strongest where the ice is fractured.
    const plates = triplanarSample(maps.ice.color, inside, weights, 0.06 * (1 + index * 0.45)).g;
    const patch = smoothstep(0.25, 0.7, mx_noise_float(inside.mul(0.16).add(index * 5.3))).mul(0.12).add(fracture.mul(fracture).mul(1.6));
    let glint = smoothstep(0.62, 0.98, plates).mul(profile.crackGain).mul(patch);
    // Fracture planes: the zero set of a slow noise is a few curved sheets, not a net —
    // but only if most of them are culled, so a second field keeps one in several.
    const sheet = pow(abs(mx_noise_float(inside.mul(0.22 + index * 0.09).add(index * 17.1))).oneMinus(), 48)
      .mul(smoothstep(0.1, 0.5, mx_noise_float(inside.mul(0.11).add(31.7 + index * 3.1))));
    glint = glint.add(sheet.mul(fracture).mul(1.8));
    if (index < 2) glint = glint.add(smoothstep(0.6, 0.9, mx_noise_float(inside.mul(27))).mul(bubbles).mul(1.3));
    interior = interior.add(through.mul(glint).mul(1 / count));
  }

  const deepPoint = point.add(into.mul(0.6));
  const milk = smoothstep(0.3, 0.8, mx_fractal_noise_float(deepPoint.mul(0.33), 3, 2, 0.5).mul(0.5).add(0.5))
    .mul(profile.cloud);
  // Annual layers: compressed firn alternates clear blue and white bubbly bands, tilted by glacier flow.
  const phase = deepPoint.y.mul(profile.banding.frequency).add(mx_noise_float(deepPoint.mul(0.17)).mul(5))
    .add(deepPoint.x.mul(profile.banding.dip));
  // Two beat frequencies and a slow fade keep the layers from reading as stripes.
  const band = smoothstep(-0.3, 1, sin(phase).mul(0.65).add(sin(phase.mul(0.43).add(2.1)).mul(0.35)))
    .mul(smoothstep(-0.4, 0.5, mx_noise_float(deepPoint.mul(0.07)))).mul(profile.banding.strength);
  const dirt = smoothstep(0.84, 0.98, sin(phase.mul(0.37).add(1.7))).mul(sediment.mul(1.5).min(1))
    .add(smoothstep(0.55, 0.85, mx_noise_float(deepPoint.mul(8))).mul(sediment).mul(0.6));

  const thickness = bakedShade.y;
  const depthTone = float(1).sub(exp(thickness.mul(-profile.depthRate)));
  let albedo = mix(color(profile.thinColor), color(profile.deepColor), depthTone);
  albedo = mix(albedo, color(profile.milkColor), clamp(milk.mul(0.7).add(band.mul(0.45)).add(bubbles.mul(0.3)), 0, 1));
  albedo = mix(albedo, color(profile.sedimentColor), clamp(dirt, 0, 1));
  albedo = albedo.add(color(profile.scatterColor).mul(interior));
  // The photographed roughness is a crack web; at full strength every highlight draws it.
  let roughness = float(profile.roughness).mul(triplanarSample(maps.ice.rough, point, weights, 0.11).g.mul(0.3).add(0.85))
    .add(mx_noise_float(point.mul(0.4)).mul(0.05)).add(milk.mul(0.2)).add(dirt.mul(0.3));
  let f0 = float(0.02);
  let wrap = float(0.9);

  if (stoneProfile && maps.rock) {
    const rock = stoneSurface(stoneProfile, maps.rock, null);
    const amount = smoothstep(0.42, 0.58, mask.x.add(mx_noise_float(point.mul(0.6)).mul(0.14)));
    albedo = mix(albedo, rock.albedo, amount);
    normal = normalize(mix(normal, rock.normal, amount));
    roughness = mix(roughness, rock.roughness, amount);
    f0 = mix(f0, rock.f0, amount);
    wrap = mix(wrap, float(0.15), amount);
  }

  const frostGrain = mx_fractal_noise_float(point.mul(0.9), 3, 2, 0.5).mul(0.5).add(0.5);
  const frost = smoothstep(0.2, 0.95, frostAmount.mul(1.3).add(frostGrain.mul(0.5)).sub(0.25))
    .mul(clamp(frostAmount.mul(4), 0, 1));
  albedo = mix(albedo, color(profile.frostColor), frost.mul(0.85));
  roughness = mix(roughness, float(0.8), frost);

  // Snow settles on what faces up, and drifts decide where it is deep enough to hide the ice.
  const drift = mx_noise_float(point.mul(0.7)).mul(0.5).add(0.5);
  const snow = smoothstep(0.42, 0.72, snowAmount.add(drift.sub(0.5).mul(0.5))).mul(smoothstep(0.25, 0.65, geometryNormal.y));
  const snowUv = point.xz.mul(0.4);
  const snowTilt = texture(maps.snow.normal, snowUv).xy.mul(2).sub(1);
  const sparkle = smoothstep(0.93, 1, mx_noise_float(point.mul(55).add(viewDirection.mul(6))));
  const snowAlbedo = texture(maps.snow.color, snowUv).rgb.mul(color(profile.snowColor)).mul(sparkle.mul(1.5).add(1));
  albedo = mix(albedo, snowAlbedo, snow);
  normal = normalize(mix(normal, normalize(geometryNormal.add(vec3(snowTilt.x, 0, snowTilt.y).mul(0.5))), snow));
  roughness = mix(roughness, float(0.92), snow);
  wrap = mix(wrap, float(0.6), snow);

  return createLocationMaterial(name, shadeSurface({ albedo, normal, roughness, f0, wrap }));
}
