import { vec2 } from 'three/tsl';

const CLOUD_DRIFT_Y_RATIO = 0.37;
const CLOUD_EVOLUTION_RATE = 2.4;
const CLOUD_EVOLUTION_Y_RATE = 0.71;
const CLOUD_EVOLUTION_STRENGTH = 0.24;

export function cloudMotionCoordinatesReference({
  projectedX,
  projectedY,
  cameraWorldX = 0,
  cameraWorldZ = 0,
  timeSeconds,
  scale,
  speed,
  worldScale = 1,
}) {
  const drift = timeSeconds * speed;
  const phase = drift * CLOUD_EVOLUTION_RATE;
  const worldBaseX = projectedX * scale + cameraWorldX / worldScale;
  const worldBaseY = projectedY * scale + cameraWorldZ / worldScale;
  const warpBaseX = worldBaseY * 0.83;
  const warpBaseY = worldBaseX * 0.67;
  return {
    x: worldBaseX
      + drift
      + (Math.sin(warpBaseX + phase) - Math.sin(warpBaseX))
        * CLOUD_EVOLUTION_STRENGTH,
    y: worldBaseY
      + drift * CLOUD_DRIFT_Y_RATIO
      + (Math.sin(warpBaseY - phase * CLOUD_EVOLUTION_Y_RATE) - Math.sin(warpBaseY))
        * CLOUD_EVOLUTION_STRENGTH,
  };
}

/**
 * Anchors the cloud field to canonical world space, then advects and gently
 * bends its sampling domain. The camera offset creates travel parallax without
 * making the sky dome finite; the zero-at-start sine offsets make silhouettes
 * grow and shrink instead of sliding as a rigid painted layer.
 */
export function cloudMotionCoordinatesNode({
  projected,
  cameraWorldPosition,
  timeNode,
  scale,
  speed,
  worldScale,
}) {
  const drift = timeNode.mul(speed);
  const phase = drift.mul(CLOUD_EVOLUTION_RATE);
  const worldBase = projected
    .mul(scale)
    .add(cameraWorldPosition.div(worldScale));
  const warpBaseX = worldBase.y.mul(0.83);
  const warpBaseY = worldBase.x.mul(0.67);
  const evolution = vec2(
    warpBaseX.add(phase).sin().sub(warpBaseX.sin()),
    warpBaseY
      .sub(phase.mul(CLOUD_EVOLUTION_Y_RATE))
      .sin()
      .sub(warpBaseY.sin()),
  ).mul(CLOUD_EVOLUTION_STRENGTH);
  return worldBase
    .add(vec2(drift, drift.mul(CLOUD_DRIFT_Y_RATIO)))
    .add(evolution);
}
