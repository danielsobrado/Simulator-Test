import {
  abs, clamp, color, float, max, mix, mx_noise_float, mx_worley_noise_float, normalize, pow, smoothstep, vec3,
} from 'three/tsl';
import {
  bumpNormal, geometryNormal, triplanarNormal, triplanarSample,
} from './LocationShading.js';

/**
 * Reusable TSL geological variation, rock-to-rock blending, ground-family
 * blending, wall-to-floor transitions, and restrained wetness nodes.
 *
 * Designed as an additive layer over `StoneSurface` so existing rock materials
 * preserve their base texture, lighting response, and artistic identity.
 */

/** Guarantees a non-zero vector before WGSL `normalize()` to avoid NaNs. */
const safeNormalize = (vec) => normalize(vec.add(geometryNormal.mul(1e-4)));

/** Scales a tint colour to unit relative luminance so hue shifts do not crush rock albedo. */
function normalizeTint(tintNode) {
  const luma = max(tintNode.r.mul(0.2126).add(tintNode.g.mul(0.7152)).add(tintNode.b.mul(0.0722)), 0.05);
  return tintNode.div(luma);
}

/**
 * Modulates strata intensity across geological regions so sedimentary bands
 * emerge and recede naturally instead of running uniformly across every wall.
 */
export function evaluateGeologicalStrataMask(point, zoneMask, strataCfg) {
  const warp = mx_noise_float(point.mul(0.045).add(vec3(5.2, 1.9, 8.4))).mul(0.35);
  const regional = mx_noise_float(point.mul(0.065).add(vec3(11.3, 4.1, 2.7))).mul(0.5).add(0.5);
  const variation = float(strataCfg?.strataVariation ?? 0.45);
  const zoneBias = smoothstep(0.2, 0.8, zoneMask.add(warp));
  return clamp(mix(float(1), regional.mul(0.75).add(zoneBias.mul(0.55)), variation), 0.2, 1.35);
}

/**
 * Macro & meso geological color variation, compatible rock-to-rock blending,
 * fracture/mineral staining, gravity-aligned seepage, and excavation freshness.
 */
export function applyGeologicalVariation({
  point,
  albedo,
  normal,
  roughness,
  f0,
  detailAlbedo,
  macro,
  midPatch,
  grainMix,
  mask,
  mask2,
  profile,
  maps,
  weights,
}) {
  const geo = profile.geology;
  if (!geo || geo.enabled === false) return { albedo, normal, roughness, f0 };

  const zone = mask2 ? mask2.x : macro;
  const crevice = mask ? clamp(mask.z, 0, 1) : float(0);
  const freshness = mask ? clamp(mask.w, 0, 1) : float(0.5);

  // 1. Macro geological rock-mass tinting (coherent world-space zones).
  const macroScale = max(float(geo.macroScale ?? 0.048), 1e-4);
  const zoneWarp = mx_noise_float(point.mul(macroScale.mul(0.6))).mul(0.28);
  const zoneNoise = mx_noise_float(point.mul(macroScale).add(vec3(7.3, 2.1, 13.7))).mul(0.5).add(0.5);
  const macroZone = clamp(mix(zone, zoneNoise, float(0.35)).add(zoneWarp), 0, 1);

  const contrast = clamp(float(geo.macroContrast ?? 0.22), 0, 0.8);
  const darkMass = smoothstep(0.45, 0.08, macroZone);
  const lightMass = smoothstep(0.58, 0.94, macroZone);
  const warmCool = mx_noise_float(point.mul(0.075).add(vec3(2.9, 8.4, 1.3))).mul(0.5).add(0.5);

  const baseGain = float(geo.baseGain ?? 1.35);
  const rawLuma = max(albedo.r.mul(0.2126).add(albedo.g.mul(0.7152)).add(albedo.b.mul(0.0722)), 1e-4);
  const rawChroma = albedo.div(rawLuma);
  const rockChroma = mix(
    rawChroma,
    normalizeTint(color(profile.tint ?? '#ebe3d6')),
    float(geo.chromaNeutralize ?? 0.68),
  );
  const scaledLuma = rawLuma.mul(baseGain);
  const liftedLuma = scaledLuma.div(scaledLuma.mul(float(geo.highlightKnee ?? 9.5)).add(1.0));

  let outAlbedo = rockChroma.mul(liftedLuma);
  let outNormal = normal;
  let outRoughness = roughness;
  let outF0 = f0;

  // Restrained palette shifts within the existing rock family (unit-luminance normalized).
  outAlbedo = outAlbedo.mul(mix(
    normalizeTint(color(geo.coolTint ?? '#d4dce6')),
    normalizeTint(color(geo.warmTint ?? '#ece2d3')),
    warmCool,
  ));
  outAlbedo = outAlbedo.mul(mix(
    float(1),
    normalizeTint(color(geo.darkTint ?? '#9c968c')).mul(0.84),
    clamp(darkMass.mul(contrast.mul(1.25)), 0, 1),
  ));
  outAlbedo = outAlbedo.mul(mix(
    float(1),
    normalizeTint(color(geo.lightTint ?? '#f0ebe2')).mul(1.18),
    clamp(lightMass.mul(contrast.mul(1.15)), 0, 1),
  ));

  // 2. Natural rock-to-rock blending toward a compatible secondary rock texture (e.g. basalt).
  if (maps.alt) {
    const altScale = max(float(profile.altScale ?? 0.22), 1e-4);
    const altTint = color(profile.altTint ?? '#d6d0c7');
    const altLuminanceScale = float(geo.altLuminanceScale ?? 0.46);
    const altAlbedo = triplanarSample(maps.alt.color, point, weights, altScale).rgb
      .mul(altTint)
      .mul(altLuminanceScale);
    const altNormal = triplanarNormal(
      maps.alt.normal, point, geometryNormal, weights, altScale, (profile.normalStrength ?? 1) * 1.05,
    );
    const altRough = clamp(
      triplanarSample(maps.alt.rough, point, weights, altScale).g.mul(profile.roughness ?? 1),
      0.12,
      0.98,
    );

    // Driven by macro geological zone + meso rock-mass variation so borders are organic.
    const rockMask = smoothstep(0.24, 0.78, macroZone.mul(0.72).add(midPatch.mul(0.28)));
    const altShare = clamp(rockMask.mul(float(geo.altRockBlend ?? 0.46)), 0, 1);
    outAlbedo = mix(outAlbedo, altAlbedo.mul(mix(float(0.88), float(1.12), macro)), altShare);
    outNormal = safeNormalize(mix(outNormal, altNormal, altShare.mul(0.55)));
    outRoughness = mix(outRoughness, altRough, altShare);
  }

  // 3. Fracture-associated discoloration & restrained mineral staining.
  const wallMask = clamp(float(1).sub(abs(geometryNormal.y)), 0, 1);
  const fractureField = clamp(crevice.mul(smoothstep(0.25, 0.78, detailAlbedo.g.mul(0.55).add(grainMix.mul(0.45)))), 0, 1);
  const fractureStrength = clamp(float(geo.fractureStain ?? 0.30), 0, 1);
  outAlbedo = mix(
    outAlbedo,
    outAlbedo.mul(normalizeTint(color(geo.fractureColor ?? '#6b645b'))).mul(0.78),
    fractureField.mul(fractureStrength),
  );
  outRoughness = mix(outRoughness, clamp(outRoughness.add(0.08), 0.12, 0.98), fractureField.mul(0.5));

  // Coherent mineral staining pockets (restrained iron-oxide ochre + pale mineral traces).
  const mineralNoise = mx_noise_float(point.mul(0.24).add(vec3(15.1, 3.7, 6.2))).mul(0.5).add(0.5);
  const ironPocket = smoothstep(0.60, 0.90, mineralNoise).mul(smoothstep(0.34, 0.80, midPatch));
  const paleTrace = smoothstep(0.66, 0.93, mx_noise_float(point.mul(0.42).add(vec3(1.4, 9.8, 4.5))).mul(0.5).add(0.5))
    .mul(crevice.mul(0.55).add(0.22));
  outAlbedo = mix(
    outAlbedo,
    outAlbedo.mul(normalizeTint(color(geo.mineralTint ?? '#8a6d4e'))).mul(0.95),
    clamp(ironPocket.mul(0.34), 0, 1),
  );
  outAlbedo = mix(
    outAlbedo,
    outAlbedo.mul(normalizeTint(color(geo.paleMineralTint ?? '#c7c3b8'))).mul(1.16),
    clamp(paleTrace.mul(0.24), 0, 1),
  );

  // Localized geological inclusions (nodular clasts in coarser beds, Section 4.3).
  const clastCell = clamp(float(1).sub(mx_worley_noise_float(point.mul(2.15).add(vec3(6.4, 2.3, 9.1)))), 0, 1);
  const clastMask = smoothstep(0.62, 0.88, clastCell)
    .mul(smoothstep(0.35, 0.78, macroZone))
    .mul(float(1).sub(crevice.mul(0.7)));
  outAlbedo = outAlbedo.mul(mix(float(1), mix(float(0.86), float(1.16), grainMix), clastMask.mul(0.38)));
  outNormal = bumpNormal(outNormal, clastMask.mul(0.012), float(0.65));

  // 4. Gravity-aligned vertical seepage streaks on walls and recesses.
  const seepBand = mx_noise_float(vec3(point.x.mul(1.35), point.y.mul(0.22), point.z.mul(1.35)).add(vec3(3.1, 0.7, 8.2)))
    .mul(0.5).add(0.5);
  const seepZone = smoothstep(0.46, 0.8, mx_noise_float(point.mul(0.11).add(vec3(4.4, 1.2, 7.9))).mul(0.5).add(0.5));
  const seepMask = clamp(
    smoothstep(0.56, 0.86, seepBand).mul(seepZone).mul(wallMask).mul(float(geo.verticalSeep ?? 0.24)),
    0,
    1,
  );
  outAlbedo = outAlbedo.mul(mix(float(1), float(0.82), seepMask));
  outRoughness = mix(outRoughness, float(0.56), seepMask.mul(0.62));

  // 5. Excavation freshness vs older weathered dust (anchored to rock luminance).
  if (profile.excavation) {
    const exc = profile.excavation;
    const fresh = smoothstep(0.45, 0.9, freshness);
    const weathered = smoothstep(0.48, 0.08, freshness);
    const upDust = smoothstep(0.1, 0.7, geometryNormal.y).mul(0.65).add(0.35);

    // Freshly cut stone is subtly cleaner and slightly lighter on protruding faces.
    outAlbedo = outAlbedo.mul(mix(float(1), float(exc.freshLighten ?? 1.09), fresh.mul(0.68)));
    outRoughness = mix(outRoughness, outRoughness.mul(0.92), clamp(fresh.mul(exc.freshClean ?? 0.34), 0, 1));

    // Older workings pick up fine settled rock dust on shelves and rougher weathering.
    const dustMask = clamp(weathered.mul(upDust).mul(float(exc.weatheredDust ?? 0.26)), 0, 1);
    outAlbedo = mix(
      outAlbedo,
      outAlbedo.mul(normalizeTint(color(exc.dustTint ?? '#8a7f72'))).mul(0.84),
      dustMask.mul(0.42),
    );
    outRoughness = mix(outRoughness, float(0.96), dustMask.mul(0.55));
  }

  return {
    albedo: outAlbedo,
    normal: safeNormalize(outNormal),
    roughness: clamp(outRoughness, 0.12, 0.98),
    f0: clamp(outF0, 0.02, 0.9),
  };
}

/**
 * Distinct mine floor families (compacted earth, worn lane, crushed stone/gravel,
 * railway ballast, exposed bedrock, damp sediment) and natural wall-to-floor transitions.
 */
export function applyMineGround({
  point,
  albedo,
  normal,
  roughness,
  f0,
  detailAlbedo,
  macro,
  midPatch,
  grainMix,
  mask,
  mask2,
  profile,
  maps,
  weights,
}) {
  const ground = profile.ground;
  if (!ground || ground.enabled === false) return { albedo, normal, roughness, f0 };

  const rockRelief = detailAlbedo ? detailAlbedo.g : grainMix;
  const crevice = mask ? clamp(mask.z, 0, 1) : float(0);
  // Cellular + fracture pocket field: grit/sediment collects in flat troughs rather than climbing sloped walls.
  const cellPocket = clamp(float(1).sub(mx_worley_noise_float(point.mul(1.65))), 0, 1);
  const pocketField = clamp(
    cellPocket.mul(0.42).add(crevice.mul(0.28)).add(float(1).sub(rockRelief).mul(0.30)),
    0,
    1,
  );
  const domainGate = mask2 ? smoothstep(0.14, 0.48, max(mask2.y, max(mask2.z, mask2.w))) : float(1);
  const slopeBias = pocketField.sub(0.5).mul(0.14);
  const floorMask = smoothstep(0.76, 0.93, geometryNormal.y.add(slopeBias)).mul(domainGate);

  // Wall-base skirt stays restricted to fractured base pockets; never smears earth up sloped chamber walls.
  const skirtSlope = smoothstep(0.54, 0.84, geometryNormal.y);
  const skirtBreakup = smoothstep(0.34, 0.82, pocketField.mul(0.65).add(midPatch.mul(0.35)));
  const rawSkirt = mask2 ? mask2.w.mul(skirtSlope) : float(0);
  const wallSkirt = clamp(rawSkirt.mul(skirtBreakup), 0, 1);
  const surfaceActive = clamp(max(floorMask, wallSkirt), 0, 1);

  const earthCover = mask2 ? clamp(mask2.y, 0, 1) : float(0.6);
  const gravelWeight = mask2 ? clamp(mask2.z, 0, 1) : float(0);
  const damp = mask ? clamp(mask.y, 0, 1) : float(0);

  // Anchor compacted earth luminance to cave-rock albedo so floors remain in the dark rock family.
  const flScale = max(float(profile.floorScale ?? 0.82), 1e-4);
  const albedoLuma = albedo.r.add(albedo.g).add(albedo.b).mul(0.333);
  const earthBase = mix(albedo, vec3(albedoLuma), float(0.45));
  const compactedHue = normalizeTint(color(ground.compactedTint ?? '#cbb299'));
  const compactedValue = float(ground.compactedValue ?? 1.14);
  let earthColor = earthBase
    .mul(compactedHue)
    .mul(compactedValue)
    .mul(mix(float(0.90), float(1.10), macro));
  let earthNormal = normal;
  let earthRough = clamp(float(ground.compactedRoughness ?? 0.95), 0.25, 0.98);

  if (maps.floor) {
    const flBase = triplanarSample(maps.floor.color, point, weights, flScale).rgb;
    const flFine = triplanarSample(maps.floor.color, point.add(vec3(0.41, 0.13, 0.67)), weights, flScale.mul(2.15)).rgb;
    const flGrain = clamp(flBase.r.mul(0.5).add(flFine.g.mul(0.5)).sub(0.52).mul(2.2).add(1.0), 0.62, 1.38);
    earthColor = earthBase
      .mul(compactedHue)
      .mul(compactedValue)
      .mul(flGrain)
      .mul(mix(float(0.90), float(1.10), macro));
    const flNormal = triplanarNormal(
      maps.floor.normal, point, geometryNormal, weights, flScale, (profile.normalStrength ?? 1) * 1.15,
    );
    earthNormal = bumpNormal(safeNormalize(mix(normal, flNormal, float(0.46))), flFine.g.sub(0.5).mul(0.012), float(0.85));
    earthRough = clamp(
      triplanarSample(maps.floor.rough, point, weights, flScale).g.mul(float(ground.compactedRoughness ?? 0.95)),
      0.25,
      0.98,
    );
  }

  // Subtle worn walking areas along compacted corridors (restrained sheen difference).
  const wearField = clamp(
    smoothstep(0.32, 0.75, midPatch).mul(earthCover).mul(float(1).sub(gravelWeight.mul(0.7))),
    0,
    1,
  );
  earthColor = mix(
    earthColor,
    earthColor.mul(normalizeTint(color(ground.wearTint ?? '#dcd0c2'))).mul(1.08),
    wearField.mul(0.32),
  );
  earthRough = mix(earthRough, float(ground.wearRoughness ?? 0.78), wearField.mul(0.36));

  // Exposed bedrock on floors: keeps wall rock's geological identity, flatter excavation roughness.
  const bedrockAlbedo = albedo.mul(mix(float(0.9), float(1.06), grainMix));
  const bedrockRough = clamp(roughness.mul(float(ground.bedrockRoughness ?? 0.9)), 0.38, 0.96);

  // Blend exposed bedrock -> compacted earth strictly inside true flat floor pockets (never up walls).
  const filletSkirt = wallSkirt.mul(float(1).sub(floorMask));
  const earthMix = clamp(
    earthCover.mul(floorMask).mul(mix(float(0.52), float(1.12), pocketField)),
    0,
    1,
  );
  let groundAlbedo = mix(bedrockAlbedo, earthColor, earthMix);
  let groundNormal = safeNormalize(mix(normal, earthNormal, earthMix));
  let groundRough = mix(bedrockRough, earthRough, earthMix);

  // Crushed stone, gravel & railway ballast: dual-scale angular Worley fragments + rock-anchored chip tone.
  const gScale = max(float(ground.gravelScale ?? 6.4), 1e-4);
  const wCoarse = mx_worley_noise_float(point.mul(gScale));
  const wFine = mx_worley_noise_float(point.mul(gScale.mul(2.35)).add(vec3(3.1, 1.7, 5.4)));
  const pebbleCrown = clamp(float(1).sub(wCoarse), 0, 1).mul(0.62)
    .add(clamp(float(1).sub(wFine), 0, 1).mul(0.38));
  const chipTone = mix(float(0.48), float(1.42), clamp(wFine.mul(0.58).add(grainMix.mul(0.42)), 0, 1));

  let gravelColor = mix(earthColor, albedo, float(0.62))
    .mul(normalizeTint(color(ground.gravelTint ?? '#b2b4b8')))
    .mul(float(ground.gravelValue ?? 1.12))
    .mul(chipTone);
  const trackWeather = smoothstep(0.45, 0.85, gravelWeight)
    .mul(smoothstep(0.28, 0.78, midPatch.mul(0.55).add(grainMix.mul(0.45))));
  gravelColor = mix(
    gravelColor,
    gravelColor.mul(normalizeTint(color(ground.trackWeatherTint ?? '#6e635b'))).mul(0.76),
    trackWeather.mul(0.42),
  );

  const gravelBump = bumpNormal(
    groundNormal,
    pebbleCrown.mul(0.022),
    float(ground.gravelRelief ?? 1.25).mul(clamp(gravelWeight.mul(1.25), 0, 1)),
  );
  const gravelShare = clamp(gravelWeight.mul(max(floorMask, wallSkirt.mul(0.75))), 0, 1);

  groundAlbedo = mix(groundAlbedo, gravelColor, gravelShare);
  groundNormal = safeNormalize(mix(groundNormal, gravelBump, gravelShare));
  groundRough = mix(
    groundRough,
    mix(float(ground.gravelRoughness ?? 0.92), float(0.76), trackWeather.mul(0.35)),
    gravelShare,
  );

  // Wall-to-floor transition: dark fractured bedrock and subtle crevice moisture at wall bases (no sand collar).
  const skirtMoisture = clamp(filletSkirt.mul(crevice.mul(0.55).add(damp.mul(0.45)).add(0.2)), 0, 1);
  const wallBaseRock = albedo
    .mul(normalizeTint(color(ground.wallBaseTint ?? '#8a8278')))
    .mul(mix(float(0.82), float(0.98), pocketField));
  groundAlbedo = mix(groundAlbedo, wallBaseRock, clamp(filletSkirt.mul(0.62), 0, 1));
  groundRough = mix(groundRough, mix(float(0.95), float(0.64), damp), skirtMoisture.mul(0.55));

  // Damp floor sediment near drainage / water pool (restrained roughness to prevent white grazing halos).
  const floorDamp = clamp(damp.mul(floorMask), 0, 1);
  groundAlbedo = mix(
    groundAlbedo,
    groundAlbedo.mul(normalizeTint(color(ground.dampTint ?? '#6e675f'))).mul(0.72),
    floorDamp.mul(0.55),
  );
  groundRough = mix(groundRough, float(ground.dampRoughness ?? 0.46), floorDamp.mul(0.68));

  return {
    albedo: mix(albedo, groundAlbedo, surfaceActive),
    normal: safeNormalize(mix(normal, groundNormal, surfaceActive)),
    roughness: clamp(mix(roughness, groundRough, surfaceActive), 0.36, 0.98),
    f0: clamp(mix(f0, float(ground.dampF0 ?? 0.042), floorDamp.mul(0.48)), 0.02, 0.9),
  };
}

/**
 * Restrained localized wetness on walls, recesses, and drainage paths.
 * Dry rock remains dominant; damp regions darken albedo and reduce roughness
 * without turning the mine glossy.
 */
export function applyLocalizedWetness({
  albedo,
  roughness,
  f0,
  macro,
  midPatch,
  mask,
  profile,
}) {
  const wetCfg = profile.wetness ?? {};
  const rawWet = mask ? clamp(mask.y, 0, 1) : float(0);
  const breakup = smoothstep(0.22, 0.78, macro.mul(0.55).add(midPatch.mul(0.45)).add(rawWet.mul(0.45)));
  const damp = clamp(rawWet.mul(breakup), 0, 1);

  // Subtle mineral rim staining right at the wet/dry margin.
  const rim = clamp(damp.mul(float(1).sub(damp)).mul(4), 0, 1);
  const rimTint = normalizeTint(color(wetCfg.rimTint ?? '#7a6852')).mul(0.86);
  let outAlbedo = mix(albedo, albedo.mul(rimTint), clamp(rim.mul(float(wetCfg.mineralRim ?? 0.12)), 0, 1));

  outAlbedo = outAlbedo.mul(mix(float(1), float(wetCfg.darken ?? 0.72), damp));
  const outRoughness = mix(roughness, float(wetCfg.roughness ?? 0.52), damp);
  const outF0 = mix(f0, float(0.036 + (wetCfg.specularBoost ?? 0.014)), damp);

  // Guard against any non-finite roughness values on WebGPU.
  return {
    albedo: outAlbedo,
    roughness: clamp(outRoughness, 0.36, 0.98),
    f0: clamp(outF0, 0.02, 0.9),
  };
}

/** Safe bounded power helper to avoid WGSL `pow(<=0, e)` NaNs. */
export function safePow(base, exponent) {
  return pow(max(base, 1e-4), exponent);
}
