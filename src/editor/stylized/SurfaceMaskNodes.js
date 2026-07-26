import { oneMinus, step } from 'three/tsl';

export const SURFACE_CLASSIFICATION_THRESHOLD = 0.5;

export function createSurfaceClassNodes(surface) {
  const grass = step(SURFACE_CLASSIFICATION_THRESHOLD, surface.g);
  const water = step(SURFACE_CLASSIFICATION_THRESHOLD, surface.b);
  return Object.freeze({
    grass,
    water,
    landGrass: grass.mul(oneMinus(water)),
  });
}
