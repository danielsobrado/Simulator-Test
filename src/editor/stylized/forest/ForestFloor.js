import { bilinearSample } from './bilinearGrid.js';

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Fraction of a ground-cover layer that survives under canopy. Suppressed in
 * dense patch cores, restored toward the patch edge. `bush` keeps most of its
 * density at the fringe — thickets ring a wood rather than carpeting its floor.
 */
const FLOOR_DEFAULTS = Object.freeze({
  grass: Object.freeze({ core: 0.45, edge: 0.82 }),
  flower: Object.freeze({ core: 0.18, edge: 0.58 }),
  bush: Object.freeze({ core: 0.28, edge: 0.95 }),
});

export const FOREST_FLOOR_KINDS = Object.freeze(Object.keys(FLOOR_DEFAULTS));

function floorValue(profile, config, name, fallback) {
  const value = profile[name] ?? config[name];
  return clamp01(Number.isFinite(value) ? value : fallback);
}

export function validateForestFloorDensities(config = {}) {
  const validate = (profile, path) => {
    for (const kind of FOREST_FLOOR_KINDS) for (const location of ['Core', 'Edge']) {
      const key = `${kind}${location}Density`, value = profile[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
        throw new Error(`Invalid editor configuration: ${path}.${key} must be in [0, 1].`);
      }
    }
  };
  validate(config, 'trees.forestFloor');
  const root = config.rootZone;
  if (root !== undefined && !(root && Number.isFinite(root.radius) && root.radius >= 0
      && Number.isFinite(root.falloff) && root.falloff > 0)) {
    throw new Error('Invalid editor configuration: trees.forestFloor.rootZone needs radius >= 0 and falloff > 0.');
  }
  for (const [id, profile] of Object.entries(config.byTileId ?? {})) {
    if (!Number.isInteger(Number(id)) || Number(id) < 0 || Number(id) > 254 || !profile || typeof profile !== 'object') {
      throw new Error(`Invalid editor configuration: trees.forestFloor.byTileId.${id} needs a terrain ID and profile.`);
    }
    validate(profile, `trees.forestFloor.byTileId.${id}`);
  }
}

export function forestFloorDensity(habitat, kind, config = {}) {
  if (!habitat?.patchId || habitat.patchCoverage <= 0) return 1;
  const coverage = clamp01(habitat.patchCoverage);
  const edge = clamp01(habitat.patchEdge);
  const defaults = FLOOR_DEFAULTS[kind] ?? FLOOR_DEFAULTS.grass;
  const profile = config.byTileId?.[habitat.tileId] ?? config;
  const coreDensity = floorValue(profile, config, `${kind}CoreDensity`, defaults.core);
  const edgeDensity = floorValue(profile, config, `${kind}EdgeDensity`, defaults.edge);
  const woodedDensity = coreDensity + (edgeDensity - coreDensity) * edge;
  return clamp01(1 - coverage * (1 - woodedDensity));
}

/**
 * A shrub layer does not stop where the cluster field's thickets do: a wood keeps
 * `understory` of a thicket's density across its interior, scaled by coverage.
 */
export function understoryClusterDensity(clusterDensity, habitat, understory = 0) {
  return Math.max(clusterDensity, understory * clamp01(habitat?.patchCoverage ?? 0));
}

/** Share of its light a plant under full canopy loses, on top of the sun's shadow. */
export const CANOPY_SHADE = 0.28;

/** Per-instance brightness under the canopy at a placement: 1 in the open. */
export function canopyShade(field, x, z) {
  return 1 - CANOPY_SHADE * clamp01(field?.sample(x, z)?.patchCoverage ?? 0);
}

/**
 * Bilinear canopy suppression over one chunk, as a `(localX, localZ) => 0..1`
 * sampler, or null when this chunk has nothing to suppress.
 *
 * Lifting this out of `filterScatterByForest` lets a scatter build test each
 * candidate as it writes it, instead of filtering a copy afterwards — which is one
 * pass over the chunk and two fewer full-size arrays per rebuild.
 *
 * The null case is the common one. Most chunks in a world are open ground, and
 * there the whole per-instance test disappears rather than costing a multiply.
 */
export function createForestDensitySampler({
  descriptor,
  field,
  kind,
  config,
  chunkWorldSize,
  gridSize = 16,
}) {
  if (!field || !descriptor) return null;
  const size = Math.max(2, Math.trunc(gridSize) || 16);
  const worldSize = Number(chunkWorldSize) || 128;
  const half = worldSize * 0.5;
  const densityGrid = new Float32Array(size * size);
  let uniform = true;
  for (let z = 0; z < size; z += 1) {
    const worldZ = descriptor.centerWorldZ + half - z / (size - 1) * worldSize;
    for (let x = 0; x < size; x += 1) {
      const worldX = descriptor.centerWorldX - half + x / (size - 1) * worldSize;
      const density = forestFloorDensity(field.sample(worldX, worldZ), kind, config);
      densityGrid[z * size + x] = density;
      if (density !== 1) uniform = false;
    }
  }
  if (uniform) return null;
  return forestDensitySamplerFromGrid({ densityGrid, size, worldSize });
}

/** Serializable canopy data shared by main-thread and worker grass sampling. */
export function forestDensitySamplerFromGrid(snapshot) {
  const { densityGrid, size, worldSize } = snapshot;
  const half = worldSize * 0.5;
  const sampler = (localX, localZ) => bilinearSample(
    densityGrid, size,
    clamp01((localX + half) / worldSize) * (size - 1),
    clamp01((half - localZ) / worldSize) * (size - 1),
  );
  sampler.snapshot = snapshot;
  return sampler;
}

export function filterScatterByForest({
  scatter,
  descriptor,
  field,
  kind,
  config,
  chunkWorldSize,
  gridSize = 16,
}) {
  if (!scatter?.base || !scatter?.parameters) return scatter;
  const densityAt = createForestDensitySampler({
    descriptor,
    field,
    kind,
    config,
    chunkWorldSize,
    gridSize,
  });
  if (!densityAt) return scatter;
  const base = new Float32Array(scatter.base.length);
  const parameters = new Float32Array(scatter.parameters.length);
  let count = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < scatter.count; index += 1) {
    const sourceBase = index * 3;
    const sourceParameters = index * 4;
    const density = densityAt(scatter.base[sourceBase], scatter.base[sourceBase + 2]);
    if (scatter.parameters[sourceParameters + 3] >= density) continue;
    const targetBase = count * 3;
    const targetParameters = count * 4;
    base.set(scatter.base.subarray(sourceBase, sourceBase + 3), targetBase);
    parameters.set(
      scatter.parameters.subarray(sourceParameters, sourceParameters + 4),
      targetParameters,
    );
    minimumHeight = Math.min(minimumHeight, scatter.base[sourceBase + 1]);
    maximumHeight = Math.max(maximumHeight, scatter.base[sourceBase + 1]);
    count += 1;
  }
  return {
    ...scatter,
    base,
    parameters,
    count,
    minimumHeight,
    maximumHeight,
    forestFiltered: true,
  };
}
