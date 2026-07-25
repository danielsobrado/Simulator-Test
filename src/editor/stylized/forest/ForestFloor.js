function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function forestFloorDensity(habitat, kind, config = {}) {
  if (!habitat?.patchId || habitat.patchCoverage <= 0) return 1;
  const coverage = clamp01(habitat.patchCoverage);
  const edge = clamp01(habitat.patchEdge);
  const coreDensity = clamp01(Number(
    kind === 'flower' ? config.flowerCoreDensity : config.grassCoreDensity,
  ) || (kind === 'flower' ? 0.08 : 0.18));
  const edgeDensity = clamp01(Number(
    kind === 'flower' ? config.flowerEdgeDensity : config.grassEdgeDensity,
  ) || (kind === 'flower' ? 0.58 : 0.72));
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
  const densityAt = (localX, localZ) => {
    const gridX = clamp01((localX + half) / worldSize) * (size - 1);
    const gridZ = clamp01((half - localZ) / worldSize) * (size - 1);
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const x1 = Math.min(size - 1, x0 + 1);
    const z1 = Math.min(size - 1, z0 + 1);
    const tx = gridX - x0;
    const tz = gridZ - z0;
    const bottom = densityGrid[z0 * size + x0] * (1 - tx)
      + densityGrid[z0 * size + x1] * tx;
    const top = densityGrid[z1 * size + x0] * (1 - tx)
      + densityGrid[z1 * size + x1] * tx;
    return bottom * (1 - tz) + top * tz;
  };
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
