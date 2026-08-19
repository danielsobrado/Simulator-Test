import {
  clamp,
  float,
  mix,
  oneMinus,
  smoothstep,
  vec3,
} from 'three/tsl';

export function createTerrainWeatheringState({
  terrainShape,
  wetness,
  canopy,
  shoreline,
  cameraDistance,
  weathering,
}) {
  if (!weathering?.enabled) {
    return {
      colorMultiplier: vec3(1),
      roughnessOffset: float(0),
    };
  }

  const visibility = oneMinus(smoothstep(
    weathering.fadeStartDistance,
    weathering.fadeEndDistance,
    cameraDistance,
  ));
  const curvature = clamp(terrainShape.g.mul(8).add(0.5), 0, 1);
  const concavity = smoothstep(0.52, 0.84, curvature);
  const exposure = oneMinus(canopy)
    .mul(oneMinus(wetness))
    .mul(mix(1, 0.62, smoothstep(0.28, 0.68, terrainShape.r)));
  const retainedMoisture = wetness.mul(mix(0.45, 1, concavity));
  const shorelineDeposit = shoreline.mul(oneMinus(wetness.mul(0.35)));

  const lift = exposure.mul(weathering.exposureBleach)
    .add(shorelineDeposit.mul(weathering.shorelineDeposit));
  const darken = retainedMoisture.mul(weathering.wetDarkening)
    .add(concavity.mul(weathering.concavityDarkening));
  const multiplier = clamp(
    float(1).add(lift).sub(darken).mul(visibility).add(oneMinus(visibility)),
    0.72,
    1.22,
  );
  const roughnessOffset = exposure.mul(weathering.roughnessResponse)
    .add(concavity.mul(weathering.roughnessResponse * 0.45))
    .sub(retainedMoisture.mul(weathering.roughnessResponse * 0.55))
    .mul(visibility);

  return {
    colorMultiplier: vec3(multiplier),
    roughnessOffset,
  };
}

export function applyTerrainWeatheringColor(color, state) {
  return clamp(color.mul(state.colorMultiplier), vec3(0), vec3(1));
}
