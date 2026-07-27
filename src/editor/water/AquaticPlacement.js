import { WATER_KIND_NONE } from './WaterConstants.js';

export const AQUATIC_PLACEMENT_ROOTED = 'rooted';
export const AQUATIC_PLACEMENT_SURFACE = 'surface';

const PLACEMENT_MODES = new Set([
  AQUATIC_PLACEMENT_ROOTED,
  AQUATIC_PLACEMENT_SURFACE,
]);

const DEFAULT_RULE = Object.freeze({
  placement: AQUATIC_PLACEMENT_ROOTED,
  minimumCoverage: 0.5,
  minimumDepth: 0.05,
  maximumDepth: Number.POSITIVE_INFINITY,
  minimumShoreDistance: 0,
  maximumShoreDistance: Number.POSITIVE_INFINITY,
  maximumCurrent: Number.POSITIVE_INFINITY,
  minimumCurrent: 0,
  allowedKinds: null,
});

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

export function resolveAquaticPlacementRule(layerRule = null, prototypeRule = null) {
  const source = {
    ...DEFAULT_RULE,
    ...(layerRule ?? {}),
    ...(prototypeRule ?? {}),
  };
  if (!PLACEMENT_MODES.has(source.placement)) {
    throw new Error(`Unknown aquatic placement mode: ${String(source.placement)}.`);
  }
  const rule = {
    placement: source.placement,
    minimumCoverage: finiteOr(source.minimumCoverage, DEFAULT_RULE.minimumCoverage),
    minimumDepth: finiteOr(source.minimumDepth, DEFAULT_RULE.minimumDepth),
    maximumDepth: finiteOr(source.maximumDepth, DEFAULT_RULE.maximumDepth),
    minimumShoreDistance: finiteOr(source.minimumShoreDistance, DEFAULT_RULE.minimumShoreDistance),
    maximumShoreDistance: finiteOr(source.maximumShoreDistance, DEFAULT_RULE.maximumShoreDistance),
    maximumCurrent: finiteOr(source.maximumCurrent, DEFAULT_RULE.maximumCurrent),
    minimumCurrent: finiteOr(source.minimumCurrent, DEFAULT_RULE.minimumCurrent),
    allowedKinds: Array.isArray(source.allowedKinds)
      ? Object.freeze([...new Set(source.allowedKinds)])
      : null,
  };
  if (rule.minimumCoverage < 0 || rule.minimumCoverage > 1) {
    throw new Error('Aquatic minimumCoverage must be within [0, 1].');
  }
  for (const [minimum, maximum, label] of [
    [rule.minimumDepth, rule.maximumDepth, 'depth'],
    [rule.minimumShoreDistance, rule.maximumShoreDistance, 'shore distance'],
    [rule.minimumCurrent, rule.maximumCurrent, 'current'],
  ]) {
    if (minimum < 0 || maximum < minimum) {
      throw new Error(`Aquatic ${label} range is invalid.`);
    }
  }
  return Object.freeze(rule);
}

export function evaluateAquaticPlacement({ waterSample, layerRule = null, prototypeRule = null }) {
  if (!waterSample || waterSample.kind === WATER_KIND_NONE) return null;
  const rule = resolveAquaticPlacementRule(layerRule, prototypeRule);
  const current = Math.hypot(waterSample.flowX ?? 0, waterSample.flowZ ?? 0);
  if (!(waterSample.coverage >= rule.minimumCoverage)
      || waterSample.depth < rule.minimumDepth
      || waterSample.depth > rule.maximumDepth
      || waterSample.shoreDistance < rule.minimumShoreDistance
      || waterSample.shoreDistance > rule.maximumShoreDistance
      || current < rule.minimumCurrent
      || current > rule.maximumCurrent
      || (rule.allowedKinds && !rule.allowedKinds.includes(waterSample.kind))) {
    return null;
  }
  const placementHeight = rule.placement === AQUATIC_PLACEMENT_SURFACE
    ? waterSample.surfaceHeight
    : waterSample.bedHeight;
  return Object.freeze({
    waterPlacement: rule.placement,
    waterPlacementHeight: placementHeight,
    waterKind: waterSample.kind,
    waterBodyId: waterSample.bodyId,
    waterDepth: waterSample.depth,
    waterShoreDistance: waterSample.shoreDistance,
    waterFlowX: waterSample.flowX,
    waterFlowZ: waterSample.flowZ,
  });
}
