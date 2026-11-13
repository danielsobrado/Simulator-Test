/** Shared authoring limits for sliders and direct manipulation. */
export function shapeFieldLimits(p, field) {
  const volume = p.kind === 'curved-volume';
  const limits = {
    x: [-256, 256], z: [-256, 256], rotation: [-360, 360], elevation: [0, 32],
    height: volume ? [1, 24] : [0.5, 16],
    thickness: volume ? [0.12, Math.min(p.footprint.width, p.footprint.depth) / 5] : [0.15, 2],
    taper: [volume ? 0.65 : 0.7, 1.2], levels: [1, 8],
    width: [2, 32], depth: [2, 32], radius: [0, Math.min(p.footprint?.width ?? 0, p.footprint?.depth ?? 0) / 2],
    length: [1, 32], bend: [-16, 16], 'path-width': [0.6, 8],
    rise: [Math.max(-8, -p.elevation), 8],
    'roof-rise': [0.2, 12], 'roof-overhang': [0.05, 1.5],
    'roof-sweep': [0, 1], 'roof-sag': [0, 0.5],
    'opening-at': [0, 1], 'opening-bottom': [0, p.height - 0.3],
    'opening-width': [0.1, 5], 'opening-height': [0.3, p.height],
    'base-height': [0.2, Math.max(0.2, p.height)], 'base-out': [0, 2],
    'stage-at': [0.3, Math.max(0.3, p.height - 0.3)], 'stage-out': [-1, 1],
    'crown-projection': [0.1, 1.5], 'crown-height': [0.2, 3], 'crown-corbelSpacing': [0.35, 3], 'crown-corbelDrop': [0.3, 2.5],
    'crown-merlonWidth': [0.3, 3], 'crown-merlonGap': [0.2, 3], 'crown-merlonHeight': [0.3, 2.5], 'crown-ruin': [0, 1],
  };
  if (field === 'elevation' && p.kind === 'traversal') limits.elevation[0] = Math.max(0, -p.rise);
  return limits[field] ?? null;
}

export function shapeFieldEditable(p, field) {
  if (p.footprint?.family === 'custom' && ['width', 'depth', 'radius'].includes(field)) return false;
  if (p.path && ['length', 'bend'].includes(field)) return false;
  return true;
}

export function clampShapeField(p, field, value) {
  const limits = shapeFieldLimits(p, field);
  return limits ? Math.max(limits[0], Math.min(limits[1], value)) : value;
}

export function adaptShapeHeight(p, height) {
  return {
    height,
    // The footing may not outgrow the wall it stands under.
    ...(p.base ? { base: { ...p.base, height: Math.min(p.base.height, Math.max(0.2, height)) } } : {}),
    openings: p.openings.map((o) => {
      const openingHeight = Math.min(o.height, height);
      return { ...o, height: openingHeight, bottom: Math.min(o.bottom, height - openingHeight) };
    }),
  };
}
