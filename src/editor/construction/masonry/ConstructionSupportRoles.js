/** Structural support roles for masonry placements. */
export const CONSTRUCTION_SUPPORT_ROLE = Object.freeze({
  FIELD: 'field',
  FOUNDATION: 'foundation',
  JAMB: 'jamb',
  ARCH: 'arch',
  KEYSTONE: 'keystone',
  COPING: 'coping',
  QUOIN: 'quoin',
  MERLON: 'merlon',
});

/** Primary reasons a ruined placement was removed. */
export const RUIN_REMOVAL_REASON = Object.freeze({
  MACRO_CLIP: 'macro-clip',
  CLUSTER_DAMAGE: 'cluster-damage',
  UNSUPPORTED: 'unsupported',
  EXCESSIVE_CANTILEVER: 'excessive-cantilever',
  BRIDGE_SPAN: 'bridge-span',
  PINNACLE: 'pinnacle',
  ARCH_UNSUPPORTED: 'arch-unsupported',
  ABOVE_ENVELOPE: 'above-envelope',
});
