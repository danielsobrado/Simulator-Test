export const RUNTIME_ASSET_PROFILE_VERSION = 2;

/**
 * Colour/normal texture ceiling per tier.
 *
 * Transcoding dominates asset startup — 1024² KTX2 textures cost a median
 * 270 ms each on the transcoder workers, and the scatter layers contribute most
 * of the count. Halving the dimension quarters the block count for props that
 * are drawn small and in bulk; trees stay at the full size because the camera
 * stands next to them.
 */
export const RUNTIME_TEXTURE_TIERS = Object.freeze({
  hero: 1024,
  scatter: 512,
});

function commonArgs(colorLimit) {
  return Object.freeze([
    '-cc',
    '-kn',
    '-km',
    '-ke',
    '-vpf',
    '-tq',
    '8',
    '-tl',
    'color,normal',
    String(colorLimit),
    '-tl',
    'attrib',
    // Data textures are already the smaller half of the budget and are read for
    // their values rather than their detail, so they stay where they were.
    String(Math.min(512, colorLimit)),
    '-tj',
    '1',
  ]);
}

function profile(description, colorLimit, uastcTargets, etc1sTargets) {
  return Object.freeze({
    description,
    args: Object.freeze([
      ...commonArgs(colorLimit),
      '-tc',
      etc1sTargets,
      '-tu',
      uastcTargets,
    ]),
  });
}

export const RUNTIME_ASSET_PROFILES = Object.freeze({
  standard: profile(
    'ETC1S colour/data with UASTC normals.',
    RUNTIME_TEXTURE_TIERS.hero,
    'normal',
    'color,attrib',
  ),
  alphaCritical: profile(
    'UASTC colour/alpha and normals with ETC1S data textures.',
    RUNTIME_TEXTURE_TIERS.hero,
    'color,normal',
    'attrib',
  ),
  standardScatter: profile(
    'ETC1S colour/data with UASTC normals, half-size maps for scatter props.',
    RUNTIME_TEXTURE_TIERS.scatter,
    'normal',
    'color,attrib',
  ),
  alphaCriticalScatter: profile(
    'UASTC colour/alpha and normals with ETC1S data, half-size maps for scatter props.',
    RUNTIME_TEXTURE_TIERS.scatter,
    'color,normal',
    'attrib',
  ),
});

export function selectRuntimeAssetProfile(sourceJson, textureTier = 'hero') {
  const hasCutoutOrBlendMaterial = (sourceJson.materials ?? []).some(
    (material) => (material.alphaMode ?? 'OPAQUE') !== 'OPAQUE',
  );
  const base = hasCutoutOrBlendMaterial ? 'alphaCritical' : 'standard';
  return textureTier === 'scatter' ? `${base}Scatter` : base;
}

export function runtimeAssetProfile(name) {
  const profileDefinition = RUNTIME_ASSET_PROFILES[name];
  if (!profileDefinition) throw new Error(`Unknown runtime asset profile "${name}".`);
  return profileDefinition;
}
