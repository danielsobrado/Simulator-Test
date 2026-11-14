import {
  clamp, color, float, mix, mx_fractal_noise_float, mx_noise_float, normalize, smoothstep, texture, vec3,
} from 'three/tsl';
import { bumpNormal, geometryNormal, viewDirection } from '../LocationShading.js';

/** Snow texture repeats per metre. */
const SNOW_SCALE = 0.4;
/** Height of wind ridges in the snow, metres. */
const SASTRUGI_HEIGHT = 0.06;

/**
 * What lies on the ice: hoar frost and the white weathered crust of faces open
 * to the sky, then snow. Both are applied over an already shaded-ready surface
 * and return the same fields.
 *
 * Snow is kept from reading as paint by four things: it lies only where a
 * surface faces up and thins out along a noisy edge, wind cuts ridges into it,
 * it goes blue where the sky cannot reach, and single crystals flash as the
 * view moves.
 *
 * @param {{ albedo: Node, normal: Node, roughness: Node, wrap: Node, gloss: Node }} surface
 * @param {object} options
 * @param {Node} options.point world position
 * @param {object} options.profile resolved `iceProfiles` entry
 * @param {{ color: Texture, normal: Texture }} options.snowMaps
 * @param {Node} options.frost 0..1 frost amount (mask plus profile)
 * @param {Node} options.snow 0..1 snow amount (mask plus profile)
 * @param {Node} options.occlusion baked ambient occlusion, 1 in the open
 * @param {Node} options.sky 1 where the surface is open to the sky
 * @param {Node} options.near 1 close to the camera, 0 where fine detail would only shimmer
 */
export function iceCover(surface, { point, profile, snowMaps, frost, snow, occlusion, sky, near }) {
  let { albedo, normal, roughness, wrap, gloss } = surface;

  // Sun and wind turn exposed glacier ice white; blue shows in shelter, in breaks and underneath.
  const crust = smoothstep(0.5, 0.9, occlusion).mul(smoothstep(-0.35, 0.35, geometryNormal.y)).mul(sky).mul(profile.crust);
  const frostAmount = clamp(frost.add(crust), 0, 1);
  const grain = mx_fractal_noise_float(point.mul(0.9), 3, 2, 0.5).mul(0.5).add(0.5);
  const frosted = smoothstep(0.2, 0.95, frostAmount.mul(1.3).add(grain.mul(0.5)).sub(0.25))
    .mul(clamp(frostAmount.mul(4), 0, 1));
  const glitter = smoothstep(0.5, 0.75, mx_noise_float(point.mul(46).add(viewDirection.mul(5)))).mul(near);
  albedo = mix(albedo, color(profile.frostColor).mul(glitter.mul(0.3).add(1)), frosted.mul(0.85));
  roughness = mix(roughness, float(0.78), frosted);
  gloss = gloss.mul(frosted.oneMinus());

  const drift = mx_noise_float(point.mul(0.7)).mul(0.5).add(0.5);
  const lying = smoothstep(0.42, 0.72, snow.add(drift.sub(0.5).mul(0.5))).mul(smoothstep(0.25, 0.65, geometryNormal.y));
  // Sastrugi: ridges long down the wind and short across it.
  const [windX, windZ] = profile.wind;
  const down = point.x.mul(windX).add(point.z.mul(windZ)), cross = point.z.mul(windX).sub(point.x.mul(windZ));
  const ridges = mx_noise_float(vec3(cross.mul(1.5), down.mul(0.22), point.y.mul(0.4)))
    .add(mx_noise_float(vec3(cross.mul(4.1), down.mul(0.7), 3.3)).mul(0.35));
  const uv = point.xz.mul(SNOW_SCALE);
  const tilt = texture(snowMaps.normal, uv).xy.mul(2).sub(1);
  const snowNormal = normalize(bumpNormal(geometryNormal, ridges.mul(SASTRUGI_HEIGHT), 1).add(vec3(tilt.x, 0, tilt.y).mul(0.45)));
  const sparkle = smoothstep(0.62, 0.8, mx_noise_float(point.mul(55).add(viewDirection.mul(6)))).mul(near);
  const snowAlbedo = texture(snowMaps.color, uv).rgb.mul(color(profile.snowColor))
    .mul(mix(color(profile.snowShade), vec3(1), occlusion)).mul(sparkle.mul(1.4).add(1));

  return {
    albedo: mix(albedo, snowAlbedo, lying),
    normal: normalize(mix(normal, snowNormal, lying)),
    roughness: mix(roughness, float(0.92), lying),
    wrap: mix(wrap, float(0.6), lying),
    gloss: gloss.mul(lying.oneMinus()),
  };
}
