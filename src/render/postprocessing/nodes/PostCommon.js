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

/**
 * Pure, Node-runnable description of graph topology. Parameter values are
 * intentionally excluded: only changes which add or remove nodes rebuild it.
 */
export function createPostProcessingTopologySignature(settings) {
  const enabled = settings?.enabled === true;
  let signature = enabled ? 'post:1|mrt:1' : 'post:0|mrt:0';
  for (const key of POST_PROCESSING_EFFECT_KEYS) {
    signature += `|${key}:${settings?.[key]?.enabled === true ? 1 : 0}`;
  }
  const diagnosticsEnabled = enabled && settings?.diagnostics?.enabled === true;
  signature += `|debug:${diagnosticsEnabled ? settings.diagnostics.debugView : 'off'}`;
  return signature;
}

export function isPostProcessingEnabled(settings) {
  return settings?.enabled === true;
}
