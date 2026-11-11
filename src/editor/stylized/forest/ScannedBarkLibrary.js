import { createProceduralBarkTextures, createScannedBarkTextures } from './ProceduralBarkTextures.js';

const SUFFIXES = Object.freeze(['albedo-height', 'normal-roughness']);

/**
 * Loads the configured scanned bark pairs (`assets.barkScans`, profile → path
 * stem). A pair that fails to load is reported once and left out, so its
 * profile keeps the procedural texture: bark never fails the tree bootstrap.
 *
 * @returns {Promise<Map<string, { profile: string, albedoHeight: object, normalRoughness: object }>>}
 */
export async function loadScannedBarkTextures({ scans = {}, loadTexture, resolveUrl = (path) => path }) {
  const entries = Object.entries(scans ?? {});
  const loaded = await Promise.all(entries.map(async ([profile, stem]) => {
    const results = await Promise.allSettled(
      SUFFIXES.map((suffix) => loadTexture(resolveUrl(`${stem}-${suffix}.png`))),
    );
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      for (const result of results) result.value?.dispose?.();
      console.warn(`Scanned bark for "${profile}" failed to load; using the procedural texture.`, failure.reason);
      return null;
    }
    const [albedoHeight, normalRoughness] = results.map((result) => result.value);
    return [profile, createScannedBarkTextures({ profile, albedoHeight, normalRoughness })];
  }));
  return new Map(loaded.filter(Boolean));
}

/**
 * Bark textures for one tree variant: the profile's scan when one is loaded,
 * else a procedural pair, else null when the variant names no profile.
 * `owned` says whether the caller must dispose the pair (a scan is shared by
 * every variant of its profile and is disposed once, by whoever loaded it).
 */
export function barkTexturesForVariant(definition, scans, createProcedural = createProceduralBarkTextures) {
  if (!definition.barkProfile) return { textures: null, owned: false };
  const scan = scans?.get(definition.barkProfile);
  if (scan) return { textures: scan, owned: false };
  return {
    textures: createProcedural({ profile: definition.barkProfile, seed: definition.barkSeed }),
    owned: true,
  };
}
