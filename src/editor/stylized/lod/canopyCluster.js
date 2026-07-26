function hash32(value) {
  let result = value | 0;
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

export function aggregateCanopyCluster({
  chunkX,
  chunkZ,
  placements,
  minimumWidth = 8,
  minimumHeight = 4,
}) {
  if (!Array.isArray(placements) || placements.length === 0) return null;

  let minimumX = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let minimumZ = Number.POSITIVE_INFINITY;
  let maximumZ = Number.NEGATIVE_INFINITY;
  let totalHeight = 0;
  let totalScale = 0;

  for (const placement of placements) {
    minimumX = Math.min(minimumX, placement.x);
    maximumX = Math.max(maximumX, placement.x);
    minimumZ = Math.min(minimumZ, placement.z);
    maximumZ = Math.max(maximumZ, placement.z);
    totalHeight += placement.height;
    totalScale += placement.scale;
  }

  const count = placements.length;
  const averageGround = totalHeight / count;
  const averageScale = totalScale / count;
  const width = Math.max(minimumWidth, maximumX - minimumX + minimumWidth * 0.55);
  const depth = Math.max(minimumWidth, maximumZ - minimumZ + minimumWidth * 0.55);
  const height = Math.max(minimumHeight, minimumHeight * averageScale * (0.9 + Math.log2(count + 1) * 0.16));
  const seed = hash32(Math.imul(chunkX, 73856093) ^ Math.imul(chunkZ, 19349663));

  return Object.freeze({
    stableId: `canopy:${chunkX}:${chunkZ}`,
    x: (minimumX + maximumX) * 0.5,
    y: averageGround,
    z: (minimumZ + maximumZ) * 0.5,
    width,
    height,
    depth,
    seed: seed / 0xffffffff,
    count,
  });
}

function connectionRadius(placement, gap) {
  return placement.spacingRadius ?? placement.radius ?? gap * 0.5;
}

/**
 * Bucketed flood fill. The previous form copied the whole remaining set per
 * visited node, which is fine at a couple of dozen trees per chunk and a frame
 * spike at a couple of hundred. Buckets are sized by the largest connection
 * distance so any connected pair shares a bucket or one of its eight
 * neighbours; component membership is unchanged.
 */
function connectedComponents(placements, gap) {
  let maximumReach = 0;
  for (const placement of placements) {
    maximumReach = Math.max(maximumReach, connectionRadius(placement, gap));
  }
  const cellSize = Math.max(1e-6, maximumReach * 2 + gap);
  const buckets = new Map();
  for (const placement of placements) {
    const key = `${Math.floor(placement.x / cellSize)}:${Math.floor(placement.z / cellSize)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(placement);
    else buckets.set(key, [placement]);
  }

  const remaining = new Set(placements);
  const components = [];
  for (const seed of placements) {
    if (!remaining.has(seed)) continue;
    remaining.delete(seed);
    const component = [seed];
    for (let cursor = 0; cursor < component.length; cursor += 1) {
      const current = component[cursor];
      const cellX = Math.floor(current.x / cellSize);
      const cellZ = Math.floor(current.z / cellSize);
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const bucket = buckets.get(`${cellX + offsetX}:${cellZ + offsetZ}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            if (!remaining.has(candidate)) continue;
            const connection = connectionRadius(current, gap)
              + connectionRadius(candidate, gap)
              + gap;
            if (Math.hypot(current.x - candidate.x, current.z - candidate.z) <= connection) {
              remaining.delete(candidate);
              component.push(candidate);
            }
          }
        }
      }
    }
    components.push(component);
  }
  return components;
}

function splitIntoLobes(component, maximumLobes) {
  const lobeCount = Math.min(maximumLobes, Math.max(1, Math.ceil(component.length / 7)));
  if (lobeCount === 1) return [component];
  const minimumX = Math.min(...component.map((placement) => placement.x));
  const maximumX = Math.max(...component.map((placement) => placement.x));
  const minimumZ = Math.min(...component.map((placement) => placement.z));
  const maximumZ = Math.max(...component.map((placement) => placement.z));
  const axis = maximumX - minimumX >= maximumZ - minimumZ ? 'x' : 'z';
  const ordered = [...component].sort((left, right) => (
    left[axis] - right[axis] || left.stableId.localeCompare(right.stableId)
  ));
  return Array.from({ length: lobeCount }, (_, index) => (
    ordered.slice(
      Math.floor(index * ordered.length / lobeCount),
      Math.floor((index + 1) * ordered.length / lobeCount),
    )
  )).filter((lobe) => lobe.length > 0);
}

/**
 * Emits deterministic patch fragments instead of a single chunk-shaped blob.
 * Patch identity remains canonical across chunks; component/lobe suffixes only
 * describe the fragment rendered by this owner chunk.
 */
export function aggregateCanopyClusters({
  chunkX,
  chunkZ,
  placements,
  minimumWidth = 8,
  minimumHeight = 4,
  connectionGap = 2,
  maximumLobesPerComponent = 3,
}) {
  if (!Array.isArray(placements) || placements.length === 0) return Object.freeze([]);
  const byPatch = new Map();
  for (const placement of placements) {
    const key = placement.patchId ?? `unpatched:${placement.stableId}`;
    const group = byPatch.get(key) ?? [];
    group.push(placement);
    byPatch.set(key, group);
  }
  const result = [];
  for (const [patchId, patchPlacements] of [...byPatch.entries()].sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const components = connectedComponents(patchPlacements, connectionGap);
    components.forEach((component, componentIndex) => {
      const lobes = splitIntoLobes(component, maximumLobesPerComponent);
      lobes.forEach((lobe, lobeIndex) => {
        const cluster = aggregateCanopyCluster({
          chunkX,
          chunkZ,
          placements: lobe,
          minimumWidth,
          minimumHeight,
        });
        const averageCrown = lobe.reduce(
          (total, placement) => total + (placement.crownScale ?? 1),
          0,
        ) / lobe.length;
        result.push(Object.freeze({
          ...cluster,
          stableId: `canopy:${patchId}:${chunkX}:${chunkZ}:${componentIndex}:${lobeIndex}`,
          patchId,
          componentIndex,
          lobeIndex,
          width: cluster.width * averageCrown,
          depth: cluster.depth * averageCrown,
          speciesId: lobe[0].speciesId ?? null,
          speciesColor: lobe[0].speciesColor ?? null,
          // Lobes never span patches, so any member's grove seed describes the
          // whole fragment — the far canopy turns autumn with the trees it stands in for.
          groveSeed: lobe[0].groveSeed ?? 0,
        }));
      });
    });
  }
  return Object.freeze(result);
}
