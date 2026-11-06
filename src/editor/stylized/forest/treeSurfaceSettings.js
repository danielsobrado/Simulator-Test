const unit = (value, name) => {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid tree surface setting: ${name} must be within [0, 1].`);
  return value;
};

/** Plain, serializable settings also travel with each baked prototype. */
export function resolveTreeFoliageSettings(trees = {}, species = 'broadleaf') {
  const input = trees.foliageLighting ?? {};
  const family = String(Array.isArray(species) ? species[0] : species).startsWith('conifer') ? 'conifer' : 'broadleaf';
  const settings = {
    enabled: input.enabled === true, transmission: 0.8, thickness: 0.5,
    absorption: 1.8, transmissionColor: '#e0edb0', normalBlend: 0.1,
    occlusionStrength: 0.65, minimumVisibility: 0.35,
    wetStrength: 0.55, wetRoughness: 0.28, needleSpecular: 0,
    ...input, ...(input.species?.[family] ?? {}),
  };
  delete settings.species;
  for (const key of ['transmission', 'thickness', 'normalBlend', 'occlusionStrength', 'minimumVisibility', 'wetStrength', 'wetRoughness', 'needleSpecular']) unit(settings[key], `foliageLighting.${key}`);
  if (!(settings.absorption > 0) || !Number.isFinite(settings.absorption)) throw new Error('Invalid tree foliage absorption.');
  if (!/^#[\da-f]{6}$/i.test(settings.transmissionColor)) throw new Error('Invalid tree foliage transmissionColor.');
  return settings;
}

export function resolveTreeBarkSettings(trees = {}) {
  const input = trees.barkSurface ?? {};
  const parallax = { enabled: false, near: 4, far: 14, scale: 0.025, steps: 8, shadowStrength: 0.2, ...input.parallax };
  const settings = { enabled: input.enabled === true, roughness: 0.9, wetRoughness: 0.32, wetStrength: 0.8, ...input, parallax };
  for (const key of ['roughness', 'wetRoughness', 'wetStrength']) unit(settings[key], `barkSurface.${key}`);
  unit(parallax.shadowStrength, 'barkSurface.parallax.shadowStrength');
  if (!(parallax.near >= 0 && parallax.far > parallax.near && parallax.scale > 0 && parallax.scale <= 0.1)
    || !Number.isInteger(parallax.steps) || parallax.steps < 4 || parallax.steps > 16) throw new Error('Invalid tree bark parallax settings.');
  return settings;
}

export function resolveCanopyBakeSettings(trees = {}) {
  const settings = { resolution: 16, density: 0.65, ...trees.canopyOcclusion };
  if (!Number.isInteger(settings.resolution) || settings.resolution < 4 || settings.resolution > 32
    || !Number.isFinite(settings.density) || settings.density < 0 || settings.density > 4) throw new Error('Invalid tree canopy occlusion bake settings.');
  return settings;
}
