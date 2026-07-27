import * as THREE from 'three';
import { WATER_KIND_NONE } from '../water/WaterConstants.js';
import { getWorldWater } from '../water/TerrainWaterQueries.js';

/**
 * Adapts SimCity terrain height + water queries to the clod-poc weather sampler
 * contract ({ surfaceHeight, surfaceNormal, waterSample }).
 */
export function createWeatherTerrainSamplers(terrainView) {
  const scratchNormal = new THREE.Vector3();

  const surfaceHeight = (x, z) => terrainView.getWorldHeight(x, z);

  const surfaceNormal = (x, z) => {
    const e = 0.75;
    const hL = surfaceHeight(x - e, z);
    const hR = surfaceHeight(x + e, z);
    const hD = surfaceHeight(x, z - e);
    const hU = surfaceHeight(x, z + e);
    scratchNormal.set(-(hR - hL) / (2 * e), 1, -(hU - hD) / (2 * e));
    if (scratchNormal.lengthSq() < 1e-8) scratchNormal.set(0, 1, 0);
    else scratchNormal.normalize();
    return [scratchNormal.x, scratchNormal.y, scratchNormal.z];
  };

  const waterSample = (x, z) => {
    try {
      const sample = getWorldWater(terrainView, x, z);
      const isWater = sample.kind !== WATER_KIND_NONE && sample.coverage > 0.05;
      return {
        depth: isWater ? sample.depth : 0,
        bodyMask: isWater ? Math.max(0.05, sample.coverage) : 0,
        waterY: sample.surfaceHeight,
      };
    } catch {
      return { depth: 0, bodyMask: 0, waterY: surfaceHeight(x, z) };
    }
  };

  return { surfaceHeight, surfaceNormal, waterSample };
}

/**
 * Approximate terrain hit for spell VFX using iterative heightfield plane steps.
 */
export function raycastTerrainHeightfield(terrainView, ray, maxDistance = 40) {
  const origin = ray.origin;
  const direction = ray.direction.clone().normalize();
  if (Math.abs(direction.y) < 1e-5 && Math.abs(direction.x) < 1e-5 && Math.abs(direction.z) < 1e-5) {
    return null;
  }
  let t = 0.5;
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3(0, 1, 0);
  for (let step = 0; step < 24; step += 1) {
    point.copy(origin).addScaledVector(direction, t);
    const height = terrainView.getWorldHeight(point.x, point.z);
    const error = point.y - height;
    if (Math.abs(error) < 0.08) {
      const e = 0.75;
      const hL = terrainView.getWorldHeight(point.x - e, point.z);
      const hR = terrainView.getWorldHeight(point.x + e, point.z);
      const hD = terrainView.getWorldHeight(point.x, point.z - e);
      const hU = terrainView.getWorldHeight(point.x, point.z + e);
      normal.set(-(hR - hL) / (2 * e), 1, -(hU - hD) / (2 * e)).normalize();
      point.y = height;
      return { point: point.clone(), normal: normal.clone(), distance: t };
    }
    t -= error / Math.max(0.2, Math.abs(direction.y) + 0.35);
    if (t < 0.2 || t > maxDistance) return null;
  }
  return null;
}
