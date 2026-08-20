export const WORKSHOP_DIRTY_DOMAINS = Object.freeze([
  'TOPOLOGY',
  'GEOMETRY',
  'SURFACE_LAYOUT',
  'STYLE',
  'MATERIAL',
  'COLLISION',
  'NAVIGATION',
  'ROOMS',
  'PORTALS',
  'SUPPORTS',
  'FOUNDATION',
  'DECORATION',
  'LOD',
  'BOUNDS',
  'SPATIAL_INDEX',
]);

const DOMAIN_ORDER = new Map(WORKSHOP_DIRTY_DOMAINS.map((domain, index) => [domain, index]));

const GEOMETRY_DERIVED_DOMAINS = Object.freeze([
  'GEOMETRY',
  'SURFACE_LAYOUT',
  'COLLISION',
  'NAVIGATION',
  'ROOMS',
  'PORTALS',
  'SUPPORTS',
  'FOUNDATION',
  'LOD',
  'BOUNDS',
  'SPATIAL_INDEX',
]);

const OPENING_DOMAINS = Object.freeze([
  'GEOMETRY',
  'SURFACE_LAYOUT',
  'COLLISION',
  'NAVIGATION',
  'PORTALS',
  'LOD',
  'BOUNDS',
  'SPATIAL_INDEX',
]);

const ROOT_FIELD_DOMAINS = Object.freeze({
  style: ['STYLE', 'MATERIAL', 'DECORATION'],
  finish: ['STYLE', 'MATERIAL', 'DECORATION'],
  topStyle: ['STYLE', 'MATERIAL', 'GEOMETRY', 'SURFACE_LAYOUT', 'LOD'],
  albedo: ['MATERIAL'],
  surfaceTextures: ['MATERIAL', 'SURFACE_LAYOUT'],
  materialLibrary: ['MATERIAL'],
  materialDefaults: ['MATERIAL'],
  materialAreaOverrides: ['MATERIAL'],
  materialFavorites: ['MATERIAL'],
  ivy: ['DECORATION'],
  weathering: ['DECORATION', 'MATERIAL'],
  irregularity: ['GEOMETRY', 'SURFACE_LAYOUT', 'DECORATION', 'LOD', 'BOUNDS'],
  detail: ['GEOMETRY', 'SURFACE_LAYOUT', 'DECORATION', 'LOD', 'BOUNDS'],
  remesh: ['GEOMETRY', 'LOD', 'BOUNDS'],
  seed: ['GEOMETRY', 'SURFACE_LAYOUT', 'DECORATION', 'LOD'],
  archetype: ['TOPOLOGY', ...GEOMETRY_DERIVED_DOMAINS],
  shape: ['TOPOLOGY', ...GEOMETRY_DERIVED_DOMAINS],
  towerSide: ['TOPOLOGY', ...GEOMETRY_DERIVED_DOMAINS],
  windows: ['GEOMETRY', 'SURFACE_LAYOUT', 'COLLISION', 'NAVIGATION', 'PORTALS', 'LOD'],
  width: GEOMETRY_DERIVED_DOMAINS,
  depth: GEOMETRY_DERIVED_DOMAINS,
  height: GEOMETRY_DERIVED_DOMAINS,
  roofScale: GEOMETRY_DERIVED_DOMAINS,
  roofOverhang: GEOMETRY_DERIVED_DOMAINS,
  roofPitch: GEOMETRY_DERIVED_DOMAINS,
});

function orderedDomains(values) {
  const unique = [...new Set(values)];
  for (const domain of unique) {
    if (!DOMAIN_ORDER.has(domain)) throw new Error(`Unknown workshop dirty domain: ${domain}.`);
  }
  return Object.freeze(unique.sort((left, right) => DOMAIN_ORDER.get(left) - DOMAIN_ORDER.get(right)));
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(before = {}, after = {}) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => !deepEqual(before[field], after[field]))
    .sort();
}

function semanticWallDomains(beforeWall, afterWall) {
  if (!beforeWall && !afterWall) return [];
  if (!beforeWall || !afterWall) return ['TOPOLOGY', ...GEOMETRY_DERIVED_DOMAINS, 'STYLE', 'MATERIAL'];
  const domains = new Set();
  for (const field of changedFields(beforeWall, afterWall)) {
    if (field === 'version' || field === 'id') continue;
    if (field === 'path') {
      domains.add('TOPOLOGY');
      GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'profile') {
      domains.add('TOPOLOGY');
      GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'topFamily') {
      ['GEOMETRY', 'SURFACE_LAYOUT', 'MATERIAL', 'LOD', 'BOUNDS'].forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'style') {
      ['STYLE', 'MATERIAL', 'SURFACE_LAYOUT'].forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'height' || field === 'thickness' || field === 'elevation') {
      GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
  }
  return [...domains];
}

function compositionDomains(before, after) {
  if (!before || !after) return orderedDomains(['TOPOLOGY', ...GEOMETRY_DERIVED_DOMAINS, 'MATERIAL']);
  const left = before.properties?.primitive ?? {};
  const right = after.properties?.primitive ?? {};
  const domains = new Set(semanticWallDomains(before.properties?.wall, after.properties?.wall));
  for (const field of changedFields(left, right)) {
    if (field === 'id') continue;
    if (field === 'kind') {
      WORKSHOP_DIRTY_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'points') {
      domains.add('TOPOLOGY');
      GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'roofFamily' || field === 'topFamily') {
      ['GEOMETRY', 'SURFACE_LAYOUT', 'MATERIAL', 'LOD', 'BOUNDS'].forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'levels') {
      ['NAVIGATION', 'ROOMS'].forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'dimensions' || field === 'radius' || field === 'height' || field === 'thickness') {
      GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
      continue;
    }
    if (field === 'position' || field === 'rotation' || field === 'elevation') {
      [
        'GEOMETRY',
        'COLLISION',
        'NAVIGATION',
        'ROOMS',
        'PORTALS',
        'SUPPORTS',
        'FOUNDATION',
        'LOD',
        'BOUNDS',
        'SPATIAL_INDEX',
      ].forEach((domain) => domains.add(domain));
      continue;
    }
    GEOMETRY_DERIVED_DOMAINS.forEach((domain) => domains.add(domain));
  }
  return orderedDomains([...domains]);
}

function rootDomains(before, after) {
  if (!before || !after) return orderedDomains(WORKSHOP_DIRTY_DOMAINS);
  const domains = [];
  for (const field of changedFields(before.properties ?? {}, after.properties ?? {})) {
    domains.push(...(ROOT_FIELD_DOMAINS[field] ?? WORKSHOP_DIRTY_DOMAINS));
  }
  return orderedDomains(domains);
}

export function domainsForWorkshopEntityChange(before, after) {
  if (!before && !after) return Object.freeze([]);
  const entity = after ?? before;
  if (before && after && deepEqual(before.toJSON?.() ?? before, after.toJSON?.() ?? after)) {
    return Object.freeze([]);
  }
  const relationshipDomains = [];
  if (!before || !after || before.parentId !== after.parentId || !deepEqual(before.dependsOn, after.dependsOn)) {
    relationshipDomains.push('TOPOLOGY');
  }
  if (entity.type === 'workshop-recipe') {
    return orderedDomains([...relationshipDomains, ...rootDomains(before, after)]);
  }
  if (entity.type.startsWith('composition-')) {
    return orderedDomains([...relationshipDomains, ...compositionDomains(before, after)]);
  }
  if (entity.type === 'component-transform') {
    return orderedDomains([...relationshipDomains, 'GEOMETRY', 'COLLISION', 'LOD', 'BOUNDS', 'SPATIAL_INDEX']);
  }
  if (entity.type === 'opening-attachment' || entity.type === 'opening-assembly') {
    return orderedDomains([...relationshipDomains, ...OPENING_DOMAINS]);
  }
  if (entity.type === 'generation-control') {
    return orderedDomains([...relationshipDomains, 'DECORATION']);
  }
  return orderedDomains([...relationshipDomains, 'GEOMETRY', 'LOD', 'BOUNDS', 'SPATIAL_INDEX']);
}

export function normalizeDirtyDomains(domains) {
  if (!Array.isArray(domains)) throw new Error('Workshop dirty domains must be an array.');
  return orderedDomains(domains);
}

export function dirtyDomainOrder(domain) {
  return DOMAIN_ORDER.get(domain) ?? Number.POSITIVE_INFINITY;
}
