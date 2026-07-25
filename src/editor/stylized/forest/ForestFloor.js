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
  grass: Object.freeze({ core: 0.18, edge: 0.72 }),
  flower: Object.freeze({ core: 0.08, edge: 0.58 }),
  bush: Object.freeze({ core: 0.22, edge: 0.95 }),
});

export const FOREST_FLOOR_KINDS = Object.freeze(Object.keys(FLOOR_DEFAULTS));

export function forestFloorDensity(habitat, kind, config = {}) {
  if (!habitat?.patchId || habitat.patchCoverage <= 0) return 1;
  const coverage = clamp01(habitat.patchCoverage);
  const edge = clamp01(habitat.patchEdge);
  const defaults = FLOOR_DEFAULTS[kind] ?? FLOOR_DEFAULTS.grass;
  const coreDensity = clamp01(Number(config[`${kind}CoreDensity`]) || defaults.core);
  const edgeDensity = clamp01(Number(config[`${kind}EdgeDensity`]) || defaults.edge);
  const woodedDensity = coreDensity + (edgeDensity - coreDensity) * edge;
  return clamp01(1 - coverage * (1 - woodedDensity));
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
  if (!scatter?.base || !scatter?.parameters || !field || !descriptor) return scatter;
  const size = Math.max(2, Math.trunc(gridSize) || 16);
  const worldSize = Number(chunkWorldSize) || 128;
  const half = worldSize * 0.5;
  const densityGrid = new Float32Array(size * size);
  for (let z = 0; z < size; z += 1) {
    const worldZ = descriptor.centerWorldZ + half - z / (size - 1) * worldSize;
    for (let x = 0; x < size; x += 1) {
      const worldX = descriptor.centerWorldX - half + x / (size - 1) * worldSize;
      densityGrid[z * size + x] = forestFloorDensity(
        field.sample(worldX, worldZ),
        kind,
        config,
      );
    }
  }
  const densityAt = (localX, localZ) => bilinearSample(
    densityGrid,
    size,
    clamp01((localX + half) / worldSize) * (size - 1),
    clamp01((half - localZ) / worldSize) * (size - 1),
  );
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
