import {
  abs, attribute, clamp, color, float, floor, fract, hash, length, max, min, mix, mod, mx_noise_float, normalize,
  positionWorld, pow, sin, smoothstep, texture, uv, vec2, vec3,
} from 'three/tsl';
import {
  applyGeologicalVariation, applyLocalizedWetness, applyMineGround, evaluateGeologicalStrataMask, safePow,
} from './GeologicalSurface.js';
import {
  bakedShade, bumpNormal, createLocationMaterial, geometryNormal, shadeSurface, triplanarNormal, triplanarSample,
  triplanarWeights,
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
 * @param {Node|null} mask2 optional `surfMask2` vertex attribute for geological/floor variation
 */
export function stoneSurface(profile, maps, mask = null, mask2 = null) {
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
  if (!profile.water && !(profile.metalness > 0.2) && (profile.roughness ?? 1) >= 0.75) {
    roughness = max(roughness, float(Math.max(0.72, (profile.roughness ?? 1) * 0.78)));
  }
  let f0 = float(profile.f0 ?? 0.04);
  let metalness = float(profile.metalness ?? 0);
  let emissive = vec3(0);
  let wrap = float(profile.wrap ?? 0.12);

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
    const strataScale = profile.geology
      ? evaluateGeologicalStrataMask(point, mask2 ? mask2.x : macro, profile.geology)
      : float(1);
    const strataTint = mix(color(profile.strata.dark), color(profile.strata.light), bed);
    albedo = albedo.mul(mix(vec3(1), strataTint, clamp(strataScale, 0.15, 1)));
    normal = bumpNormal(normal, bed.mul(0.03).mul(strataScale), profile.strata.relief ?? 1);
  }

  if (profile.geology) {
    const varied = applyGeologicalVariation({
      point, albedo, normal, roughness, f0, detailAlbedo, macro, midPatch, grainMix,
      mask, mask2, profile, maps, weights,
    });
    albedo = varied.albedo;
    normal = varied.normal;
    roughness = varied.roughness;
    f0 = varied.f0;
  }

  if (profile.ground) {
    const ground = applyMineGround({
      point, albedo, normal, roughness, f0, detailAlbedo, macro, midPatch, grainMix,
      mask, mask2, profile, maps, weights,
    });
    albedo = ground.albedo;
    normal = ground.normal;
    roughness = ground.roughness;
    f0 = ground.f0;
  } else if (maps.floor) {
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

  if (profile.water) {
    // Subterranean still pool: organic multi-scale surface ripples over dark mineral depths.
    const r1 = mx_noise_float(vec3(point.x.mul(1.8), point.z.mul(1.8), point.x.add(point.z).mul(0.35)));
    const r2 = mx_noise_float(vec3(point.x.mul(4.6), point.z.mul(4.6), point.x.sub(point.z).mul(0.6)));
    normal = bumpNormal(geometryNormal, r1.mul(0.016).add(r2.mul(0.008)), float(0.8));
    albedo = color(profile.tint).mul(mix(float(0.6), float(1.1), r1.mul(0.5).add(0.5)));
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
      const warp = mx_noise_float(point.mul(profile.vein.scale * 0.35)).mul(1.25);
      const line = safePow(abs(mx_noise_float(point.mul(profile.vein.scale).add(warp))).oneMinus(), profile.vein.sharpness ?? 12);
      const pocket = smoothstep(0.38, 0.78, detailAlbedo.g.mul(0.6).add(grainMix.mul(0.4))).mul(smoothstep(0.28, 0.72, midPatch));
      const vein = smoothstep(0.28, 0.75, line.mul(mask.x.mul(1.4)).mul(pocket));
      const veinGain = float(profile.vein.gain ?? 1.85);
      const veinStrength = float(profile.vein.strength ?? 0.75);
      albedo = mix(albedo, albedo.mul(color(profile.vein.color)).mul(veinGain), vein.mul(veinStrength));
      roughness = mix(roughness, float(profile.vein.roughness ?? 0.3), vein);
      f0 = mix(f0, float(profile.vein.f0 ?? 0.5), vein);
      emissive = color(profile.vein.color).mul(vein).mul(profile.vein.glow ?? 0);
    }
    if (profile.geology || profile.wetness) {
      const wet = applyLocalizedWetness({
        albedo, roughness, f0, macro, midPatch, mask, profile,
      });
      albedo = wet.albedo;
      roughness = wet.roughness;
      f0 = wet.f0;
    } else {
      const damp = mask.y.mul(smoothstep(0.25, 0.75, macro.add(mask.y.mul(0.45))));
      albedo = albedo.mul(mix(float(1), float(0.68), damp));
      roughness = mix(roughness, float(0.42), damp);
    }
    if (!profile.geology) {
      albedo = albedo.mul(mix(vec3(1), color(profile.sootColor ?? '#1a1512'), mask.z.mul(0.85)));
      roughness = mix(roughness, roughness.mul(profile.dressedRoughness ?? 0.8), dressed);
    }
  }
  if (profile.woodGrain) {
    // Directional timber grain along member UVs (V = longitudinal axis) with end-grain rings and damp/edge wear.
    const woodMask = attribute('woodMask', 'vec4');
    const woodUv = uv();
    const hasWoodUv = woodMask.w;
    const endMask = clamp(woodMask.x, 0, 1);
    const dampMask = clamp(woodMask.y, 0, 1);
    const edgeWear = clamp(woodMask.z, 0, 1);

    const sideAlbedo = texture(maps.color, woodUv).rgb.mul(color(profile.tint));
    const sideDetail = texture(maps.color, woodUv.mul(2.35).add(vec2(0.31, 0.73))).rgb;
    const sideRough = clamp(texture(maps.rough, woodUv).g.mul(profile.roughness ?? 0.88), 0.76, 0.98);
    const sideNorm = texture(maps.normal, woodUv).xy.mul(2).sub(1);
    const sideHeight = sideAlbedo.g.mul(0.55).add(sideDetail.g.mul(0.25)).add(sideNorm.x.mul(0.22)).mul(0.024);

    // Saw-cut end-grain: concentric growth rings + radial checking from cross-section UV centered at (0.5, 0.5).
    const ringCoord = woodUv.sub(0.5);
    const radialDist = length(ringCoord);
    const ringDir = ringCoord.div(max(radialDist, float(1e-4)));
    const ringWarp = mx_noise_float(vec3(woodUv.mul(5.2), 1.7)).mul(1.4);
    const growthRings = sin(radialDist.mul(28.0).add(ringWarp)).mul(0.5).add(0.5);
    const radialCheck = pow(abs(mx_noise_float(vec3(ringDir.mul(5.8), radialDist.mul(1.8)))).oneMinus(), 5.0);
    const endTone = color(profile.tint).mul(mix(float(0.54), float(0.84), growthRings))
      .mul(mix(float(1.0), float(0.45), radialCheck.mul(0.75)));
    const endHeight = growthRings.mul(0.014).sub(radialCheck.mul(0.022));

    let woodAlbedo = mix(sideAlbedo.mul(mix(float(0.88), float(1.12), sideDetail.g)), endTone, endMask);
    woodAlbedo = woodAlbedo.mul(mix(float(0.9), float(1.08), macro));
    woodAlbedo = woodAlbedo.mul(mix(float(1.0), float(1.14), edgeWear.mul(0.7)));
    woodAlbedo = woodAlbedo.mul(mix(float(1.0), float(0.56), dampMask));

    const woodHeight = mix(sideHeight, endHeight, endMask);
    const woodNormal = bumpNormal(geometryNormal, woodHeight, float(profile.normalStrength ?? 1).mul(1.45));
    let woodRough = mix(sideRough, float(0.94), endMask);
    woodRough = mix(woodRough, float(0.62), dampMask.mul(0.68));
    woodRough = woodRough.mul(mix(float(1.0), float(0.92), edgeWear.mul(0.6)));

    albedo = mix(albedo, woodAlbedo, hasWoodUv);
    normal = normalize(mix(normal, woodNormal, hasWoodUv));
    roughness = mix(roughness, woodRough, hasWoodUv);
  }
  if (profile.vertexTint) albedo = albedo.mul(attribute('tint', 'vec3'));

  if (profile.snow) {
    // Snow lies on what faces a sky it can fall from: ledges, roof pitches, the tops of logs and stones.
    const settle = mx_noise_float(point.mul(1.3)).mul(0.22);
    const lying = smoothstep(profile.snow.from, profile.snow.from + 0.35, geometryNormal.y.add(settle))
      .mul(bakedShade.z).mul(profile.snow.amount);
    albedo = mix(albedo, color(profile.snow.color).mul(mx_noise_float(point.mul(9)).mul(0.04).add(1)), lying);
    normal = normalize(mix(normal, geometryNormal, lying.mul(0.8)));
    roughness = mix(roughness, float(0.9), lying);
    f0 = mix(f0, float(0.02), lying);
    metalness = metalness.mul(lying.oneMinus());
    wrap = mix(wrap, float(0.6), lying);
  }

  return { albedo, normal, roughness, f0, metalness, emissive, wrap };
}

/** @returns {MeshBasicNodeMaterial} a stone-family material for a location mesh */
export function createStoneMaterial(name, profile, maps, { masked = true } = {}) {
  const surface = stoneSurface(
    profile,
    maps,
    masked ? attribute('surfMask', 'vec4') : null,
    masked ? attribute('surfMask2', 'vec4') : null,
  );
  return createLocationMaterial(name, shadeSurface(surface));
}
