import {
  attribute, cameraPosition, clamp, color, dot, exp, float, length, mix, mx_fractal_noise_float, mx_noise_float,
  mx_worley_noise_float, normalize, positionWorld, pow, refract, smoothstep, vec3, vec4,
} from 'three/tsl';
import { iceCover } from './ice/IceCover.js';
import { iceInterior } from './ice/IceInterior.js';
import { iceStrata } from './ice/IceStrata.js';
import {
  bakedShade, bumpNormal, createLocationMaterial, geometryNormal, locationLight, shadeSurface, triplanarNormal,
  triplanarSample, triplanarWeights, viewDirection,
} from './LocationShading.js';
import { stoneSurface } from './StoneSurface.js';

/**
 * Glacier ice.
 *
 * Opaque by design: a refraction pass would copy the whole frame (CLAUDE.md, QA
 * and performance). The depth is instead built from things that are each
 * physically motivated:
 *
 *  - **Absorption.** Ice takes red out of light within a metre and passes blue
 *    for tens of metres. The bake has already run every light through the ice
 *    volume with that rule (`gen/LightBake.js`), so a thin wall in front of
 *    daylight arrives here glowing cyan and a deep one arrives dark blue. The
 *    body colour applies the same law to the light's path inside the ice.
 *  - **Path length.** `bakeShade.y` is the metres of solid behind the surface.
 *    Bubbles and cloud turn light round early, and a glancing view skims the
 *    surface, so white ice, thin fins and silhouettes stay pale while clear
 *    thick ice goes deep blue.
 *  - **Strata.** `ice/IceStrata.js`: the layers the glacier is made of, sampled
 *    behind the scalloped surface so they bend as through thick glass.
 *  - **Interior structure.** `ice/IceInterior.js`: cracks and bubbles on the
 *    refracted view ray, dimmed by the ice in front of them.
 *
 * One shader serves every family: a profile (`iceProfiles` in
 * `config/instanced-locations.yaml`) sets the base amounts, and the vertex masks
 * push a region of a wall toward another family.
 *
 *   surfMask   x rock   y snow   z frost   w fracture
 *   surfMask2  x sediment   y bubbles   z polish (melt-smoothed, wet)   w trail (snow packed by feet and runners)
 */

const ICE_IOR = 1.31;
/** How far behind the surface strata and cloud are read, metres. */
const STRATA_DEPTH = 0.5;
/** Light path through ice that has no thickness to speak of, metres. */
const MIN_PATH = 0.35;
/** Dirt layers every glacier carries even where it looks clean. */
const ASH_TRACE = 0.1;
/** How much longer light's path is in a crevice than on an open face: recesses go a deeper blue. */
const CREVICE_DEPTH = 1.5;
/** Per-metre rate at which ice stops glowing with the light behind it. */
const THIN_FALLOFF = 1.4;

/**
 * @param {string} name
 * @param {object} options
 * @param {object} options.profile resolved `iceProfiles` entry
 * @param {{ ice: object, cracks: object, snow: object, rock?: object }} options.maps texture sets
 * @param {object} [options.stoneProfile] bedrock / moraine layer blended in by `surfMask.x`
 * @param {number} [options.layers] interior samples along the view ray (quality)
 * @param {boolean} [options.masked] whether the mesh carries the vertex masks
 */
export function createGlacierIceMaterial(name, { profile, maps, stoneProfile = null, layers = 3, masked = true }) {
  const point = positionWorld;
  const mask = masked ? attribute('surfMask', 'vec4') : vec4(0);
  const mask2 = masked ? attribute('surfMask2', 'vec4') : vec4(0);
  const amount = (channel, base) => clamp(channel.add(base), 0, 1);
  const fracture = amount(mask.w, profile.fracture), sediment = amount(mask2.x, profile.sediment);
  const bubbles = amount(mask2.y, profile.bubbles), polish = amount(mask2.z, profile.polish);
  const occlusion = bakedShade.x, thickness = bakedShade.y, sky = bakedShade.z;
  const [detailNear, detailFar] = profile.detailRange;
  const near = smoothstep(detailFar, detailNear, length(cameraPosition.sub(point)));
  const weights = triplanarWeights(geometryNormal);

  // Melt scallops: the cupped relief moving air and meltwater leave on ice. Floors stay flat underfoot.
  const scallop = mx_worley_noise_float(point.mul(profile.scallop.scale));
  const walls = smoothstep(0.9, 0.55, geometryNormal.y);
  const cupped = bumpNormal(geometryNormal, scallop.mul(profile.scallop.depth).mul(walls), 1);
  let normal = triplanarNormal(maps.ice.normal, point, cupped, weights, 0.21, polish.oneMinus().mul(profile.microNormal));

  const into = refract(viewDirection.negate(), normal, 1 / ICE_IOR);
  const absorption = vec3(...profile.absorption);
  const deepPoint = point.add(into.mul(STRATA_DEPTH));
  const strata = iceStrata(deepPoint, profile.banding);
  // Cloud lies along the layers: wide and shallow, never a round blot.
  const cloud = smoothstep(-0.15, 0.45, mx_fractal_noise_float(deepPoint.mul(vec3(0.3, 0.8, 0.3)), 3, 2, 0.5)).mul(profile.cloud);
  const banded = strata.white.add(strata.laminae.mul(near).mul(0.2)).mul(profile.banding.strength);
  const whiteness = clamp(cloud.mul(0.6).add(banded).add(bubbles.mul(0.3)), 0, 1);

  const rim = pow(float(1).sub(clamp(dot(normal, viewDirection), 0, 1)), 3);
  const path = thickness.mul(profile.depthRate).mul(whiteness.mul(0.8).oneMinus()).mul(rim.mul(0.6).oneMinus())
    .mul(occlusion.oneMinus().mul(CREVICE_DEPTH).add(1)).add(MIN_PATH);
  const transmit = exp(absorption.mul(path).negate());
  let albedo = mix(color(profile.thinColor).mul(transmit), color(profile.deepColor), transmit.g.oneMinus().mul(0.6));
  albedo = mix(albedo, color(profile.milkColor), whiteness.mul(0.6));
  // Grit rides in the dirt layers, fine enough to read as silt and not as spots.
  const grit = smoothstep(0.3, 0.55, mx_noise_float(deepPoint.mul(23))).mul(strata.ash.mul(0.7).add(0.3)).mul(near);
  const dirt = clamp(strata.ash.mul(sediment.mul(1.6).add(ASH_TRACE)).add(grit.mul(sediment).mul(0.32)), 0, 1);
  albedo = mix(albedo, color(profile.sedimentColor), dirt);
  const interior = iceInterior({
    point, into, weights, cracks: maps.cracks, absorption, layers, crackGain: profile.crackGain, fracture, bubbles,
  });
  albedo = albedo.add(color(profile.scatterColor).mul(interior).mul(near));

  // The photographed roughness is a crack web; at full strength every highlight draws it.
  let roughness = float(profile.roughness).mul(triplanarSample(maps.ice.rough, point, weights, 0.11).g.mul(0.3).add(0.85))
    .add(mx_noise_float(point.mul(0.4)).mul(0.05)).add(whiteness.mul(0.18)).add(dirt.mul(0.3));
  roughness = mix(roughness, float(0.05), polish);
  let f0 = float(0.02);
  let wrap = float(0.9);
  let gloss = float(profile.gloss);

  if (stoneProfile && maps.rock) {
    const rock = stoneSurface(stoneProfile, maps.rock, null);
    const share = smoothstep(0.42, 0.58, mask.x.add(mx_noise_float(point.mul(0.6)).mul(0.14)));
    albedo = mix(albedo, rock.albedo, share);
    normal = normalize(mix(normal, rock.normal, share));
    roughness = mix(roughness, rock.roughness, share);
    f0 = mix(f0, rock.f0, share);
    wrap = mix(wrap, float(0.15), share);
    gloss = gloss.mul(share.oneMinus());
  }

  const covered = iceCover({ albedo, normal, roughness, wrap, gloss }, {
    point, profile, snowMaps: maps.snow, frost: amount(mask.z, profile.frost),
    // Snow drifts where a generator put it, and falls wherever the sky can see.
    snow: amount(mask.y.add(sky.mul(profile.snowfall)), profile.snow), trail: mask2.w, occlusion, sky, near,
  });
  // Thin ice is lit from all round: an icicle or a fin glows against the wall behind it.
  // `gloss` has been cut wherever rock, frost or snow covers the ice, so its ratio is the share left bare.
  const bare = covered.gloss.div(Math.max(profile.gloss, 0.01));
  const through = covered.albedo.mul(locationLight.ambientUp.add(locationLight.ambientDown))
    .mul(exp(thickness.mul(-THIN_FALLOFF))).mul(bare).mul(profile.translucency);
  return createLocationMaterial(name, shadeSurface({
    albedo: covered.albedo, normal: covered.normal, roughness: clamp(covered.roughness, 0.04, 1), f0,
    wrap: covered.wrap, sheen: covered.gloss, emissive: through,
  }));
}
