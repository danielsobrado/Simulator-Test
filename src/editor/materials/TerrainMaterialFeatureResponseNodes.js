import * as THREE from 'three/webgpu';
import {
  clamp,
  float,
  mix,
  oneMinus,
  smoothstep,
  vec3,
} from 'three/tsl';
import { createTerrainMaterialFeatureMasks } from './TerrainMaterialFeatureNodes.js';

function colorNode(value) {
  const color = new THREE.Color(value);
  return vec3(color.r, color.g, color.b);
}

export function createTerrainMaterialFeatureState({
  worldXZ,
  materialWeights,
  terrainShape,
  wetness,
  canopy,
  shoreline,
  cameraDistance,
  features,
}) {
  const masks = createTerrainMaterialFeatureMasks({
    worldXZ,
    materialWeights,
    terrainShape,
    wetness,
    canopy,
    shoreline,
    features,
  });
  const visibility = features?.enabled
    ? oneMinus(smoothstep(features.fadeStartDistance, features.fadeEndDistance, cameraDistance))
    : float(0);
  const lichen = masks.lichen.mul(visibility).mul(features?.lichenStrength ?? 0);
  const litter = masks.litter.mul(visibility).mul(features?.litterStrength ?? 0);
  const cracks = masks.cracks.mul(visibility).mul(features?.crackStrength ?? 0);
  const mineral = masks.mineral.mul(visibility).mul(features?.mineralStrength ?? 0);
  const response = features?.roughnessResponse ?? 0;
  return {
    lichen,
    litter,
    cracks,
    mineral,
    roughnessOffset: lichen.mul(response * 0.45)
      .add(litter.mul(response * 0.55))
      .add(cracks.mul(response * 0.35))
      .sub(mineral.mul(response * 0.45)),
    heightOffset: lichen.mul(0.25)
      .add(litter.mul(0.18))
      .sub(cracks.mul(0.8))
      .add(mineral.mul(0.12))
      .mul(features?.heightResponse ?? 0),
  };
}

export function applyTerrainMaterialFeatureColor(color, state, features) {
  if (!features?.enabled) return color;
  let result = mix(color, colorNode(features.lichenColor), state.lichen);
  result = mix(result, colorNode(features.litterColor), state.litter);
  result = mix(result, colorNode(features.crackColor), state.cracks);
  result = mix(result, colorNode(features.mineralColor), state.mineral);
  return clamp(result, vec3(0), vec3(1));
}
