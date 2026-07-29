const PROFILES = Object.freeze({
  standard: Object.freeze({
    id: 'standard',
    treeMultiplier: 1,
    grassMultiplier: 1,
  }),
  'dense-forest': Object.freeze({
    id: 'dense-forest',
    treeMultiplier: 2,
    grassMultiplier: 1,
  }),
  'high-grass': Object.freeze({
    id: 'high-grass',
    treeMultiplier: 1,
    grassMultiplier: 2,
  }),
  'dense-mixed': Object.freeze({
    id: 'dense-mixed',
    treeMultiplier: 2,
    grassMultiplier: 2,
  }),
});

export function listPerfQaDensityProfiles() {
  return Object.keys(PROFILES);
}

export function resolvePerfQaDensityProfile(id = 'standard') {
  return PROFILES[id] ?? PROFILES.standard;
}

export function applyPerfQaDensityProfile(editorConfig, id = 'standard') {
  const profile = resolvePerfQaDensityProfile(id);
  if (profile.id === 'standard') return profile;
  const surface = editorConfig?.stylizedSurface;
  if (!surface) return profile;

  const trees = surface.trees;
  if (trees && profile.treeMultiplier !== 1) {
    trees.perChunk = Math.max(1, Math.round(trees.perChunk * profile.treeMultiplier));
    if (trees.habitat) {
      trees.habitat.candidateBudgetPerChunk = Math.max(
        trees.perChunk,
        Math.round(
          (Number(trees.habitat.candidateBudgetPerChunk) || trees.perChunk)
          * profile.treeMultiplier,
        ),
      );
      trees.habitat.maxAcceptedPerChunk = Math.max(
        trees.perChunk,
        Math.round(
          (Number(trees.habitat.maxAcceptedPerChunk) || trees.perChunk)
          * profile.treeMultiplier,
        ),
      );
    }
  }

  const grass = surface.grass;
  if (grass && profile.grassMultiplier !== 1) {
    grass.bladesPerCell = Math.max(
      1,
      Math.round(grass.bladesPerCell * profile.grassMultiplier),
    );
  }
  return profile;
}
