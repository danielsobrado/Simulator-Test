import * as THREE from 'three/webgpu';
import {
  abs,
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  oneMinus,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { resolveWaterQualityFeatures } from '../water/WaterQuality.js';
import { stylizedFbm } from './StylizedNoiseNodes.js';
import { createSurfaceClassNodes } from './SurfaceMaskNodes.js';

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

function neighborDistance(p, time, cellSpeed, offsetX, offsetZ) {
  const integer = floor(p);
  const fraction = fract(p);
  const neighbor = vec2(offsetX, offsetZ);
  const point = cellPoint(hash2(integer.add(neighbor)), time, cellSpeed);
  return length(neighbor.add(point).sub(fraction));
}

function voronoiF1(p, time, cellSpeed) {
  let nearest = neighborDistance(p, time, cellSpeed, -1, -1);
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 0, -1));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 1, -1));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, -1, 0));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 0, 0));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 1, 0));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, -1, 1));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 0, 1));
  nearest = min(nearest, neighborDistance(p, time, cellSpeed, 1, 1));
  return nearest;
}

function smoothMin(a, b, k) {
  const h = max(k.sub(abs(a.sub(b))), 0).div(k);
  return min(a, b).sub(h.mul(h).mul(h).mul(k).div(6));
}

function voronoiSmoothF1(p, time, cellSpeed, smoothness) {
  let result = neighborDistance(p, time, cellSpeed, -1, -1);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 0, -1), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 1, -1), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, -1, 0), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 0, 0), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 1, 0), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, -1, 1), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 0, 1), smoothness);
  result = smoothMin(result, neighborDistance(p, time, cellSpeed, 1, 1), smoothness);
  return result;
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
}) {
  const water = config.water;
  const quality = resolveWaterQualityFeatures(water);
  const terrainUv = uv();
  const fieldUv = terrainUv
    .mul((waterFieldSize - 1) / waterFieldSize)
    .add(0.5 / waterFieldSize);
  const surface = texture(surfaceMaskTexture, terrainUv);
  const exactCoverage = createSurfaceClassNodes(surface).water;
  const waterField = texture(waterFieldTexture, fieldUv);
  const waterCoverage = max(exactCoverage, clamp(waterField.r, 0, 1));
  const worldXZ = vec2(
    chunkCenter.x.add(terrainUv.x.sub(0.5).mul(chunkWorldSize)),
    chunkCenter.y.add(float(0.5).sub(terrainUv.y).mul(chunkWorldSize)),
  );
  const fallbackFlow = vec2(water.flowX, water.flowZ);
  let currentFlow = fallbackFlow;
  if (quality.flow) {
    const encodedFlow = texture(waterFlowTexture, fieldUv).rg;
    const decodedCellFlow = encodedFlow.mul(2).sub(1);
    const decodedFlow = vec2(decodedCellFlow.x, decodedCellFlow.y.negate());
    const currentMask = step(0.05, length(decodedFlow));
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

  const noiseFac = stylizedFbm(
    worldXZ.mul(water.noiseScale).add(noiseOffset),
  );
  const distort = noiseFac.sub(0.5).mul(water.distortAmount);
  const sampleUv = worldXZ.mul(water.scale)
    .add(surfaceOffset)
    .add(vec2(distort, distort));

  const edge = voronoiF1(sampleUv, time, water.cellSpeed)
    .sub(voronoiSmoothF1(sampleUv, time, water.cellSpeed, float(water.cellSmoothness)));
  const ramp = smoothstep(
    water.edgeThreshold - water.edgeSoftness,
    water.edgeThreshold + water.edgeSoftness,
    edge,
  );

  const midPos = max(float(water.midPos), 1e-4);
  const seg0 = clamp(ramp.div(midPos), 0, 1);
  const seg1 = clamp(ramp.sub(midPos).div(max(float(1).sub(midPos), 1e-4)), 0, 1);
  const inSeg1 = step(midPos, ramp);
  let color = mix(
    mix(colorNode(water.deepColor), colorNode(water.midColor), seg0),
    mix(colorNode(water.midColor), colorNode(water.highlightColor), seg1),
    inSeg1,
  );
  if (quality.caustics) {
    const caustics = water.caustics;
    const causticUv = worldXZ.mul(caustics.scale)
      .add(currentFlow.mul(time.mul(caustics.speed)));
    const causticNoise = stylizedFbm(causticUv);
    const shallow = oneMinus(smoothstep(
      caustics.depthFadeStart,
      caustics.depthFadeEnd,
      waterField.b,
    ));
    const causticAmount = pow(clamp(causticNoise, 0, 1), caustics.contrast)
      .mul(caustics.intensity * quality.causticStrength)
      .mul(shallow);
    color = color.add(colorNode(water.highlightColor).mul(causticAmount));
  }

  const distance = length(positionWorld.xz.sub(cameraPosition.xz));
  const fade = oneMinus(pow(clamp(distance.div(water.fadeDistance), 0, 1), water.fadeStrength));
  const alpha = mix(float(water.deepOpacity), float(water.opacity), ramp)
    .mul(fade)
    .mul(waterCoverage);
  const surfaceHeight = waterField.g.add(waterSurfaceOrigin).add(water.heightOffset);

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
  return material;
}
