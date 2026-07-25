const DEFAULT_CANDIDATE_MULTIPLIER = 2;
const MAX_CANDIDATE_MULTIPLIER = 8;
// Closed-forest density needs a higher ceiling than the original 256. Spacing is
// bucket-indexed and habitat patches are sampled on a coarse grid, so per-chunk
// manifest cost stays linear in the candidate count.
const MAX_CANDIDATE_BUDGET = 512;

export function resolveForestSeed(worldStore) {
  const generator = worldStore?.generator;
  if (Number.isSafeInteger(generator?.seed)) return generator.seed;

  const metadata = typeof generator?.toMetadata === 'function'
    ? generator.toMetadata()
    : null;
  if (Number.isSafeInteger(metadata?.seed)) return metadata.seed;
  if (Number.isSafeInteger(worldStore?.seed)) return worldStore.seed;
  if (Number.isSafeInteger(worldStore?.worldSeed)) return worldStore.worldSeed;
  return 0;
}

export function resolveForestCandidateBudget(perChunk, configuredBudget) {
  if (!Number.isInteger(perChunk) || perChunk < 1) {
    throw new Error('Forest accepted tree budget must be a positive integer.');
  }

  const fallback = perChunk * DEFAULT_CANDIDATE_MULTIPLIER;
  const requested = Number.isFinite(configuredBudget)
    ? Math.floor(configuredBudget)
    : fallback;
  const maximum = Math.max(
    perChunk,
    Math.min(MAX_CANDIDATE_BUDGET, perChunk * MAX_CANDIDATE_MULTIPLIER),
  );
  return Math.min(maximum, Math.max(perChunk, requested));
}
