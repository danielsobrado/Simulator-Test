import * as THREE from 'three/webgpu';
import {
  abs,
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  length,
  linearDepth,
  max,
  min,
  mix,
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
import { stylizedFbm2 } from './StylizedNoiseNodes.js';
import { createSurfaceClassNodes } from './SurfaceMaskNodes.js';

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

function hash2(position) {
  const mixed = vec2(
    dot(position, vec2(127.1, 311.7)),
    dot(position, vec2(269.5, 183.3)),
  );
  return fract(sin(mixed).mul(43758.5453));
}

function cellPoint(seed, time, cellSpeed) {
  return float(0.5).add(float(0.5).mul(sin(time.mul(cellSpeed).add(seed.mul(6.2831)))));
}

function neighborDistance(integer, fraction, time, cellSpeed, offsetX, offsetZ) {
  const neighbor = vec2(offsetX, offsetZ);
  const point = cellPoint(hash2(integer.add(neighbor)), time, cellSpeed);
  return length(neighbor.add(point).sub(fraction));
}

function voronoiDistances(position, time, cellSpeed) {
  const integer = floor(position);
  const fraction = fract(position);
  return [
    neighborDistance(integer, fraction, time, cellSpeed, -1, -1),
    neighborDistance(integer, fraction, time, cellSpeed, 0, -1),
    neighborDistance(integer, fraction, time, cellSpeed, 1, -1),
    neighborDistance(integer, fraction, time, cellSpeed, -1, 0),
    neighborDistance(integer, fraction, time, cellSpeed, 0, 0),
    neighborDistance(integer, fraction, time, cellSpeed, 1, 0),
    neighborDistance(integer, fraction, time, cellSpeed, -1, 1),
    neighborDistance(integer, fraction, time, cellSpeed, 0, 1),
    neighborDistance(integer, fraction, time, cellSpeed, 1, 1),
  ];
}

function smoothMin(a, b, k) {
  const h = max(k.sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(h).mul(k).div(6));
}

function voronoiF1(position, time, cellSpeed) {
  const distances = voronoiDistances(position, time, cellSpeed);
  let nearest = distances[0];
  for (let index = 1; index < distances.length; index += 1) {
    nearest = min(nearest, distances[index]);
  }
  return nearest;
}

function voronoiMetrics(position, time, cellSpeed, smoothness) {
  const distances = voronoiDistances(position, time, cellSpeed);
  let nearest = distances[0];
  let smoothNearest = distances[0];
  for (let index = 1; index < distances.length; index += 1) {
    nearest = min(nearest, distances[index]);
    smoothNearest = smoothMin(smoothNearest, distances[index], smoothness);
  }
  return { nearest, smoothNearest };
}

function refractionWarp(coarsePoint, finePoint) {
  const coarse = stylizedFbm2(coarsePoint).sub(0.5).mul(2);
  const fine = stylizedFbm2(finePoint).sub(0.5).mul(2);
  return vec2(
    coarse.mul(0.7).add(fine.mul(0.3)),
    coarse.mul(-0.35).add(fine.mul(0.65)),
  );
}

export function createStylizedWaterMaterial({
  surfaceMaskTexture,
  waterFieldTexture,
  waterFlowTexture,
  waterFieldSize,
  waterSurfaceOrigin,
  chunkCenter,
  chunkWorldSize,
  time,
  config,
  // Build-time opt-out. Sampling the viewport colour and depth textures makes
  // the renderer copy both buffers for the whole frame, and it does so as soon
  // as a material carrying those nodes is used at all — hiding the mesh does
  // not avoid it. Chunks far from the camera get a variant built without the
  // branch so a player away from water pays nothing.
  enableRefraction = true,
}) {
  const water = config.water;
  const quality = resolveWaterQualityFeatures(water);
  const terrainUv = uv();
  const fieldUv = terrainUv
    .mul((waterFieldSize - 1) / waterFieldSize)
    .add(0.5 / waterFieldSize);
  const surface = texture(surfaceMaskTexture, terrainUv);
  const exactCoverage = createSurfaceClassNodes(surface).waterCoverage;
  const waterField = texture(waterFieldTexture, fieldUv);
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
  const worldXZ = vec2(
    chunkCenter.x.add(terrainUv.x.sub(0.5).mul(chunkWorldSize)),
    chunkCenter.y.add(float(0.5).sub(terrainUv.y).mul(chunkWorldSize)),
  );
  const fallbackFlow = vec2(water.flowX, water.flowZ);
  let currentFlow = fallbackFlow;
  let currentStrength = float(0);
  if (quality.flow) {
    const encodedFlow = texture(waterFlowTexture, fieldUv).rg;
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

  const noisePoint = worldXZ.mul(water.noiseScale).add(noiseOffset);
  const surfaceNoise = vec2(
    stylizedFbm2(noisePoint),
    stylizedFbm2(noisePoint.add(vec2(
      SURFACE_NOISE_OFFSET[0],
      SURFACE_NOISE_OFFSET[1],
    ))),
  );
  const noiseFac = surfaceNoise.x.add(surfaceNoise.y).mul(0.5);
  const distort = surfaceNoise.sub(0.5).mul(water.distortAmount);
  const sampleUv = worldXZ.mul(water.scale)
    .add(surfaceOffset)
    .add(distort);

  let ramp = smoothstep(LOW_SURFACE_RAMP_MIN, LOW_SURFACE_RAMP_MAX, noiseFac);
  if (quality.cellularSurface) {
    const metrics = voronoiMetrics(
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
      optics.maximumOpticalDistance,
    );
    const transmission = exp(opticalDistance.mul(-optics.absorptionDensity));
    const absorbed = oneMinus(transmission);
    bedVisibility = transmission;
    const depthMix = smoothstep(optics.shallowDepth, optics.deepDepth, waterDepth);
    const depthColor = mix(
      colorNode(optics.shallowColor),
      colorNode(optics.deepColor),
      depthMix,
    );
    bodyColor = mix(
      depthColor,
      colorNode(optics.underwaterColor),
      underwaterBlend.mul(optics.underwaterTintStrength),
    );
    surfaceDetailMix = float(optics.surfaceDetailStrength).mul(fade).mul(waterlineFade);
    surfaceReflection = pow(oneMinus(viewCosine), FRESNEL_POWER)
      .mul(quality.fresnelStrength)
      .mul(oneMinus(underwaterBlend))
      .mul(fade)
      .mul(waterlineFade);
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
    const flowPhase = dot(worldXZ, currentFlow)
      .mul(foam.flowBandScale)
      .sub(time.mul(foam.flowBandSpeed));
    const flowBand = pow(
      sin(flowPhase).mul(0.5).add(0.5),
      foam.flowBandContrast,
    ).mul(currentStrength).mul(foam.flowStrength);
    const noiseBreakup = mix(
      float(1),
      smoothstep(0.18, 0.82, noiseFac),
      foam.noiseStrength,
    );
    foamAmount = max(shoreBand, flowBand)
      .mul(noiseBreakup)
      .mul(foam.intensity * quality.foamStrength)
      .mul(waterCoverage);
  }

  if (enableRefraction && quality.refraction && water.refraction.enabled) {
    const refraction = water.refraction;
    const coarsePoint = worldXZ
      .mul(refraction.coarseScale)
      .add(currentFlow.mul(time.mul(refraction.coarseSpeed)));
    const finePoint = worldXZ
      .mul(refraction.fineScale)
      .sub(currentFlow.mul(time.mul(refraction.fineSpeed)))
      .add(vec2(REFRACTION_FINE_OFFSET[0], REFRACTION_FINE_OFFSET[1]));
    const depthFactor = smoothstep(
      refraction.depthFadeStart,
      refraction.depthFadeEnd,
      waterDepth,
    );
    const distortionUv = refractionWarp(coarsePoint, finePoint)
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
    const validDepth = step(
      waterViewDistance.add(refraction.depthBiasMeters),
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
    const coefficients = vec3(
      refraction.absorptionCoefficients[0],
      refraction.absorptionCoefficients[1],
      refraction.absorptionCoefficients[2],
    );
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
        .mul(foam.intersectionStrength * quality.intersectionFoamStrength)
        .mul(waterCoverage);
      foamAmount = max(foamAmount, intersectionFoam);
    }
  }

  if (quality.caustics) {
    const caustics = water.caustics;
    const causticUv = worldXZ.mul(caustics.scale)
      .add(currentFlow.mul(time.mul(caustics.speed)));
    // A ring band around each voronoi point, not FBM. Light focused by a rippled
    // surface lands on the bed as a web of thin filaments; FBM can only make
    // soft blobs, which is why the water read as flat tint from above however
    // much the intensity was raised. Isolating one radius of the F1 distance
    // field draws a ring per cell, and neighbouring rings overlap into that web
    // — for one voronoi rather than the two a border metric would need. The
    // cell points drift on their own clock, so the web crawls.
    const causticRing = abs(
      voronoiF1(causticUv, time, caustics.speed).sub(CAUSTIC_RING_RADIUS),
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

  if (quality.fresnelStrength > 0) {
    color = mix(
      color,
      colorNode(water.highlightColor),
      clamp(surfaceReflection, 0, 1),
    );
  }

  if (quality.foam && water.foam.enabled) {
    color = mix(
      color,
      colorNode(water.foam.color),
      clamp(foamAmount, 0, 1),
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
  const surfaceHeight = waterField.g.add(waterSurfaceOrigin)
    .add(float(water.heightOffset).mul(waterlineFade));
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    // Side is assigned by StylizedWaterSlot (DoubleSide) so the surface stays
    // visible from underwater. Do not set FrontSide here.
  });
  material.positionNode = positionLocal.add(vec3(0, 0, surfaceHeight));
  material.colorNode = color;
  material.opacityNode = alpha;
  material.alphaTest = 0.02;
  return assignWaterMaterialData(material);
}
