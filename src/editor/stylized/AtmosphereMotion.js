import { vec2 } from 'three/tsl';

const CLOUD_DRIFT_Y_RATIO = 0.37;
const CLOUD_EVOLUTION_RATE = 2.4;
const CLOUD_EVOLUTION_Y_RATE = 0.71;
const CLOUD_EVOLUTION_STRENGTH = 0.24;

export function cloudMotionCoordinatesReference({
  projectedX,
  projectedY,
  timeSeconds,
  scale,
  speed,
}) {
  const drift = timeSeconds * speed;
  const phase = drift * CLOUD_EVOLUTION_RATE;
  const baseX = projectedY * 0.83;
  const baseY = projectedX * 0.67;
  return {
    x: projectedX * scale
      + drift
      + (Math.sin(baseX + phase) - Math.sin(baseX)) * CLOUD_EVOLUTION_STRENGTH,
    y: projectedY * scale
      + drift * CLOUD_DRIFT_Y_RATIO
      + (Math.sin(baseY - phase * CLOUD_EVOLUTION_Y_RATE) - Math.sin(baseY))
        * CLOUD_EVOLUTION_STRENGTH,
  };
}

/**
 * Advects the cloud field while gently bending its sampling domain. Translation
 * supplies wind drift; the zero-at-start sine offsets make cloud silhouettes
 * slowly grow and shrink instead of sliding as a rigid painted layer.
 */
export function cloudMotionCoordinatesNode({
  projected,
  timeNode,
  scale,
  speed,
}) {
  const drift = timeNode.mul(speed);
  const phase = drift.mul(CLOUD_EVOLUTION_RATE);
  const baseX = projected.y.mul(0.83);
  const baseY = projected.x.mul(0.67);
  const evolution = vec2(
    baseX.add(phase).sin().sub(baseX.sin()),
    baseY.sub(phase.mul(CLOUD_EVOLUTION_Y_RATE)).sin().sub(baseY.sin()),
  ).mul(CLOUD_EVOLUTION_STRENGTH);
  return projected
    .mul(scale)
    .add(vec2(drift, drift.mul(CLOUD_DRIFT_Y_RATIO)))
    .add(evolution);
}
