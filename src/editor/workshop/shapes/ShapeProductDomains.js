export function shapeProductDomains(plan, recipe) {
  if (plan.primitive.kind === 'traversal') return ['traversal'];
  return [
    'walls',
    'ground',
    ...(plan.features?.length ? ['features'] : []),
    ...(plan.primitive.roof ? ['roof'] : []),
    ...(plan.crown ? ['crown'] : []),
    ...(plan.primitive.facade === 'timber' || plan.primitive.shutters || plan.decorations?.some((d) => d.role === 'window-box') ? ['facade'] : []),
    ...(plan.supports?.length ? ['supports'] : []),
    ...(recipe.ivy ? ['ivy'] : []),
  ];
}

const openingCut = ({ shutterPose, ...fields }) => { void shutterPose; return fields; };
const body = (primitive, includeOpenings = true, includeShutters = false) => {
  const { roof, openings, suppressed, facade, shutters, automaticGates, craft, chimney, windowBoxes, interior, ivyDensity, features, detailOverrides, age, style, ...fields } = primitive;
  void roof;
  void suppressed;
  void facade;
  void shutters;
  void automaticGates;
  void craft;
  void features;
  void detailOverrides;
  void age; void style;
  void chimney; void windowBoxes; void interior; void ivyDensity;
  return { ...fields, ...(includeOpenings ? { openings: includeShutters ? openings : openings?.map(openingCut) } : {}) };
};

const roofNeighbors = (plan) => (plan.neighbors ?? []).map((n) => ({
  id: n.id, boundary: n.boundary, topBoundary: n.topBoundary, curve: n.curve,
  primitive: { ...body(n.primitive, false), roof: n.primitive.roof },
  roofReplaced: Boolean(n.roofReplaced), roofOnly: Boolean(n.roofOnly),
}));

const featureProducts = (plan) => plan.features.map(({ child, ...feature }) => child
  ? { ...feature, child: { ...child, neighbors: roofNeighbors(child) } }
  : feature);

/** Keys express consumer dependencies, so roof edits do not rebuild masonry. */
export function shapeProductKey(recipe, plan, domain) {
  const p = plan.primitive;
  const neighbors = (plan.neighbors ?? []).map((n) => ({
    id: n.id,
    boundary: n.boundary,
    topBoundary: n.topBoundary,
    roofOnly: Boolean(n.roofOnly),
    primitive: body(n.primitive, false),
  }));
  const shape =
    domain === 'supports'
      ? { id: p.id, label: p.label, supports: plan.supports }
      : domain === 'ground'
        ? { primitive: body(p), ground: plan.ground, neighbors }
      : domain === 'features'
        ? { features: featureProducts(plan), style: plan.resolvedStyle,
            neighbors: plan.features.some((f) => f.solidSupport) ? roofNeighbors(plan) : neighbors }
      : domain === 'crown'
        ? { primitive: body(p, false), neighbors,
            turrets: (plan.features ?? []).filter((f) => f.intent.kind === 'turret').map((f) => [f.frame.u, f.child.primitive.elevation, f.child.primitive.height, f.child.primitive.footprint.width]) }
      : domain === 'roof'
        ? {
            id: p.id,
            label: p.label,
            position: p.position,
            rotation: p.rotation,
            elevation: p.elevation,
            height: p.height,
            thickness: p.thickness,
            taper: p.taper,
            base: p.base, stages: p.stages, crown: p.crown,
            footprint: p.footprint,
            surface: p.surface,
            roof: p.roof,
            replaced: plan.roofReplaced,
            decorations: plan.decorations?.filter((d) => d.role === 'chimney'),
            junctions: plan.roofJunctions,
            neighbors: roofNeighbors(plan),
          }
        : domain === 'facade'
          ? {
              primitive: body(p, true, true),
              facade: p.facade,
              shutters: p.shutters,
              decorations: plan.decorations?.filter((d) => d.role === 'window-box'),
              roof: p.facade === 'timber' ? p.roof : null,
              neighbors,
            }
      : domain === 'ivy'
        ? { primitive: body(p), ivyDensity: p.ivyDensity, openings: plan.openings.map(openingCut), neighbors }
      : domain === 'traversal'
            ? plan
            : {
                primitive: body(p),
                openings: plan.openings.map(openingCut),
                neighbors,
                flatCoping: p.roof?.family === 'flat',
                interior: plan.interior,
                // Masonry courses follow the roof underside, so they rebuild with the roof.
                roof: p.surface === 'masonry' ? [p.roof, Boolean(plan.roofReplaced)] : null,
              };
  const regions = {
    walls: ['walls', 'trim', 'deck', 'inserts', 'glazing', 'metal'],
    roof: ['roof', 'walls', 'trim', 'deck', 'inserts', 'metal', 'flashing'],
    supports: ['supports'],
    crown: ['walls', 'trim', 'deck'],
    ivy: ['foliage'],
    traversal: ['deck', 'trim', 'supports', 'rails'],
    facade: ['inserts', 'foliage', 'metal'],
    features: ['walls', 'roof', 'trim', 'deck', 'inserts', 'glazing', 'metal', 'flashing'],
    ground: ['trim', 'foliage'],
  }[domain];
  const styleProperties = { walls: ['floor', 'trim'], roof: ['floor', 'trim'], ground: ['trim'], crown: ['floor', 'trim'],
    supports: ['supports'], traversal: ['floor', 'trim', 'supports', 'railing'], features: ['floor', 'trim'] }[domain] ?? [];
  const style = Object.fromEntries(styleProperties.map((key) => [key, [plan.resolvedStyle?.values[key], plan.resolvedStyle?.sources[key]]]));
  const overrides = Object.fromEntries(
    Object.entries(recipe.materialAreaOverrides ?? {}).filter(
      ([id]) => (id.startsWith(`${p.id}:`) && regions.includes(id.slice(p.id.length + 1))) ||
        styleProperties.some((key) => {
          const source = plan.resolvedStyle?.sources[key];
          return source && source !== p.id && (id === `${source}:trim` || id === `${source}:inserts` || id === `${source}:deck`);
        }),
    ),
  );
  return JSON.stringify([
    domain,
    shape,
    ['walls', 'facade', 'ground', 'features', 'crown'].includes(domain) ? p.age : null,
    style,
    recipe.seed,
    recipe.detail,
    recipe.style,
    recipe.finish,
    domain === 'roof' ? recipe.topStyle : null,
    recipe.surfaceTextures,
    recipe.materialLibrary,
    recipe.materialDefaults,
    overrides,
  ]);
}
