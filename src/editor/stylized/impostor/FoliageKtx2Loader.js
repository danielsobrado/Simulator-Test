import { acquireKtx2Loader } from '../../assets/sharedKtx2Loader.js';

/**
 * The renderer's shared KTX2 loader, held for one atlas load; downloads overlap
 * transcoder initialization. Returns `{ loader, release }`, or null when
 * compressed foliage is unavailable.
 */
export function acquireFoliageKtx2Loader(renderer, baseUrl) {
  if (!renderer) return null;
  let held = null;
  try {
    held = acquireKtx2Loader(renderer, baseUrl);
    held.loader.init().catch(() => {}); // loadAsync observes the same failure and uses the raw fallback.
    return held;
  } catch (error) {
    held?.release();
    console.warn('Compressed foliage support unavailable; using baked RGBA mip chains.', error);
    return null;
  }
}

/** Texture payload bytes; excludes driver padding and renderer metadata. */
export function foliageTextureBytes(map) {
  if (map.mipmaps?.length) return map.mipmaps.reduce((sum, mip) => sum + (mip.data?.byteLength ?? 0), 0);
  let width = map.image?.width ?? 0, height = map.image?.height ?? 0, total = 0;
  if (!width || !height) return 0;
  do {
    total += width * height * 4;
    if (!map.generateMipmaps || (width <= 1 && height <= 1)) break;
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  } while (true);
  return total;
}
