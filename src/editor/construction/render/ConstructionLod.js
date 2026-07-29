import { projectedPixelHeight, selectProjectedLod } from '../../stylized/lod/projectedLod.js';

export {
  amplifyCoarseJoints,
  coarsePlacements,
  selectDominantPlacement,
} from './ConstructionCoarsePlacements.js';

/**
 * LOD band selection for construction modules.
 *
 * Uses the shared projected-pixel selector so walls and neighbouring assets
 * follow the same hysteresis behaviour.
 */
export const CONSTRUCTION_LOD_BANDS = Object.freeze(['near', 'coarse', 'shell']);

export const DEFAULT_CONSTRUCTION_LOD = Object.freeze({
  nearPixels: 140,
  coarsePixels: 35,
  hysteresisRatio: 0.15,
});

const TO_SHARED = Object.freeze({ near: 'near', coarse: 'proxy', shell: 'impostor' });
const FROM_SHARED = Object.freeze({
  near: 'near',
  proxy: 'coarse',
  impostor: 'shell',
  cluster: 'shell',
  culled: 'shell',
});

export function selectConstructionLod({
  pixels,
  previous = null,
  thresholds = DEFAULT_CONSTRUCTION_LOD,
  pinned = false,
}) {
  if (pinned) return 'near';
  const band = selectProjectedLod({
    pixels,
    previous: previous ? TO_SHARED[previous] : null,
    hysteresisRatio: thresholds.hysteresisRatio,
    nearPixels: thresholds.nearPixels,
    proxyPixels: thresholds.coarsePixels,
    impostorPixels: 0,
    clusterPixels: 0,
  });
  return FROM_SHARED[band] ?? 'shell';
}

/**
 * Projected height of a module, converting canonical bounds into render space
 * before comparing them with the camera.
 */
export function moduleProjectedPixels({
  camera,
  module,
  height,
  viewportHeight,
  toRender = null,
  cameraY = 0,
}) {
  const bounds = module.bounds;
  const canonicalX = (bounds.minX + bounds.maxX) / 2;
  const canonicalZ = (bounds.minZ + bounds.maxZ) / 2;
  const rendered = toRender
    ? toRender(canonicalX, canonicalZ)
    : { x: canonicalX, z: canonicalZ };
  return projectedPixelHeight({
    camera,
    worldPosition: { x: rendered.x, y: cameraY, z: rendered.z },
    worldHeight: height,
    viewportHeight,
  });
}
