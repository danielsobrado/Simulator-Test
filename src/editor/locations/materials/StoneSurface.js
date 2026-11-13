import {
  abs, attribute, clamp, color, float, floor, fract, hash, min, mix, mod, mx_noise_float, normalize, positionWorld,
  pow, sin, smoothstep, vec3,
} from 'three/tsl';
import {
  bumpNormal, createLocationMaterial, geometryNormal, shadeSurface, triplanarNormal, triplanarSample, triplanarWeights,
} from './LocationShading.js';

/**
 * Rock, masonry, timber and metal: one triplanar PBR layer whose character
 * comes from a profile (`config/instanced-locations.yaml`, `materialProfiles`).
 *
 * The optional vertex mask `surfMask` means, for every stone profile:
 *   x mineral vein or crystal   y damp   z soot / scorch   w dressed (tool-cut, coursed if the profile has masonry)
 */

const joint = (u, v, courseHeight, blockLength, width) => {
  const wobble = mx_noise_float(vec3(u, v, 1.7).mul(0.55)).mul(0.025);
  const chip = mx_noise_float(vec3(u, v, 5.3).mul(5.8));
  const wu = u.add(wobble).add(chip.mul(0.011));
  const wv = v.add(wobble.mul(0.7)).add(chip.mul(0.011));
  const row = floor(wv.div(courseHeight));
  const edgeWear = mx_noise_float(vec3(wu.mul(0.35), row.mul(1.7), 3.1));
  const run = wu.div(blockLength).add(mod(row, 2).mul(0.5)).add(hash(row.add(11.3)).sub(0.5).mul(0.35)).add(edgeWear.mul(0.18));
  const fu = fract(run), fv = fract(wv.div(courseHeight));
  const edge = min(min(fu, fu.oneMinus()).mul(blockLength), min(fv, fv.oneMinus()).mul(courseHeight));
  const id = hash(floor(run).add(row.mul(57.7)));
  const id2 = hash(floor(run).mul(19.3).add(row.mul(113.1)));

  const chip01 = chip.mul(0.5).add(0.5);
  const wear01 = edgeWear.mul(0.5).add(0.5);
  const jointW = float(width).mul(mix(float(0.68), float(1.28), chip01));
  const bevelW = float(width).mul(mix(float(1.4), float(3.1), wear01.mul(0.6).add(id2.mul(0.4))));

  const gap = smoothstep(float(0), jointW, edge).oneMinus();
  const bevelSlope = smoothstep(jointW.mul(0.45), jointW.add(bevelW), edge);
  const bevel = bevelSlope.mul(bevelSlope.oneMinus()).mul(4);
  const tilt = fu.sub(0.5).mul(id.sub(0.5)).mul(0.14).add(fv.sub(0.5).mul(id2.sub(0.5)).mul(0.14));
  const height = bevelSlope.mul(float(0.76).add(tilt).add(wear01.sub(0.5).mul(0.07)).add(chip.mul(0.03)));

  return { gap, bevel, height, id, id2 };
};

/** Coursed blocks on walls and staggered flagstones on floors: `{ gap, bevel, height, id, id2 }`. */
function masonry(point, weights, { courseHeight, blockLength, jointWidth }) {
  const x = joint(point.z, point.y, courseHeight, blockLength, jointWidth);
  const z = joint(point.x, point.y, courseHeight, blockLength, jointWidth);
  const y = joint(point.x, point.z, float(blockLength).mul(0.64), blockLength, jointWidth);
  return {
    gap: x.gap.mul(weights.x).add(y.gap.mul(weights.y)).add(z.gap.mul(weights.z)),
    bevel: x.bevel.mul(weights.x).add(y.bevel.mul(weights.y)).add(z.bevel.mul(weights.z)),
    height: x.height.mul(weights.x).add(y.height.mul(weights.y)).add(z.height.mul(weights.z)),
    id: x.id.mul(weights.x).add(y.id.mul(weights.y)).add(z.id.mul(weights.z)),
    id2: x.id2.mul(weights.x).add(y.id2.mul(weights.y)).add(z.id2.mul(weights.z)),
  };
}

/**
 * The stone layer as nodes, so the ice material can blend it in at moraine and bedrock.
 *
 * @param {object} profile a resolved `materialProfiles` entry
 * @param {{ color: Texture, normal: Texture, rough: Texture }} maps
 * @param {Node|null} mask the `surfMask` vertex attribute, or null for meshes without one
 */
export function stoneSurface(profile, maps, mask = null) {
  const point = positionWorld;
  const weights = triplanarWeights(geometryNormal);
  const scale = profile.scale;
  const dressed = mask ? mask.w : float(profile.masonry ? 1 : 0);
  const blocks = profile.masonry ? masonry(point, weights, profile.masonry) : null;
  const samplePoint = blocks
    ? point.add(vec3(blocks.id.mul(3.7), blocks.id2.mul(2.9), blocks.id.add(blocks.id2).mul(2.3)).mul(dressed))
    : point;

  let albedo = triplanarSample(maps.color, samplePoint, weights, scale).rgb.mul(color(profile.tint));
  const detailAlbedo = triplanarSample(maps.color, samplePoint.add(vec3(0.37, 0.71, 0.19)), weights, scale * 2.8).rgb;
  albedo = albedo.mul(mix(float(1), detailAlbedo.mul(1.16), float(0.36)));

  let normal = triplanarNormal(maps.normal, samplePoint, geometryNormal, weights, scale, profile.normalStrength ?? 1);
  let roughness = triplanarSample(maps.rough, samplePoint, weights, scale).g.mul(profile.roughness ?? 1);
  roughness = roughness.mul(mix(float(0.86), float(1.16), detailAlbedo.g));
  let f0 = float(profile.f0 ?? 0.04);
  const metalness = float(profile.metalness ?? 0);
  let emissive = vec3(0);

  // Multi-scale mineral variation so no stone wall repeats or reads as uniform gray.
  const macro = mx_noise_float(point.mul(0.085)).mul(0.5).add(0.5);
  const midPatch = mx_noise_float(point.mul(0.37).add(vec3(4.1, 1.7, 9.3))).mul(0.5).add(0.5);
  const grainMix = mx_noise_float(point.mul(1.85).add(vec3(2.3, 6.1, 0.8))).mul(0.5).add(0.5);
  albedo = albedo.mul(mix(float(0.8), float(1.13), macro));
  albedo = albedo.mul(mix(color('#c3c7d0'), color('#cfc6bc'), midPatch));
  albedo = albedo.mul(mix(float(0.94), float(1.06), grainMix));

  if (profile.strata) {
    const warp = mx_noise_float(point.mul(0.13)).mul(profile.strata.warp ?? 4);
    const band = sin(point.y.mul(profile.strata.frequency).add(warp).add(point.x.mul(profile.strata.dip ?? 0.15)));
    const bed = smoothstep(-0.2, 0.9, band);
    albedo = albedo.mul(mix(color(profile.strata.dark), color(profile.strata.light), bed));
    normal = bumpNormal(normal, bed.mul(0.03), profile.strata.relief ?? 1);
  }

  if (maps.floor) {
    const floorScale = float(profile.floorScale ?? 0.34);
    const floorMask = smoothstep(0.68, 0.92, geometryNormal.y).mul(smoothstep(-1.2, -0.2, point.y)).mul(dressed);
    const flColor = triplanarSample(maps.floor.color, point, weights, floorScale).rgb.mul(color(profile.floorTint ?? profile.tint));
    const flNormal = triplanarNormal(maps.floor.normal, point, geometryNormal, weights, floorScale, (profile.normalStrength ?? 1) * 1.15);
    const flRough = triplanarSample(maps.floor.rough, point, weights, floorScale).g.mul(profile.floorRoughness ?? 0.82);
    albedo = mix(albedo, flColor.mul(mix(float(0.86), float(1.12), macro)), floorMask);
    normal = normalize(mix(normal, flNormal, floorMask));
    roughness = mix(roughness, flRough, floorMask);
    if (profile.walkwayWear) {
      const centerPath = smoothstep(3.6, 2.75, abs(point.x)).mul(floorMask);
      const wear = centerPath.mul(mix(float(0.65), float(1), grainMix));
      albedo = albedo.mul(mix(float(1), float(0.84), wear.mul(0.6)));
      roughness = roughness.mul(mix(float(1), float(0.72), wear));
    }
  }

  if (blocks) {
    const cut = dressed.mul(blocks.gap);
    const bevelEdge = dressed.mul(blocks.bevel);
    const toolMarks = mx_noise_float(vec3(point.x.mul(14), point.y.mul(4.5), point.z.mul(14))).mul(0.5).add(0.5);
    const stoneTone = mix(color('#c6c8cc'), color('#b5b1ab'), blocks.id2).mul(mix(float(0.88), float(1.11), blocks.id));
    albedo = albedo.mul(mix(float(1), stoneTone, dressed));
    albedo = albedo.mul(mix(float(1), mix(float(0.94), float(1.05), toolMarks), dressed));
    albedo = albedo.mul(mix(float(1), float(1.1), bevelEdge.mul(0.7)));
    albedo = mix(albedo, albedo.mul(color('#353230')), cut.mul(0.66));
    const microHeight = blocks.height.add(toolMarks.sub(0.5).mul(0.06)).mul(0.032).mul(dressed);
    normal = bumpNormal(normal, microHeight, profile.masonry.relief ?? 1.6);
    roughness = roughness.mul(mix(float(1), mix(float(0.86), float(1.12), blocks.id2), dressed));
    roughness = roughness.mul(mix(float(1), float(0.84), bevelEdge.mul(0.65)));
    roughness = mix(roughness, float(0.95), cut);
  } else if (profile.chiselGrain) {
    // Dressed ashlar/carved stonework: fine chisel tooth + horizontal mason's tooling without fake brick cuts or moiré.
    const chisel = mx_noise_float(vec3(point.x.mul(3.6), point.y.mul(8.2), point.z.mul(3.6))).mul(0.5).add(0.5);
    const fineGrain = mx_noise_float(point.mul(6.8)).mul(0.5).add(0.5);
    albedo = albedo.mul(mix(float(0.94), float(1.06), chisel.mul(0.6).add(fineGrain.mul(0.4))));
    normal = bumpNormal(normal, chisel.mul(0.007).add(fineGrain.mul(0.005)), float(profile.chiselGrain));
    roughness = roughness.mul(mix(float(0.88), float(1.12), fineGrain));
  }

  if (profile.cavityShade) {
    // Undercuts, soffits, and upward ledges pick up natural environmental weathering contrast.
    const upward = clamp(geometryNormal.y.mul(0.5).add(0.5), 0, 1);
    albedo = albedo.mul(mix(float(0.76), float(1.06), upward));
    const ridgeWear = smoothstep(0.45, 0.85, geometryNormal.y).mul(grainMix);
    roughness = roughness.mul(mix(float(1), float(0.85), ridgeWear.mul(profile.cavityShade)));
  }

  if (profile.metalness > 0.2) {
    // Forged hammer pit variation & directional brushed tooling without high-frequency derivative aliasing.
    const hammer = mx_noise_float(point.mul(4.6)).mul(0.5).add(0.5);
    const brush = mx_noise_float(vec3(point.x.mul(7.2), point.y.mul(3.4), point.z.mul(7.2))).mul(0.5).add(0.5);
    normal = bumpNormal(normal, hammer.mul(0.007).add(brush.mul(0.003)), float(0.55));
    albedo = albedo.mul(mix(float(0.86), float(1.12), hammer));
    roughness = clamp(roughness.mul(mix(float(0.78), float(1.22), brush.mul(0.55).add(hammer.mul(0.45)))), 0.16, 0.92);
  }

  if (mask) {
    if (profile.vein) {
      const warp = mx_noise_float(point.mul(profile.vein.scale * 0.4)).mul(1.6);
      const line = pow(abs(mx_noise_float(point.mul(profile.vein.scale).add(warp))).oneMinus(), profile.vein.sharpness ?? 9);
      const vein = smoothstep(0.35, 0.8, line.mul(mask.x.mul(1.6)));
      albedo = mix(albedo, color(profile.vein.color), vein);
      roughness = mix(roughness, float(profile.vein.roughness ?? 0.3), vein);
      f0 = mix(f0, float(profile.vein.f0 ?? 0.5), vein);
      emissive = color(profile.vein.color).mul(vein).mul(profile.vein.glow ?? 0);
    }
    const damp = mask.y.mul(smoothstep(0.2, 0.7, macro.add(mask.y.mul(0.5))));
    albedo = albedo.mul(mix(float(1), float(0.55), damp));
    roughness = mix(roughness, float(0.18), damp);
    albedo = albedo.mul(mix(vec3(1), color(profile.sootColor ?? '#1a1512'), mask.z.mul(0.85)));
    roughness = mix(roughness, roughness.mul(profile.dressedRoughness ?? 0.8), dressed);
  }
  if (profile.vertexTint) albedo = albedo.mul(attribute('tint', 'vec3'));

  return { albedo, normal, roughness, f0, metalness, emissive };
}

/** @returns {MeshBasicNodeMaterial} a stone-family material for a location mesh */
export function createStoneMaterial(name, profile, maps, { masked = true } = {}) {
  const surface = stoneSurface(profile, maps, masked ? attribute('surfMask', 'vec4') : null);
  return createLocationMaterial(name, shadeSurface({ ...surface, wrap: profile.wrap ?? 0.12 }));
}
