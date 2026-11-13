/**
 * Validates `config/instanced-locations.yaml` and resolves a site id to
 * everything needed to build it. Every cross-reference is checked here, once,
 * so a typo fails at startup with the key that is wrong instead of producing a
 * location in the wrong culture's materials.
 */

const need = (table, key, what, owner) => {
  const value = table?.[key];
  if (value === undefined) throw new Error(`Instanced locations: ${owner} names unknown ${what} "${key}".`);
  return value;
};

const merge = (base, override) => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base;
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(override)) out[key] = merge(out[key], value);
  return out;
};

/**
 * @param {object} source the parsed YAML document
 * @param {{ generatorKeys: Iterable<string>, quality?: string|null }} options
 */
export function resolveLocationCatalog(source, { generatorKeys, quality = null }) {
  const root = source?.instancedLocations;
  if (!root) throw new Error('Instanced locations: config has no `instancedLocations` section.');
  const generators = new Set(generatorKeys);
  const tier = quality && root.quality.tiers[quality] ? quality : root.quality.default;
  const qualityTier = need(root.quality.tiers, tier, 'quality tier', 'quality.default');

  const resolveMaterial = (entry, owner) => {
    if (entry.kind === 'glow') return { kind: 'glow' };
    if (entry.kind === 'ice') {
      const profile = need(root.iceProfiles, entry.profile, 'ice profile', owner);
      const bedrock = entry.bedrock ? need(root.materialProfiles, entry.bedrock, 'material profile', owner) : null;
      const surfaces = { ice: need(root.textureSets, 'ice', 'texture set', owner), snow: need(root.textureSets, 'snow', 'texture set', owner) };
      if (bedrock) surfaces.rock = need(root.textureSets, bedrock.surface, 'texture set', owner);
      return { kind: 'ice', profile, bedrock, surfaces, masked: entry.masked !== false };
    }
    if (entry.kind === 'stone') {
      const profile = need(root.materialProfiles, entry.profile, 'material profile', owner);
      const surfaces = {
        stone: need(root.textureSets, profile.surface, 'texture set', `material profile ${entry.profile}`),
      };
      if (profile.floorSurface) {
        surfaces.floor = need(root.textureSets, profile.floorSurface, 'texture set', `material profile ${entry.profile}`);
      }
      return { kind: 'stone', profile, masked: entry.masked !== false, surfaces };
    }
    throw new Error(`Instanced locations: ${owner} has unknown material kind "${entry.kind}".`);
  };

  const archetypes = {};
  for (const [key, archetype] of Object.entries(root.archetypes)) {
    const owner = `archetype ${key}`;
    if (!generators.has(archetype.generatorKey)) {
      throw new Error(`Instanced locations: ${owner} names unregistered generator "${archetype.generatorKey}".`);
    }
    if (!archetype.materials?.terrain) throw new Error(`Instanced locations: ${owner} has no terrain material.`);
    archetypes[key] = {
      key,
      generatorKey: archetype.generatorKey,
      voxel: archetype.voxel * qualityTier.voxelScale,
      lighting: need(root.lightingProfiles, archetype.lightingProfile, 'lighting profile', owner),
      atmosphere: need(root.atmosphereProfiles, archetype.atmosphereProfile, 'atmosphere profile', owner),
      themeKey: archetype.loadingTheme,
      theme: need(root.loadingThemes, archetype.loadingTheme, 'loading theme', owner),
      materials: Object.fromEntries(Object.entries(archetype.materials)
        .map(([name, entry]) => [name, resolveMaterial(entry, `${owner} material ${name}`)])),
      params: archetype.params ?? {},
    };
  }

  const sites = new Map();
  for (const [id, site] of Object.entries(root.sites ?? {})) {
    const archetype = need(archetypes, site.archetype, 'archetype', `site ${id}`);
    if (!Number.isInteger(site.seed)) throw new Error(`Instanced locations: site ${id} needs an integer seed.`);
    sites.set(id, Object.freeze({
      ...archetype,
      id,
      archetypeKey: site.archetype,
      title: site.title ?? archetype.theme.title,
      subtitle: site.subtitle ?? '',
      seed: site.seed,
      showcase: site.showcase === true,
      params: merge(archetype.params, site.params),
    }));
  }

  return Object.freeze({
    policy: root.transitionPolicy,
    quality: qualityTier,
    returnTheme: { key: 'surface_return', ...need(root.loadingThemes, 'surface_return', 'loading theme', 'transitionPolicy') },
    sites,
    /** @returns the resolved site, or throws for an unknown id */
    site(id) {
      const site = sites.get(id);
      if (!site) throw new Error(`Unknown instanced location "${id}".`);
      return site;
    },
    showcaseSites: () => [...sites.values()].filter((site) => site.showcase),
  });
}
