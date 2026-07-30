export const POST_PROCESSING_EFFECT_KEYS = Object.freeze([
  'antiAliasing',
  'bloom',
  'toneMapping',
  'sharpen',
  'ssr',
  'screenSpaceShafts',
  'depthOfField',
  'vignette',
  'grain',
]);

function topologyScale(value, fallback, minimum, maximum) {
  const number = Number(value);
  const normalized = Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(number) ? number : fallback),
  );
  return normalized.toFixed(3);
}

/**
 * Pure, Node-runnable graph identity. Uniform-only changes are excluded;
 * compile-time loop counts and render-target allocation scales are included.
 */
export function createPostProcessingTopologySignature(settings) {
  const enabled = settings?.enabled === true;
  let signature = enabled ? 'post:1|mrt:1' : 'post:0|mrt:0';
  for (const key of POST_PROCESSING_EFFECT_KEYS) {
    signature += `|${key}:${settings?.[key]?.enabled === true ? 1 : 0}`;
  }
  const aaMode = enabled && settings?.antiAliasing?.enabled === true
    ? settings.antiAliasing.mode
    : 'off';
  signature += `|aaMode:${aaMode}`;
  const renderScale = aaMode === 'traau'
    ? topologyScale(settings?.renderScale, 1, 0.67, 1)
    : '1.000';
  signature += `|renderScale:${renderScale}`;

  const requestedBloomLevels = Number(settings?.bloom?.levels);
  const bloomLevels = enabled && settings?.bloom?.enabled === true
    ? Math.max(
      2,
      Math.min(
        6,
        Math.round(Number.isFinite(requestedBloomLevels) ? requestedBloomLevels : 4),
      ),
    )
    : 'off';
  signature += `|bloomLevels:${bloomLevels}`;

  const toneMappingMode = enabled && settings?.toneMapping?.enabled === true
    ? settings.toneMapping.mode
    : 'none';
  signature += `|toneMode:${toneMappingMode}`;

  const ssrScale = enabled && settings?.ssr?.enabled === true
    ? topologyScale(settings.ssr.resolutionScale, 0.5, 0.25, 0.75)
    : 'off';
  signature += `|ssrScale:${ssrScale}`;

  const shaftScale = enabled && settings?.screenSpaceShafts?.enabled === true
    ? topologyScale(settings.screenSpaceShafts.resolutionScale, 0.5, 0.25, 0.75)
    : 'off';
  signature += `|shaftScale:${shaftScale}`;
  const shaftSamples = enabled && settings?.screenSpaceShafts?.enabled === true
    ? Math.max(8, Math.min(48, Math.round(settings.screenSpaceShafts.samples)))
    : 'off';
  signature += `|shaftSamples:${shaftSamples}`;

  const dofTaps = enabled && settings?.depthOfField?.enabled === true
    ? Math.max(4, Math.min(32, Math.round(settings.depthOfField.taps ?? 16)))
    : 'off';
  signature += `|dofTaps:${dofTaps}`;

  const diagnosticsEnabled = enabled && settings?.diagnostics?.enabled === true;
  signature += `|debug:${diagnosticsEnabled ? settings.diagnostics.debugView : 'off'}`;
  return signature;
}

export function isPostProcessingEnabled(settings) {
  return settings?.enabled === true;
}
