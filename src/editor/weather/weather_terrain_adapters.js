import * as THREE from 'three';
import { WATER_KIND_NONE } from '../water/WaterConstants.js';
import { getWorldWater } from '../water/TerrainWaterQueries.js';
export { raycastTerrainHeightfield } from '../spells/spell_terrain_adapter.js';

/**
 * Adapts simulator terrain height and water queries to the weather sampler
 * contract ({ surfaceHeight, surfaceNormal, waterSample }).
 */
export function createWeatherTerrainSamplers(terrainView) {
  const scratchNormal = new THREE.Vector3();

  const surfaceHeight = (x, z) => terrainView.getWorldHeight(x, z);

  const surfaceNormal = (x, z) => {
    const sampleOffset = 0.75;
    const left = surfaceHeight(x - sampleOffset, z);
    const right = surfaceHeight(x + sampleOffset, z);
    const down = surfaceHeight(x, z - sampleOffset);
    const up = surfaceHeight(x, z + sampleOffset);
    scratchNormal.set(
      -(right - left) / (2 * sampleOffset),
      1,
      -(up - down) / (2 * sampleOffset),
    );
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
