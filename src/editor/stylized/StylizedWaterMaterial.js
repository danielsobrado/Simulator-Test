import * as THREE from 'three/webgpu';
import { assignMaterialData, REFLECTION_CLASSES } from '../../render/postprocessing/PostProcessingMaterialData.js';
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fwidth,
  length,
  linearDepth,
  max,
  min,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  screenUV,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
  viewportDepthTexture,
  viewportOpaqueMipTexture,
  viewportSafeUV,
} from 'three/tsl';
import { resolveWaterQualityFeatures } from '../water/WaterQuality.js';
import { assignWaterMaterialData } from '../../render/postprocessing/PostProcessingMaterialData.js';
import {
  periodicFbm2,
  periodicVoronoiF1,
  periodicVoronoiMetrics,
} from './PeriodicNoiseNodes.js';
import { referenceBlendTaps } from './PatternOrigins.js';
import {
  WATER_FLOW_REFERENCE_BLEND,
  WATER_FLOW_REFERENCE_METERS,
} from './WaterPatternOrigins.js';
import { createSurfaceClassNodes } from './SurfaceMaskNodes.js';
import { createWaterfallFoamNode } from './WaterfallShading.js';
import { createSeaSurfaceNodes, seaWaterMask } from './SeaSurfaceShading.js';
import { createSeaOpticsNodes } from './SeaOpticsShading.js';
import { createCoastSwashNodes, DEFAULT_COAST_SWASH } from './CoastSwashShading.js';
import { createRainRippleNode } from './RainRippleShading.js';
import { createRiverSurfaceNodes } from './RiverSurfaceShading.js';
import { compositeWaterFoam, waterRippleRefraction } from './WaterSurfaceResponse.js';
import { seaStateUniforms } from '../water/seaState.js';
import { skyLightUniforms } from './sky/skyLight.js';
import { LAKE_WAVES, lakeWaveRise } from '../water/LakeSurfaceWaves.js';
import { bilinearLoad } from '../materials/TerrainSlotBindings.js';
import { createWaterAppearanceNodes } from './WaterAppearanceNodes.js';
import { rippleFieldSlope } from '../water/rippleFieldNode.js';

const CAUSTIC_RING_RADIUS = 0.4;
const CAUSTIC_AA_SCALE = 1.25;
const FRESNEL_POWER = 5;
const LOW_SURFACE_RAMP_MIN = 0.2;
const LOW_SURFACE_RAMP_MAX = 0.8;
const SURFACE_NOISE_OFFSET = Object.freeze([19.1, 47.2]);
const REFRACTION_FINE_OFFSET = Object.freeze([31.73, 11.29]);

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

function refractionWarp(coarsePoint, finePoint) {
  const coarse = periodicFbm2(coarsePoint).sub(0.5).mul(2);
  const fine = periodicFbm2(finePoint).sub(0.5).mul(2);
  return vec2(
    coarse.mul(0.7).add(fine.mul(0.3)),
    coarse.mul(-0.35).add(fine.mul(0.65)),
  );
}

export function createStylizedWaterMaterial({
  surfaceMaskTexture,
  waterFieldTexture,
  waterFlowTexture,
  waterAppearanceTexture = null,
  waterObstacleTexture = null,
  waterFieldSize,
  waterSurfaceOrigin,
  chunkCenter,
  chunkWorldSize,
  time,
  config,
  reflections = null,
  // Per-chunk phase of each swell component at the chunk centre (SeaSwell), and
  // the sun the swell's slopes are shaded against. Without them there is no swell.
  seaPhaseOrigin = null,
  sunDirection = null,
  // The chunk's origin corner in whole metres on cell axes, for patterns that
  // must stay exact at planet scale (rain rings).
  rippleOrigin = null,
  // The chunk centre wrapped to the waterfall pattern period (vec2 uniform,
  // `waterfallPatternOrigin`), so fall strands stay sharp at planet scale.
  // Without it the strands read canonical metres.
  patternOrigin = null,
  // Per-chunk origins of the surface's procedural patterns
  // (WaterPatternOrigins). None of them reads a canonical position: at planet
  // scale float32 has no fraction left there, and noise and voronoi collapse
  // into a regular lattice of light lines.
  surfacePatterns,
  // Build-time opt-out. Sampling the viewport colour and depth textures makes
  // the renderer copy both buffers for the whole frame, and it does so as soon
  // as a material carrying those nodes is used at all — hiding the mesh does
  // not avoid it. Chunks far from the camera get a variant built without the
  // branch so a player away from water pays nothing.
  enableRefraction = true,
  sampleTexture = (_name, value, uvNode) => texture(value, uvNode),
  loadTexture = (_name, value, uvNode) => bilinearLoad(value, uvNode),
}) {
  const water = config.water;
  const quality = resolveWaterQualityFeatures(water);
  const terrainUv = uv();
  const fieldUv = terrainUv
    .mul((waterFieldSize - 1) / waterFieldSize)
    .add(0.5 / waterFieldSize);
  const surface = sampleTexture('surfaceMaskTexture', surfaceMaskTexture, terrainUv);
  const exactCoverage = createSurfaceClassNodes(surface).waterCoverage;
  const waterField = sampleTexture('waterFieldTexture', waterFieldTexture, fieldUv);
  const appearance = waterAppearanceTexture ? createWaterAppearanceNodes(
    sampleTexture('waterAppearanceTexture', waterAppearanceTexture, fieldUv),
    loadTexture('waterAppearanceTexture', waterAppearanceTexture, fieldUv),
  ) : null;
  const waterCoverage = max(exactCoverage, clamp(waterField.r, 0, 1));
  const waterDepth = max(waterField.b, 0);
  const shoreDistance = max(waterField.a, 0);
  // The water field inherits a surface height onto dry vertices so the sheet
  // stays continuous across chunk seams, and this mesh reuses the terrain grid.
  // Coverage alone therefore keeps the sheet fully opaque up to a cell inland,
  // where alphaTest cuts it along terrain triangle edges — the hard polygonal
  // wedges over the beach. Depth is the honest thickness of the body and
  // reaches zero on the waterline itself, so fading what the surface
  // contributes as it thins puts the edge back on the contour.
  const waterlineFade = smoothstep(
    0,
    max(float(water.optics.shorelineFadeDepth), 1e-4),
    waterDepth,
  );
  // Metres from the chunk centre, canonical axes.
  const localXZ = vec2(
    terrainUv.x.sub(0.5).mul(chunkWorldSize),
    float(0.5).sub(terrainUv.y).mul(chunkWorldSize),
  );
  const worldXZ = chunkCenter.add(localXZ);
  const fallbackFlow = vec2(water.flowX, water.flowZ);
  let currentFlow = fallbackFlow;
  let currentStrength = float(0);
  let fallPlunge = null;
  if (quality.flow) {
    const flowSample = sampleTexture('waterFlowTexture', waterFlowTexture, fieldUv);
    fallPlunge = flowSample.ba;
    const encodedFlow = flowSample.rg;
    const decodedCellFlow = encodedFlow.mul(2).sub(1);
    const decodedFlow = vec2(decodedCellFlow.x, decodedCellFlow.y.negate());
    currentStrength = clamp(length(decodedFlow), 0, 1);
    const currentMask = step(0.05, currentStrength);
    currentFlow = mix(
      fallbackFlow,
      decodedFlow.mul(water.currentInfluence),
      currentMask,
    );
  }
  const currentOffset = currentFlow.mul(time.mul(water.currentAnimationSpeed));
  const legacyNoiseOffset = vec2(time.mul(water.noiseFlowSpeed), 0);
  const legacySurfaceOffset = fallbackFlow.mul(time);
  const noiseOffset = quality.flow ? currentOffset : legacyNoiseOffset;
  const surfaceOffset = quality.flow ? currentOffset : legacySurfaceOffset;

  const noisePoint = surfacePatterns.latticePoint('surfaceNoise', localXZ).add(noiseOffset);
  const surfaceNoise = vec2(
    periodicFbm2(noisePoint),
    periodicFbm2(noisePoint.add(vec2(
      SURFACE_NOISE_OFFSET[0],
      SURFACE_NOISE_OFFSET[1],
    ))),
  );
  const noiseFac = surfaceNoise.x.add(surfaceNoise.y).mul(0.5);
  // Wakes, drops and spells (water/RippleField.js), on the river and sea normals alike.
  const ripple = water.interaction?.enabled !== false && rippleOrigin
    // Faded out over the last half metre of depth: on the film over a beach
    // the rings otherwise drew as bright arcs across the wet sand.
    ? rippleFieldSlope(rippleOrigin, vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize))
      .mul(smoothstep(0.1, 0.5, waterDepth)).toVar('waterRippleSlope')
    : null;
  const sea = water.sea?.enabled && quality.flow && seaPhaseOrigin && sunDirection
    ? createSeaSurfaceNodes({
      terrainUv,
      patternXZ: surfacePatterns.latticePoint('riverDetail', localXZ),
      patterns: surfacePatterns,
      chunkWorldSize,
      surfaceWorldHeight: waterField.g.add(waterSurfaceOrigin),
      waterDepth,
      waterCoverage,
      currentStrength,
      time,
      phaseOrigin: seaPhaseOrigin,
      sunDirection,
      oceanMask: appearance?.ocean,
      exposure: appearance?.exposure,
      ripple,
      config: water.sea,
    })
    : null;
  // Inland water takes grass-test's surface; the sea keeps its own shading.
  const fall = fallPlunge ? fallPlunge.x : float(0);
  const river = water.riverSurface?.enabled && quality.flow && quality.depthOptics && sunDirection
    ? createRiverSurfaceNodes({
      patternXZ: surfacePatterns.latticePoint('riverDetail', localXZ),
      patterns: surfacePatterns,
      localXZ,
      flow: currentFlow,
      currentStrength,
      fall,
      waterDepth,
      shoreDistance,
      obstacles: waterObstacleTexture && water.riverSurface.obstacles !== false
        ? sampleTexture('waterObstacleTexture', waterObstacleTexture, fieldUv).rg : vec2(0),
      ripple,
      time,
      sunDirection: normalize(sunDirection),
      viewDirection: normalize(cameraPosition.sub(positionWorld)),
      config: water.riverSurface,
    })
    : null;
  // The sea keeps its own shading, with or without its swell.
  const inland = appearance ? oneMinus(appearance.ocean) : !river ? float(1) : oneMinus(sea ? sea.mask : seaWaterMask({
    surfaceWorldHeight: waterField.g.add(waterSurfaceOrigin),
    currentStrength,
  }));
  const oceanWeight = appearance?.ocean ?? sea?.mask ?? float(0);
  const seaOptics = water.sea?.enabled && quality.depthOptics ? createSeaOpticsNodes(waterDepth, water.sea.optics) : null;
  const distort = surfaceNoise.sub(0.5).mul(water.distortAmount);
  const sampleUv = surfacePatterns.latticePoint('cells', localXZ)
    .add(surfaceOffset)
    .add(distort);

  let ramp = smoothstep(LOW_SURFACE_RAMP_MIN, LOW_SURFACE_RAMP_MAX, noiseFac);
  if (quality.cellularSurface) {
    const metrics = periodicVoronoiMetrics(
      sampleUv,
      time,
      water.cellSpeed,
      float(water.cellSmoothness),
    );
    const edge = metrics.nearest.sub(metrics.smoothNearest);
    const edgeWidth = max(
      float(water.edgeSoftness),
      fwidth(edge).mul(0.75),
    );
    ramp = smoothstep(
      float(water.edgeThreshold).sub(edgeWidth),
      float(water.edgeThreshold).add(edgeWidth),
      edge,
    );
  }

  const midPos = max(float(water.midPos), 1e-4);
  const seg0 = clamp(ramp.div(midPos), 0, 1);
  const seg1 = clamp(ramp.sub(midPos).div(max(float(1).sub(midPos), 1e-4)), 0, 1);
  const inSeg1 = step(midPos, ramp);
  const legacyColor = mix(
    mix(colorNode(water.deepColor), colorNode(water.midColor), seg0),
    mix(colorNode(water.midColor), colorNode(water.highlightColor), seg1),
    inSeg1,
  );

  const distance = length(positionWorld.xz.sub(cameraPosition.xz));
  const fade = oneMinus(pow(clamp(distance.div(water.fadeDistance), 0, 1), water.fadeStrength));
  let color = legacyColor;
  let alpha = mix(float(water.deepOpacity), float(water.opacity), ramp)
    .mul(fade)
    .mul(waterCoverage)
    .mul(waterlineFade);
  let opticalDistance = float(0);
  // How much of the bed still reaches the eye. Caustics are light landing on
  // the bed, so they must not survive where the body has already absorbed it.
  let bedVisibility = float(1);
  let bodyColor = legacyColor;
  let surfaceDetailMix = float(0);
  let surfaceReflection = float(0);
  let foamAmount = float(0);
  // Where the surface's reflection shows: above water, near enough, not on the bank.
  let reflectionVisibility = float(0);

  if (quality.depthOptics) {
    const optics = water.optics;
    const viewVector = cameraPosition.sub(positionWorld);
    const viewCosine = clamp(
      abs(viewVector.y).div(max(length(viewVector), 1e-4)),
      optics.minimumViewCosine,
      1,
    );
    const cameraSubmersionDepth = max(positionWorld.y.sub(cameraPosition.y), 0);
    const underwaterBlend = smoothstep(
      0,
      optics.surfaceTransitionDepth,
      cameraSubmersionDepth,
    );
    const verticalDistance = mix(waterDepth, cameraSubmersionDepth, underwaterBlend);
    opticalDistance = min(
      verticalDistance.div(viewCosine),
      seaOptics ? mix(float(optics.maximumOpticalDistance), float(seaOptics.settings.maximumOpticalDistance), oceanWeight)
        : optics.maximumOpticalDistance,
    );
    let density = seaOptics ? mix(float(optics.absorptionDensity), float(seaOptics.settings.absorptionDensity), oceanWeight)
      : float(optics.absorptionDensity);
    if (appearance) density = appearance.density(density);
    const transmission = exp(opticalDistance.mul(density).negate());
    const absorbed = oneMinus(transmission);
    bedVisibility = transmission;
    const depthMix = smoothstep(optics.shallowDepth, optics.deepDepth, waterDepth);
    const inlandColor = mix(
      colorNode(optics.shallowColor),
      colorNode(optics.deepColor),
      depthMix,
    );
    let depthColor = seaOptics ? mix(inlandColor, seaOptics.color, oceanWeight) : inlandColor;
    if (appearance) depthColor = appearance.color(depthColor, waterDepth);
    bodyColor = mix(
      depthColor,
      colorNode(optics.underwaterColor),
      underwaterBlend.mul(optics.underwaterTintStrength),
    );
    surfaceDetailMix = float(optics.surfaceDetailStrength).mul(fade).mul(waterlineFade);
    // Reflection follows the swell's slopes; absorption keeps the flat path length.
    const reflectionCosine = sea
      ? clamp(
        abs(dot(viewVector, sea.normal)).div(max(length(viewVector), 1e-4)),
        optics.minimumViewCosine,
        1,
      )
      : viewCosine;
    reflectionVisibility = oneMinus(underwaterBlend).mul(fade).mul(waterlineFade);
    surfaceReflection = pow(oneMinus(reflectionCosine), FRESNEL_POWER)
      .mul(quality.fresnelStrength)
      .mul(reflectionVisibility);
    if (seaOptics) {
      const seaFresnel = pow(oneMinus(reflectionCosine), 3).mul(0.96).add(0.04)
        .mul(Math.min(1, seaOptics.settings.fresnelStrength * quality.fresnelStrength / 0.42));
      surfaceReflection = mix(surfaceReflection, seaFresnel.mul(reflectionVisibility), oceanWeight);
    }
    color = mix(bodyColor, legacyColor, surfaceDetailMix);
    alpha = mix(
      float(optics.minimumOpacity),
      float(optics.maximumOpacity),
      absorbed,
    ).mul(waterCoverage).mul(waterlineFade);
  }

  if (quality.foam && water.foam.enabled) {
    const foam = water.foam;
    const shoreBand = oneMinus(smoothstep(0, foam.shoreWidth, shoreDistance));
    // Bands along the current are measured from nearby reference points, not
    // from the world origin (see referenceBlendTaps).
    const bandAt = (tap) => pow(
      sin(dot(tap.offset, currentFlow)
        .mul(foam.flowBandScale)
        .sub(time.mul(foam.flowBandSpeed))).mul(0.5).add(0.5),
      foam.flowBandContrast,
    ).mul(tap.weight);
    const flowTaps = referenceBlendTaps(
      surfacePatterns.latticePoint('flowReference', localXZ),
      WATER_FLOW_REFERENCE_METERS,
      WATER_FLOW_REFERENCE_BLEND,
    );
    const flowBand = flowTaps.slice(1)
      .reduce((sum, tap) => sum.add(bandAt(tap)), bandAt(flowTaps[0]))
      .mul(currentStrength).mul(foam.flowStrength);
    const noiseBreakup = mix(
      float(1),
      smoothstep(0.18, 0.82, noiseFac),
      foam.noiseStrength,
    );
    foamAmount = max(shoreBand, flowBand)
      .mul(noiseBreakup)
      .mul(foam.intensity * quality.foamStrength);
    // The river's foam replaces the shore and flow bands but keeps the tier's scale.
    // It has its own strength (`riverSurface.foamStrength`): `foam.intensity`
    // scales the sea's bands, whose look it was tuned for.
    if (river) {
      const riverFoam = river.foam.mul(quality.foamStrength * (water.riverSurface.foamStrength ?? 1));
      foamAmount = mix(foamAmount, riverFoam, inland);
    }
    // Sea foam comes from breaking crests and the shared swash front.
    if (sea) foamAmount = foamAmount.mul(oneMinus(sea.mask));
    foamAmount = foamAmount.mul(waterCoverage);
    if (appearance) foamAmount = foamAmount.mul(appearance.foamScale);
  }

  // Foam is composited after refraction, which resets alpha to coverage.
  let whitewater = null;
  if (quality.foam && water.foam.enabled && fallPlunge && water.waterfall.enabled) {
    whitewater = createWaterfallFoamNode({
      fallPlunge,
      flow: currentFlow,
      // Not `worldXZ`: its float32 sum of a planet-scale centre and the local
      // offset has already lost the centimetres the strands are drawn in.
      patternXZ: patternOrigin ? patternOrigin.add(localXZ) : worldXZ,
      time,
      config: water.waterfall,
    }).mul(waterCoverage);
    foamAmount = max(foamAmount, whitewater);
  }

  if (enableRefraction && quality.refraction && water.refraction.enabled) {
    const refraction = water.refraction;
    const coarsePoint = surfacePatterns.latticePoint('refractionCoarse', localXZ)
      .add(currentFlow.mul(time.mul(refraction.coarseSpeed)));
    const finePoint = surfacePatterns.latticePoint('refractionFine', localXZ)
      .sub(currentFlow.mul(time.mul(refraction.fineSpeed)))
      .add(vec2(REFRACTION_FINE_OFFSET[0], REFRACTION_FINE_OFFSET[1]));
    const depthFactor = smoothstep(
      refraction.depthFadeStart,
      refraction.depthFadeEnd,
      waterDepth,
    );
    const warp = refractionWarp(coarsePoint, finePoint);
    const inlandWarp = river
      ? mix(warp, waterRippleRefraction(river.normal, river.baseNormal), inland)
      : warp;
    const distortionUv = (sea ? mix(inlandWarp, waterRippleRefraction(sea.normal, vec3(0, 1, 0)), sea.mask) : inlandWarp)
      .mul(refraction.strength * quality.refractionStrength)
      .mul(depthFactor);
    const baseViewportUv = viewportSafeUV(screenUV);
    const distortedViewportUv = viewportSafeUV(baseViewportUv.add(distortionUv));
    const depthRange = cameraFar.sub(cameraNear);
    const waterViewDistance = linearDepth().mul(depthRange).add(cameraNear);
    const baseViewDistance = linearDepth(
      viewportDepthTexture(baseViewportUv),
    ).mul(depthRange).add(cameraNear);
    const distortedViewDistance = linearDepth(
      viewportDepthTexture(distortedViewportUv),
    ).mul(depthRange).add(cameraNear);
    // A soft hand-over: a hard step flipped whole pixels between the bent and
    // straight lookups along the bed's triangle edges, drawing straight seams.
    const validDepth = smoothstep(
      waterViewDistance.add(refraction.depthBiasMeters),
      waterViewDistance.add(refraction.depthBiasMeters + 0.4),
      distortedViewDistance,
    );
    const acceptedViewportUv = mix(
      baseViewportUv,
      distortedViewportUv,
      validDepth,
    );
    const acceptedViewDistance = mix(
      baseViewDistance,
      distortedViewDistance,
      validDepth,
    );
    const sceneColor = viewportOpaqueMipTexture(
      acceptedViewportUv,
      float(refraction.mipLevel),
    ).rgb;
    const inlandCoefficients = vec3(
      refraction.absorptionCoefficients[0],
      refraction.absorptionCoefficients[1],
      refraction.absorptionCoefficients[2],
    );
    let coefficients = seaOptics ? mix(inlandCoefficients, seaOptics.absorption, oceanWeight) : inlandCoefficients;
    if (appearance) coefficients = appearance.absorption(coefficients);
    const channelTransmission = exp(coefficients.mul(opticalDistance).negate());
    const refractedBody = sceneColor.mul(channelTransmission)
      .add(bodyColor.mul(oneMinus(channelTransmission)));
    const physicalColor = mix(
      bodyColor,
      refractedBody,
      refraction.sceneColorStrength,
    );
    color = mix(physicalColor, legacyColor, surfaceDetailMix);
    alpha = waterCoverage.mul(waterlineFade);

    if (quality.intersectionFoam && water.foam.enabled) {
      const foam = water.foam;
      const sceneGap = max(acceptedViewDistance.sub(waterViewDistance), 0);
      const contact = oneMinus(smoothstep(
        foam.intersectionDepth,
        foam.intersectionDepth + foam.intersectionSoftness,
        sceneGap,
      ));
      const intersectionFoam = contact
        // The shared swash already owns the bed contact. Intersection foam
        // accents objects in water instead of tracing a second white bank.
        .mul(smoothstep(.35, .9, waterDepth))
        .mul(foam.intersectionStrength * quality.intersectionFoamStrength)
        .mul(river ? mix(float(1), smoothstep(0.25, 0.7, river.foamNoise), inland) : float(1))
        .mul(sea ? mix(float(1), smoothstep(0.25, 0.7, sea.foamNoise), sea.mask) : float(1))
        .mul(waterCoverage);
      foamAmount = max(foamAmount, intersectionFoam);
    }
  }

  if (quality.caustics) {
    const caustics = water.caustics;
    const causticUv = surfacePatterns.latticePoint('caustics', localXZ)
      .add(currentFlow.mul(time.mul(caustics.speed)));
    // A ring band around each voronoi point, not FBM. Light focused by a rippled
    // surface lands on the bed as a web of thin filaments; FBM can only make
    // soft blobs, which is why the water read as flat tint from above however
    // much the intensity was raised. Isolating one radius of the F1 distance
    // field draws a ring per cell, and neighbouring rings overlap into that web
    // — for one voronoi rather than the two a border metric would need. The
    // cell points drift on their own clock, so the web crawls.
    const causticRing = abs(
      periodicVoronoiF1(causticUv, time, caustics.speed).sub(CAUSTIC_RING_RADIUS),
    );
    const configuredWidth = float(1).div(max(float(caustics.contrast), 1e-4));
    const causticWidth = max(
      configuredWidth,
      fwidth(causticRing).mul(CAUSTIC_AA_SCALE),
    );
    const causticNet = oneMinus(smoothstep(0, causticWidth, causticRing));
    const shallow = oneMinus(smoothstep(
      caustics.depthFadeStart,
      caustics.depthFadeEnd,
      waterDepth,
    ));
    const causticAmount = causticNet.mul(causticNet)
      .mul(caustics.intensity * quality.causticStrength)
      .mul(shallow)
      .mul(bedVisibility)
      .mul(waterlineFade);
    color = color.add(colorNode(water.highlightColor).mul(causticAmount));
  }

  if (sea) color = sea.shade(color);
  // Looking straight down the Fresnel barely moves, so ring faces also catch a
  // little light of their own: the rings still read from a bridge or a cliff.
  if (ripple) color = color.add(colorNode(water.highlightColor).mul(ripple.length().mul(0.12).clamp(0, 0.05)));

  if (water.rainRipples?.enabled && quality.flow && rippleOrigin) {
    const ripple = createRainRippleNode({
      localMeters: vec2(terrainUv.x, terrainUv.y).mul(chunkWorldSize),
      originMeters: rippleOrigin,
      time,
      rain: seaStateUniforms.rain,
    });
    color = color.add(colorNode(water.highlightColor)
      .mul(ripple.mul(water.rainRipples.strength).mul(waterCoverage).mul(waterlineFade)));
  }

  if (quality.fresnelStrength > 0) {
    const reflected = normalize(positionWorld.sub(cameraPosition)).reflect(sea?.normal ?? vec3(0, 1, 0));
    const sky = mix(colorNode('#81a8b4'), colorNode('#38658a'), smoothstep(0, 0.7, reflected.y))
      .mul(skyLightUniforms.reflectionTint);
    // The reflected sky takes the current look's tint (dusk, night, overcast).
    color = mix(
      color,
      reflections ? reflections.sample(reflected, sky, float(0.65),
        sea ? waterRippleRefraction(sea.normal, vec3(0, 1, 0)).mul(0.014) : vec2(0), sea?.roughness ?? float(.15)) : sky,
      clamp(river ? surfaceReflection.mul(oneMinus(inland)) : surfaceReflection, 0, 1),
    );
  }
  if (river) {
    // The donor's own Fresnel over its sky, damped on a fall's white face.
    color = mix(
      color,
      reflections ? reflections.sample(river.reflected, river.sky.mul(skyLightUniforms.reflectionTint),
        oneMinus(smoothstep(0.05, 0.2, currentStrength)).mul(oneMinus(fall)),
        waterRippleRefraction(river.normal, river.baseNormal).mul(0.014), river.roughness)
        : river.sky.mul(skyLightUniforms.reflectionTint),
      river.fresnel.mul(oneMinus(fall.mul(0.85))).mul(reflectionVisibility).mul(inland),
    );
  }

  if (sea && quality.foam && water.foam.enabled) {
    const coast = createCoastSwashNodes({ localXZ, patternOrigins: surfacePatterns,
      groundHeight: waterField.g.add(waterSurfaceOrigin).sub(waterField.b),
      config: { ...DEFAULT_COAST_SWASH, ...water.coast }, clock: time,
      shorelineFadeDepth: water.optics.shorelineFadeDepth });
    const swashFoam = coast ? coast.foam.mul(water.coast?.foamStrength ?? DEFAULT_COAST_SWASH.foamStrength).mul(sea.mask) : float(0);
    const whitecap = max(max(sea.whitecap(), sea.surfFoam ?? float(0)), swashFoam).mul(waterCoverage);
    foamAmount = max(foamAmount, whitecap);
    whitewater = whitewater ? max(whitewater, whitecap) : whitecap;
  }

  if (quality.foam && water.foam.enabled) {
    // Aerated falls and plunge pools are paler than calm bank foam, as in the
    // reference. Foam is a surface layer: shallow transparent water must not
    // make the foam transparent a second time.
    const aeration = whitewater && fallPlunge
      ? max(fallPlunge.x, clamp(fallPlunge.y.mul(1.5), 0, 1)) : float(0);
    const inlandFoamColor = mix(colorNode(water.foam.color), colorNode('#e4f5ff'), aeration);
    const foamColor = sea ? mix(inlandFoamColor, colorNode(water.coast?.foamColor ?? '#edf8fb'), sea.mask) : inlandFoamColor;
    const foamed = compositeWaterFoam(color, alpha, foamColor,
      clamp(foamAmount, 0, 1).mul(waterlineFade));
    color = foamed.color;
    alpha = foamed.opacity;
  }

  // Light through a backlit crest, after grass-test's crest transmission: the glow
  // through a wave seen edge-on with the sun beyond it. Added after the reflection,
  // because it is light that came through the water rather than off it.
  if (sea && (water.sea.crestTransmission ?? 0) > 0) {
    const viewDirection = normalize(cameraPosition.sub(positionWorld));
    const transmission = sea.transmissionAmount(viewDirection);
    color = mix(
      color,
      colorNode(water.sea.crestColor ?? '#8fd0a8'),
      clamp(transmission, 0, 1),
    );
  }

  // The offset lifts the sheet clear of the bed so shallow water cannot z-fight
  // with it. Applied at full strength it also floats the sheet over the beach:
  // the bank rises through a flat surface, so on a 1:16 shore 0.12 m of lift
  // still hangs two metres inland. That overhang is what alpha had to cut, and
  // alpha only resolves at the 2 m cell grid the field is stored on, which is
  // what made the bank polygonal. Tapering the lift out as the body thins sets
  // the sheet down onto the bed exactly at the waterline, so the terrain
  // occludes the rest per pixel and the bank follows the contour, not the grid.
  let surfaceHeight = waterField.g.add(waterSurfaceOrigin)
    .add(float(water.heightOffset).mul(waterlineFade));
  // Waves die out over the last metre of depth. A vertex just off the bank
  // otherwise bobbed while its dry neighbour sat at water level, and the flat
  // triangle between them rose over the sand as a pale, straight-edged wedge.
  const swing = smoothstep(0.25, 1.2, waterDepth);
  if (sea) surfaceHeight = surfaceHeight.add(sea.displacement.mul(swing));
  if (water.riverSurface?.enabled && quality.flow) {
    const phases = LAKE_WAVES.map((_, i) => surfacePatterns.wavePhase(`lakeWave${i}`, localXZ));
    surfaceHeight = surfaceHeight.add(lakeWaveRise(phases, time)
      .mul(oneMinus(clamp(currentStrength.mul(4), 0, 1)))
      .mul(sea ? oneMinus(sea.mask) : float(1)).mul(swing));
  }
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    // Side is assigned by StylizedWaterSlot (DoubleSide) so the surface stays
    // visible from underwater. Do not set FrontSide here.
    // The default back-then-front pair would submit every wet chunk twice for
    // a height field that shows one face at any pixel.
    forceSinglePass: true,
  });
  if (sea?.release) {
    const dispose = () => {
      sea.release();
      material.removeEventListener('dispose', dispose);
    };
    material.addEventListener('dispose', dispose);
  }
  material.positionNode = positionLocal.add(vec3(0, 0, surfaceHeight));
  // Unlit, so it dims with the sky's light itself.
  let lit = color.mul(skyLightUniforms.brightness);
  // The sun's glint is its own light, not the sky's: added after the dimming.
  if (river) {
    lit = lit.add(river.glint.mul(skyLightUniforms.sunColor)
      .mul(inland).mul(waterCoverage).mul(reflectionVisibility)
      .mul(oneMinus(clamp(foamAmount, 0, 1))));
  }
  if (sea) {
    lit = lit.add(sea.glint(normalize(cameraPosition.sub(positionWorld))).mul(skyLightUniforms.sunColor)
      .mul(sea.mask).mul(waterCoverage).mul(reflectionVisibility)
      .mul(oneMinus(clamp(foamAmount, 0, 1))));
  }
  material.colorNode = lit;
  material.opacityNode = alpha;
  material.alphaTest = 0.02;
  assignWaterMaterialData(material);
  // Local sources own water's reflection response. SSR remains available to other surfaces.
  if (reflections) assignMaterialData(material, { ...material.userData.postProcessingMaterialData, reflectionClass: REFLECTION_CLASSES.NONE });
  return material;
}
